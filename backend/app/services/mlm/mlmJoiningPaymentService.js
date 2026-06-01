import crypto from "crypto";
import mongoose from "mongoose";

import Customer from "../../models/customer.js";
import MlmJoiningPayment from "../../models/mlmJoiningPayment.js";
import MlmMembership from "../../models/mlmMembership.js";
import PaymentWebhookEvent from "../../models/paymentWebhookEvent.js";
import { MLM_MEMBERSHIP_STATUS } from "../../constants/mlm.js";
import {
  PAYMENT_EVENT_SOURCE,
  PAYMENT_STATUS,
  canTransitionPaymentStatus,
} from "../../constants/payment.js";
import { getActivePaymentProvider } from "../payment/providerRegistry.js";
import { getMlmConfig } from "./mlmConfigService.js";
import { activateMembershipFromJoiningPayment } from "./mlmActivationService.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import logger from "../logger.js";

/**
 * mlmJoiningPaymentService — direct payment + Plan A activation flow.
 *
 * Replaces the legacy order-coupled `mlmJoinService`. A customer's
 * "Join Now" click now produces a single MlmJoiningPayment row, opens
 * the PhonePe redirect, and on capture activates membership directly
 * from the payment row — no Order, no Product, no Setting.mlm field.
 *
 * Money-flow discipline:
 *   - Price + shopping credit are snapshot-at-intent so admins can
 *     edit `Setting.mlm.joiningPackage*` mid-flight without cheating
 *     in-flight customers.
 *   - Activation is idempotent on `MlmJoiningPayment.activationApplied`.
 *   - Wallet credit + sponsor milestone run in one Mongoose session
 *     (per `wallet-ledger-atomicity` + `mongoose-transaction-wrap`
 *     skills).
 *
 * Errors (all surface a `statusCode`):
 *   - 401 AUTH_REQUIRED               — no userId on the request.
 *   - 422 MLM_DISABLED                — admin has not enabled MLM.
 *   - 422 JOINING_PRICE_UNCONFIGURED  — `joiningPackagePrice` <= 0.
 *   - 409 ALREADY_MEMBER              — caller has an ACTIVE membership.
 *   - 404 CUSTOMER_NOT_FOUND          — auth token references a missing user.
 */

const MAX_MERCHANT_ORDER_ID_LENGTH = 63;
const MERCHANT_ORDER_PREFIX = "MLM-JOIN";

function sanitizeMerchantOrderIdPart(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildJoiningMerchantOrderId(paymentId, attemptCount = 1) {
  const normalizedBase = sanitizeMerchantOrderIdPart(paymentId) || "PAY";
  const suffix = `-A${Math.max(1, Number(attemptCount) || 1)}`;
  const prefix = `${MERCHANT_ORDER_PREFIX}-`;
  const maxBaseLength =
    MAX_MERCHANT_ORDER_ID_LENGTH - prefix.length - suffix.length;
  const truncatedBase = normalizedBase.slice(0, Math.max(1, maxBaseLength));
  return `${prefix}${truncatedBase}${suffix}`;
}

/** Is this merchantOrderId routed to the MLM joining lifecycle? */
export function isJoiningMerchantOrderId(merchantOrderId) {
  if (!merchantOrderId) return false;
  return String(merchantOrderId).trim().toUpperCase().startsWith(`${MERCHANT_ORDER_PREFIX}-`);
}

function sanitizeGatewayPayload(payload = {}) {
  return {
    merchantOrderId: payload.merchantOrderId,
    transactionId: payload.transactionId,
    amount: payload.amount,
    state: payload.state,
    responseCode: payload.responseCode,
    paymentMode: payload.paymentMode,
    meta: payload.meta || {},
  };
}

async function transitionStatus(payment, {
  nextStatus,
  source,
  reason = "",
  gatewayPaymentId = null,
  rawGatewayResponse = null,
}) {
  const currentStatus = payment.status || PAYMENT_STATUS.CREATED;
  if (currentStatus === nextStatus) {
    if (gatewayPaymentId && !payment.gatewayPaymentId) {
      payment.gatewayPaymentId = gatewayPaymentId;
    }
    if (rawGatewayResponse) {
      payment.rawGatewayResponse = {
        ...(payment.rawGatewayResponse || {}),
        ...sanitizeGatewayPayload(rawGatewayResponse),
      };
    }
    await payment.save();
    return payment;
  }

  if (!canTransitionPaymentStatus(currentStatus, nextStatus)) {
    const err = new Error(
      `Invalid joining payment transition ${currentStatus} -> ${nextStatus}`,
    );
    err.statusCode = 409;
    throw err;
  }

  payment.status = nextStatus;
  if (gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
  if (rawGatewayResponse) {
    payment.rawGatewayResponse = {
      ...(payment.rawGatewayResponse || {}),
      ...sanitizeGatewayPayload(rawGatewayResponse),
    };
  }
  payment.statusHistory.push({
    fromStatus: currentStatus,
    toStatus: nextStatus,
    source,
    reason,
    changedAt: new Date(),
  });
  if (nextStatus === PAYMENT_STATUS.CAPTURED) {
    payment.capturedAt = new Date();
  } else if (nextStatus === PAYMENT_STATUS.FAILED) {
    payment.failedAt = new Date();
    payment.failureReason = reason || payment.failureReason;
  } else if (nextStatus === PAYMENT_STATUS.CANCELLED) {
    payment.failedAt = new Date();
    payment.failureReason = reason || payment.failureReason;
  }
  await payment.save();
  return payment;
}

async function handleStatusSideEffects(payment, nextStatus) {
  if (nextStatus === PAYMENT_STATUS.CAPTURED) {
    try {
      await activateMembershipFromJoiningPayment(payment._id, {
        correlationId: payment._id?.toString() || null,
      });
    } catch (mlmError) {
      // Non-fatal: surface as audit + flag on the payment row so an
      // admin compensation tool can re-run. The wallet+ledger pair is
      // atomic via mongoose session, so on activation failure neither
      // side commits — money-flow stays clean.
      payment.activationError = mlmError.message;
      await payment.save();
      logger.error("[mlmJoiningPaymentService] activation failed", {
        paymentId: String(payment._id),
        error: mlmError.message,
      });
      return;
    }
    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.PAYMENT_SUCCESS, {
        customerId: payment.customer,
        userId: payment.customer,
      });
    } catch (_) {
      /* non-fatal */
    }
  }
}

function buildClickIdempotencyKey(userId) {
  return `mlm-join-${userId}-${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Initiate a joining payment for the customer. Returns the gateway
 * redirect URL. Idempotent on `idempotencyKey`.
 */
export async function initiateJoiningPayment({ userId, idempotencyKey = null }) {
  if (!userId) {
    const err = new Error("Authentication required");
    err.statusCode = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  const cfg = await getMlmConfig();
  if (!cfg.enabled) {
    const err = new Error(
      "Rewards program is not active yet. Please check back soon.",
    );
    err.statusCode = 422;
    err.code = "MLM_DISABLED";
    throw err;
  }

  const joiningPrice = Number(cfg.joiningPackagePrice) || 0;
  if (joiningPrice <= 0) {
    const err = new Error(
      "Joining package price is not configured. Please contact support.",
    );
    err.statusCode = 422;
    err.code = "JOINING_PRICE_UNCONFIGURED";
    throw err;
  }
  const shoppingCredit = Number(cfg.joiningPackageShoppingWalletCredit) || 0;

  const existingMembership = await MlmMembership.findOne({ userId }).lean();
  if (
    existingMembership &&
    existingMembership.status === MLM_MEMBERSHIP_STATUS.ACTIVE
  ) {
    const err = new Error("You are already an MLM member.");
    err.statusCode = 409;
    err.code = "ALREADY_MEMBER";
    throw err;
  }

  const customer = await Customer.findById(userId, {
    name: 1,
    phone: 1,
    pendingSponsorReferralCode: 1,
  }).lean();
  if (!customer) {
    const err = new Error("Customer profile not found.");
    err.statusCode = 404;
    err.code = "CUSTOMER_NOT_FOUND";
    throw err;
  }

  // Idempotency: if the caller supplied a key and a row already
  // exists for it, return that row's redirect rather than creating a
  // duplicate. Survives rapid double-clicks on "Join Now".
  const effectiveIdempotencyKey =
    idempotencyKey || buildClickIdempotencyKey(userId);

  const existingForKey = await MlmJoiningPayment.findOne({
    customer: userId,
    idempotencyKey: effectiveIdempotencyKey,
  });
  if (existingForKey) {
    return {
      paymentId: String(existingForKey._id),
      merchantOrderId: existingForKey.gatewayOrderId,
      redirectUrl: existingForKey.rawGatewayResponse?.redirectUrl,
      duplicate: true,
    };
  }

  // Reuse an open intent if the customer hammered Join Now from a
  // different client without an idempotency key — saves them from
  // racking up dangling PENDING rows.
  const existingOpen = await MlmJoiningPayment.findOne({
    customer: userId,
    status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING] },
  }).sort({ createdAt: -1 });
  if (existingOpen && existingOpen.rawGatewayResponse?.redirectUrl) {
    return {
      paymentId: String(existingOpen._id),
      merchantOrderId: existingOpen.gatewayOrderId,
      redirectUrl: existingOpen.rawGatewayResponse.redirectUrl,
      duplicate: true,
    };
  }

  const amountPaise = Math.round(joiningPrice * 100);
  const paymentId = new mongoose.Types.ObjectId();
  const attemptCount =
    (await MlmJoiningPayment.countDocuments({ customer: userId })) + 1;
  const merchantOrderId = buildJoiningMerchantOrderId(
    paymentId.toString(),
    attemptCount,
  );

  const provider = getActivePaymentProvider();
  const redirectUrl = `${process.env.FRONTEND_URL}/payment-status?merchantOrderId=${merchantOrderId}`;

  const initResult = await provider.initiatePayment({
    merchantOrderId,
    amountPaise,
    redirectUrl,
  });

  const payment = await MlmJoiningPayment.create({
    _id: paymentId,
    customer: userId,
    gatewayName: provider.providerName,
    gatewayOrderId: merchantOrderId,
    amountPaise,
    currency: "INR",
    status: PAYMENT_STATUS.PENDING,
    joiningPriceSnapshot: joiningPrice,
    shoppingCreditSnapshot: shoppingCredit,
    sponsorReferralCodeSnapshot: customer.pendingSponsorReferralCode || null,
    idempotencyKey: effectiveIdempotencyKey,
    rawGatewayResponse: {
      redirectUrl: initResult.redirectUrl,
      merchantOrderId,
      amountPaise,
    },
    statusHistory: [
      {
        fromStatus: PAYMENT_STATUS.CREATED,
        toStatus: PAYMENT_STATUS.PENDING,
        source: PAYMENT_EVENT_SOURCE.SYSTEM,
        reason: `${provider.providerName} joining checkout initiated`,
      },
    ],
  });

  logger.info("mlm_joining_payment_created", {
    paymentId: payment._id.toString(),
    merchantOrderId,
    amountPaise,
    provider: provider.providerName,
  });

  return {
    paymentId: String(payment._id),
    merchantOrderId,
    redirectUrl: initResult.redirectUrl,
    duplicate: false,
  };
}

/**
 * Client-side payment status verify for an MLM joining payment.
 * Polls the gateway, transitions internal state, fires activation on
 * CAPTURED. Returns `{ payment, status, orderKind: "mlm_joining" }`.
 */
export async function verifyJoiningPaymentStatus({
  merchantOrderId,
  userId,
  correlationId = null,
}) {
  const payment = await MlmJoiningPayment.findOne({
    gatewayOrderId: merchantOrderId,
  });
  if (!payment) {
    const err = new Error("Joining payment not found");
    err.statusCode = 404;
    throw err;
  }

  if (userId && String(payment.customer) !== String(userId)) {
    const err = new Error("Not authorized to verify this payment");
    err.statusCode = 403;
    throw err;
  }

  const provider = getActivePaymentProvider();
  const statusResp = await provider.getPaymentStatus({ merchantOrderId });
  const nextStatus = provider.mapStatusToInternal(statusResp.state);

  await transitionStatus(payment, {
    nextStatus,
    source: PAYMENT_EVENT_SOURCE.CLIENT_VERIFY,
    reason: `${provider.providerName} status check: ${statusResp.state}`,
    gatewayPaymentId: statusResp.transactionId,
    rawGatewayResponse: statusResp.gatewayResponse,
  });

  await handleStatusSideEffects(payment, nextStatus);

  if (correlationId) {
    payment.correlationId = correlationId;
    await payment.save();
  }

  logger.info("mlm_joining_payment_verified", {
    correlationId,
    merchantOrderId,
    status: nextStatus,
    provider: provider.providerName,
  });

  return {
    payment,
    status: nextStatus,
    orderKind: "mlm_joining",
  };
}

/**
 * Process a PhonePe webhook event for an MLM joining payment.
 * Called by the unified webhook dispatcher in `paymentService.js`
 * after the merchantOrderId has already been resolved to a row in
 * this collection. The dispatcher owns webhook-event dedupe via
 * `PaymentWebhookEvent`.
 */
export async function processJoiningPaymentWebhook({
  payment,
  decoded,
  correlationId = null,
}) {
  const provider = getActivePaymentProvider();
  const nextStatus = provider.mapStatusToInternal(decoded.state);

  await transitionStatus(payment, {
    nextStatus,
    source: PAYMENT_EVENT_SOURCE.WEBHOOK,
    reason: `${provider.providerName} webhook: ${decoded.state}`,
    gatewayPaymentId: decoded.transactionId,
    rawGatewayResponse: decoded.raw,
  });

  if (correlationId) {
    payment.correlationId = correlationId;
    await payment.save();
  }

  await handleStatusSideEffects(payment, nextStatus);

  return {
    paymentStatus: nextStatus,
    paymentId: payment._id.toString(),
  };
}

/** Exposed for tests. */
export const __internals = {
  buildJoiningMerchantOrderId,
  buildClickIdempotencyKey,
  transitionStatus,
  handleStatusSideEffects,
};

// Keep the PaymentWebhookEvent import even if not directly used; the
// dispatcher relies on the same event-id dedupe and importing here
// keeps the symbol live for tooling that scans imports.
void PaymentWebhookEvent;
