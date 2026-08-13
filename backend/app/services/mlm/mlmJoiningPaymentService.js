import crypto from "crypto";
import mongoose from "mongoose";

import Customer from "../../models/customer.js";
import MlmJoiningPayment from "../../models/mlmJoiningPayment.js";
import MlmMembership from "../../models/mlmMembership.js";
import PaymentWebhookEvent from "../../models/paymentWebhookEvent.js";
import {
  MLM_MEMBERSHIP_STATUS,
  MLM_PAYMENT_MODE,
} from "../../constants/mlm.js";
import {
  PAYMENT_EVENT_SOURCE,
  PAYMENT_GATEWAY,
  PAYMENT_STATUS,
  canTransitionPaymentStatus,
} from "../../constants/payment.js";
import { getActivePaymentProvider } from "../payment/providerRegistry.js";
import { getManualQrConfig, getMlmConfig } from "./mlmConfigService.js";
import { activateMembershipFromJoiningPayment } from "./mlmActivationService.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import logger from "../logger.js";

/**
 * mlmJoiningPaymentService — direct payment + Plan A activation flow.
 *
 * Replaces the legacy order-coupled `mlmJoinService`. A customer's
 * "Join Now" click now produces a single MlmJoiningPayment row, opens
 * Razorpay Standard Checkout (or the manual-QR proof page), and on
 * capture activates membership directly from the payment row — no
 * Order, no Product, no Setting.mlm field.
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
      const activation = await activateMembershipFromJoiningPayment(payment._id, {
        correlationId: payment._id?.toString() || null,
      });
      try {
        emitNotificationEvent(NOTIFICATION_EVENTS.PAYMENT_SUCCESS, {
          customerId: payment.customer,
          userId: payment.customer,
        });
      } catch (_) {
        /* non-fatal */
      }
      return { activation };
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
      return { activationError: mlmError.message };
    }
  }
  return {};
}

function buildClickIdempotencyKey(userId) {
  return `mlm-join-${userId}-${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Given an error thrown by `MlmJoiningPayment.create()`, checks whether
 * it's the specific duplicate-key race this module already knows how to
 * treat as a no-op (same customer + idempotencyKey slipping past the
 * earlier `existingForKey` lookup) and returns the winning row. Any
 * other error — including a `gatewayOrderId` collision, which would
 * mean two payments legitimately disagree about identity — rethrows.
 */
async function duplicateJoiningPaymentFromRaceOrThrow(error, { userId, idempotencyKey }) {
  if (error?.code !== 11000) throw error;
  const existing = await MlmJoiningPayment.findOne({
    customer: userId,
    idempotencyKey,
  });
  if (!existing) throw error;
  return existing;
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

  // Snapshot the active mode for THIS intent. A subsequent toggle by
  // admin does not reroute already-created rows — `paymentMode` is
  // persisted and every state-machine + side-effect read goes through
  // the row, never `Setting` directly.
  const paymentMode =
    cfg.joiningPaymentMode === MLM_PAYMENT_MODE.RAZORPAY ||
    cfg.joiningPaymentMode === "phonepe"
      ? MLM_PAYMENT_MODE.RAZORPAY
      : MLM_PAYMENT_MODE.MANUAL_QR;
  const isManualQr = paymentMode === MLM_PAYMENT_MODE.MANUAL_QR;

  // Idempotency: if the caller supplied a key and a row already
  // exists for it, return that row's checkout/redirect rather than
  // creating a duplicate. Survives rapid double-clicks on "Join Now".
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
      checkout: existingForKey.rawGatewayResponse?.checkout || null,
      redirectUrl: existingForKey.rawGatewayResponse?.redirectUrl || null,
      paymentMode: existingForKey.paymentMode || MLM_PAYMENT_MODE.RAZORPAY,
      manualQr: isManualQr ? await getManualQrConfig() : undefined,
      duplicate: true,
    };
  }

  // Reuse an open intent of the SAME payment mode if the customer
  // hammered Join Now from a different client without an idempotency
  // key. Mode-scoped so a toggle flip never resurrects a stale row in
  // the other flow. Gateway path treats legacy rows (where the field
  // is missing or still `phonepe`) as razorpay so we don't double-charge.
  const openStatuses = isManualQr
    ? [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING_REVIEW]
    : [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING];
  const paymentModeFilter = isManualQr
    ? { paymentMode: MLM_PAYMENT_MODE.MANUAL_QR }
    : {
        $or: [
          { paymentMode: MLM_PAYMENT_MODE.RAZORPAY },
          { paymentMode: "phonepe" },
          { paymentMode: { $exists: false } },
          { paymentMode: null },
        ],
      };
  const existingOpen = await MlmJoiningPayment.findOne({
    customer: userId,
    ...paymentModeFilter,
    status: { $in: openStatuses },
  }).sort({ createdAt: -1 });
  if (
    existingOpen &&
    (existingOpen.rawGatewayResponse?.checkout?.orderId ||
      existingOpen.rawGatewayResponse?.redirectUrl)
  ) {
    return {
      paymentId: String(existingOpen._id),
      merchantOrderId: existingOpen.gatewayOrderId,
      checkout: existingOpen.rawGatewayResponse?.checkout || null,
      redirectUrl: existingOpen.rawGatewayResponse?.redirectUrl || null,
      paymentMode,
      manualQr: isManualQr ? await getManualQrConfig() : undefined,
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

  // Manual-QR path: no provider call. We mint the row directly in
  // CREATED, snapshot the manual-QR config, and return a redirect URL
  // pointing to the in-app proof-submission page. The admin approve
  // action transitions the row to CAPTURED, which re-uses the same
  // `handleStatusSideEffects` -> `activateMembershipFromJoiningPayment`
  // hook that Razorpay captures fire.
  if (isManualQr) {
    const manualQr = await getManualQrConfig();
    const customerRedirectUrl = `${process.env.FRONTEND_URL || ""}/mlm/manual-payment/${paymentId.toString()}`;

    let payment;
    try {
      payment = await MlmJoiningPayment.create({
        _id: paymentId,
        customer: userId,
        gatewayName: PAYMENT_GATEWAY.MANUAL_QR,
        gatewayOrderId: merchantOrderId,
        paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
        amountPaise,
        currency: "INR",
        status: PAYMENT_STATUS.CREATED,
        joiningPriceSnapshot: joiningPrice,
        shoppingCreditSnapshot: shoppingCredit,
        sponsorReferralCodeSnapshot: customer.pendingSponsorReferralCode || null,
        idempotencyKey: effectiveIdempotencyKey,
        rawGatewayResponse: {
          redirectUrl: customerRedirectUrl,
          merchantOrderId,
          amountPaise,
          manualQrSnapshot: manualQr,
        },
        statusHistory: [
          {
            fromStatus: PAYMENT_STATUS.CREATED,
            toStatus: PAYMENT_STATUS.CREATED,
            source: PAYMENT_EVENT_SOURCE.SYSTEM,
            reason: "Manual QR joining intent created",
          },
        ],
      });
    } catch (error) {
      // Backstop for the race between the `existingForKey` lookup above
      // and this insert: a near-simultaneous double-click (or a network
      // retry that reused the same idempotencyKey) can lose the race on
      // the `{customer, idempotencyKey}` unique index. Treat it as a
      // duplicate instead of surfacing a raw 500 to "Join Now".
      const existing = await duplicateJoiningPaymentFromRaceOrThrow(error, {
        userId,
        idempotencyKey: effectiveIdempotencyKey,
      });
      return {
        paymentId: String(existing._id),
        merchantOrderId: existing.gatewayOrderId,
        redirectUrl: existing.rawGatewayResponse?.redirectUrl || customerRedirectUrl,
        paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
        manualQr,
        duplicate: true,
      };
    }

    logger.info("mlm_joining_payment_created", {
      paymentId: payment._id.toString(),
      merchantOrderId,
      amountPaise,
      provider: PAYMENT_GATEWAY.MANUAL_QR,
      paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
    });

    return {
      paymentId: String(payment._id),
      merchantOrderId,
      redirectUrl: customerRedirectUrl,
      paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
      manualQr,
      duplicate: false,
    };
  }

  const provider = getActivePaymentProvider();
  const redirectUrl = `${process.env.FRONTEND_URL}/payment-status?merchantOrderId=${merchantOrderId}`;

  const initResult = await provider.initiatePayment({
    merchantOrderId,
    amountPaise,
    redirectUrl,
    description: `MLM joining ${merchantOrderId}`,
  });

  let payment;
  try {
    payment = await MlmJoiningPayment.create({
      _id: paymentId,
      customer: userId,
      gatewayName: provider.providerName,
      gatewayOrderId: merchantOrderId,
      paymentMode: MLM_PAYMENT_MODE.RAZORPAY,
      amountPaise,
      currency: "INR",
      status: PAYMENT_STATUS.PENDING,
      joiningPriceSnapshot: joiningPrice,
      shoppingCreditSnapshot: shoppingCredit,
      sponsorReferralCodeSnapshot: customer.pendingSponsorReferralCode || null,
      idempotencyKey: effectiveIdempotencyKey,
      rawGatewayResponse: {
        checkout: initResult.checkout,
        razorpayOrderId: initResult.gatewayOrderId,
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
  } catch (error) {
    // Same race backstop as the manual-QR branch above. The Razorpay
    // order this losing call created is simply left unused — a minor
    // resource leak, not a money-safety issue — while the customer
    // transparently gets the winning attempt's checkout session back.
    const existing = await duplicateJoiningPaymentFromRaceOrThrow(error, {
      userId,
      idempotencyKey: effectiveIdempotencyKey,
    });
    return {
      paymentId: String(existing._id),
      merchantOrderId: existing.gatewayOrderId,
      checkout: existing.rawGatewayResponse?.checkout || null,
      paymentMode: MLM_PAYMENT_MODE.RAZORPAY,
      duplicate: true,
    };
  }

  logger.info("mlm_joining_payment_created", {
    paymentId: payment._id.toString(),
    merchantOrderId,
    amountPaise,
    provider: provider.providerName,
    paymentMode: MLM_PAYMENT_MODE.RAZORPAY,
  });

  return {
    paymentId: String(payment._id),
    merchantOrderId,
    checkout: initResult.checkout,
    paymentMode: MLM_PAYMENT_MODE.RAZORPAY,
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
  const razorpayOrderId =
    payment.rawGatewayResponse?.razorpayOrderId ||
    payment.rawGatewayResponse?.checkout?.orderId ||
    null;
  const statusResp = await provider.getPaymentStatus({
    merchantOrderId,
    razorpayOrderId,
  });
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
 * Razorpay Standard Checkout client callback for MLM joining.
 */
export async function verifyJoiningCheckoutCallback({
  merchantOrderId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
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

  if (payment.paymentMode === MLM_PAYMENT_MODE.MANUAL_QR) {
    const err = new Error("Manual QR payments cannot use checkout callback");
    err.statusCode = 422;
    throw err;
  }

  const provider = getActivePaymentProvider();
  const ok = provider.verifyCheckoutSignature({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  });
  if (!ok) {
    const err = new Error("Invalid payment signature");
    err.statusCode = 401;
    err.code = "PAYMENT_SIGNATURE_INVALID";
    throw err;
  }

  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.CAPTURED,
    source: PAYMENT_EVENT_SOURCE.CLIENT_VERIFY,
    reason: `${provider.providerName} checkout signature verified`,
    gatewayPaymentId: razorpayPaymentId,
    rawGatewayResponse: {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    },
  });

  if (correlationId) {
    payment.correlationId = correlationId;
    await payment.save();
  }

  await handleStatusSideEffects(payment, PAYMENT_STATUS.CAPTURED);

  return {
    payment,
    status: PAYMENT_STATUS.CAPTURED,
    orderKind: "mlm_joining",
  };
}

/**
 * Process a gateway webhook event for an MLM joining payment.
 * Called by the unified webhook dispatcher in `paymentService.js`
 * after the merchantOrderId has already been resolved to a row in
 * this collection. The dispatcher owns webhook-event dedupe via
 * `PaymentWebhookEvent`.
 *
 * Manual-QR rows are immune to webhook-driven transitions: they
 * carry no real `gatewayPaymentId`, and any callback received against
 * one means a stray gateway event was misrouted. We short-circuit
 * with a structured `ignored` result so the dispatcher can ack the
 * webhook without mutating internal state.
 */
export async function processJoiningPaymentWebhook({
  payment,
  decoded,
  correlationId = null,
}) {
  if (payment.paymentMode === MLM_PAYMENT_MODE.MANUAL_QR) {
    logger.warn("mlm_joining_payment_webhook_ignored_manual_qr", {
      paymentId: payment._id.toString(),
      merchantOrderId: payment.gatewayOrderId,
      decodedState: decoded?.state || null,
    });
    return {
      ignored: true,
      reason: "manual_qr_payment",
      paymentStatus: payment.status,
      paymentId: payment._id.toString(),
    };
  }

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

/**
 * Manual-QR flow: customer submits transaction id + screenshot URL.
 * Asserts ownership + mode + status, stamps the proof, transitions
 * the row to PENDING_REVIEW, and notifies admins.
 *
 * Errors:
 *   - 404 PAYMENT_NOT_FOUND
 *   - 403 NOT_PAYMENT_OWNER
 *   - 422 NOT_MANUAL_QR
 *   - 409 INVALID_STATUS                (only CREATED -> PENDING_REVIEW allowed)
 *   - 422 TRANSACTION_ID_REQUIRED
 *   - 422 SCREENSHOT_REQUIRED
 */
export async function submitManualPaymentProof({
  paymentId,
  customerId,
  transactionId,
  screenshotUrl,
  paidAmount = null,
}) {
  if (!paymentId) {
    const err = new Error("paymentId is required");
    err.statusCode = 422;
    throw err;
  }

  const trimmedTxn = String(transactionId || "").trim().toUpperCase();
  if (!trimmedTxn) {
    const err = new Error("Transaction ID is required.");
    err.statusCode = 422;
    err.code = "TRANSACTION_ID_REQUIRED";
    throw err;
  }
  if (trimmedTxn.length < 4 || trimmedTxn.length > 64) {
    const err = new Error("Transaction ID looks invalid.");
    err.statusCode = 422;
    err.code = "TRANSACTION_ID_INVALID";
    throw err;
  }

  const trimmedScreenshot = String(screenshotUrl || "").trim();
  if (!trimmedScreenshot) {
    const err = new Error("Payment screenshot is required.");
    err.statusCode = 422;
    err.code = "SCREENSHOT_REQUIRED";
    throw err;
  }

  const payment = await MlmJoiningPayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Joining payment not found.");
    err.statusCode = 404;
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }

  if (String(payment.customer) !== String(customerId)) {
    const err = new Error("Not authorized to submit proof for this payment.");
    err.statusCode = 403;
    err.code = "NOT_PAYMENT_OWNER";
    throw err;
  }

  if (payment.paymentMode !== MLM_PAYMENT_MODE.MANUAL_QR) {
    const err = new Error("This payment is not a manual-QR submission.");
    err.statusCode = 422;
    err.code = "NOT_MANUAL_QR";
    throw err;
  }

  if (payment.status !== PAYMENT_STATUS.CREATED) {
    const err = new Error(
      payment.status === PAYMENT_STATUS.PENDING_REVIEW
        ? "Proof has already been submitted; awaiting admin review."
        : `Cannot submit proof for a ${payment.status} payment.`,
    );
    err.statusCode = 409;
    err.code = "INVALID_STATUS";
    throw err;
  }

  payment.manualPaymentDetails = {
    transactionId: trimmedTxn,
    screenshotUrl: trimmedScreenshot,
    paidAmount:
      paidAmount != null && Number.isFinite(Number(paidAmount))
        ? Number(paidAmount)
        : payment.joiningPriceSnapshot,
    submittedAt: new Date(),
  };

  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.PENDING_REVIEW,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: "Customer submitted manual payment proof",
  });

  try {
    emitNotificationEvent(NOTIFICATION_EVENTS.MLM_JOINING_PROOF_SUBMITTED, {
      customerId: payment.customer,
      paymentId: payment._id.toString(),
      transactionId: trimmedTxn,
    });
  } catch (_) {
    /* non-fatal */
  }

  logger.info("mlm_joining_payment_proof_submitted", {
    paymentId: payment._id.toString(),
    customerId: String(customerId),
    transactionIdMasked: trimmedTxn.slice(0, 4) + "***",
  });

  return payment;
}

/**
 * Admin approves a manual-QR joining payment. Transitions the row to
 * CAPTURED, which fires the existing `handleStatusSideEffects` ->
 * `activateMembershipFromJoiningPayment` chain. Idempotent (double
 * click = no-op via state-machine + activationApplied guard).
 */
export async function approveManualJoiningPayment({
  paymentId,
  adminId,
  adminRemarks = "",
}) {
  if (!paymentId) {
    const err = new Error("paymentId is required");
    err.statusCode = 422;
    throw err;
  }
  if (!adminId) {
    const err = new Error("adminId is required");
    err.statusCode = 401;
    throw err;
  }

  const payment = await MlmJoiningPayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Joining payment not found.");
    err.statusCode = 404;
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }

  if (payment.paymentMode !== MLM_PAYMENT_MODE.MANUAL_QR) {
    const err = new Error("Only manual-QR payments require admin approval.");
    err.statusCode = 422;
    err.code = "NOT_MANUAL_QR";
    throw err;
  }

  // Allow approving from PENDING_REVIEW. CAPTURED -> CAPTURED is a
  // no-op via the transitionStatus same-status branch which keeps
  // the activationApplied guard the source of truth on idempotency.
  if (
    payment.status !== PAYMENT_STATUS.PENDING_REVIEW &&
    payment.status !== PAYMENT_STATUS.CAPTURED
  ) {
    const err = new Error(
      `Cannot approve a payment in status ${payment.status}.`,
    );
    err.statusCode = 409;
    err.code = "INVALID_STATUS";
    throw err;
  }

  payment.reviewedBy = adminId;
  payment.reviewedAt = new Date();
  if (adminRemarks) payment.adminRemarks = String(adminRemarks).slice(0, 1000);

  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.CAPTURED,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: `Admin approved manual payment${adminRemarks ? `: ${adminRemarks}` : ""}`,
  });

  const sideEffects = await handleStatusSideEffects(payment, PAYMENT_STATUS.CAPTURED);
  if (sideEffects.activationError) {
    const err = new Error(
      `Payment approved but Plan A activation failed: ${sideEffects.activationError}`,
    );
    err.statusCode = 500;
    err.code = "ACTIVATION_FAILED";
    throw err;
  }

  try {
    emitNotificationEvent(NOTIFICATION_EVENTS.MLM_JOINING_PROOF_APPROVED, {
      customerId: payment.customer,
      userId: payment.customer,
      paymentId: payment._id.toString(),
    });
  } catch (_) {
    /* non-fatal */
  }

  logger.info("mlm_joining_payment_approved", {
    paymentId: payment._id.toString(),
    adminId: String(adminId),
    shoppingCreditAmount: sideEffects.activation?.shoppingCreditAmount || 0,
  });

  payment._activationSummary = sideEffects.activation || null;
  return payment;
}

/**
 * Admin rejects a manual-QR joining payment. Transitions the row to
 * FAILED with a captured reason; customer can retry by initiating a
 * fresh joining payment (which mints a new row).
 */
export async function rejectManualJoiningPayment({
  paymentId,
  adminId,
  reason,
}) {
  if (!paymentId) {
    const err = new Error("paymentId is required");
    err.statusCode = 422;
    throw err;
  }
  if (!adminId) {
    const err = new Error("adminId is required");
    err.statusCode = 401;
    throw err;
  }
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason || trimmedReason.length < 3) {
    const err = new Error("Rejection reason is required (>=3 characters).");
    err.statusCode = 422;
    err.code = "REASON_REQUIRED";
    throw err;
  }

  const payment = await MlmJoiningPayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Joining payment not found.");
    err.statusCode = 404;
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }

  if (payment.paymentMode !== MLM_PAYMENT_MODE.MANUAL_QR) {
    const err = new Error("Only manual-QR payments can be rejected here.");
    err.statusCode = 422;
    err.code = "NOT_MANUAL_QR";
    throw err;
  }

  if (
    payment.status !== PAYMENT_STATUS.PENDING_REVIEW &&
    payment.status !== PAYMENT_STATUS.CREATED
  ) {
    const err = new Error(
      `Cannot reject a payment in status ${payment.status}.`,
    );
    err.statusCode = 409;
    err.code = "INVALID_STATUS";
    throw err;
  }

  payment.reviewedBy = adminId;
  payment.reviewedAt = new Date();
  payment.adminRemarks = trimmedReason.slice(0, 1000);
  payment.failureReason = trimmedReason.slice(0, 1000);

  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.FAILED,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: `Admin rejected manual payment: ${trimmedReason}`,
  });

  try {
    emitNotificationEvent(NOTIFICATION_EVENTS.MLM_JOINING_PROOF_REJECTED, {
      customerId: payment.customer,
      userId: payment.customer,
      paymentId: payment._id.toString(),
      reason: trimmedReason,
    });
  } catch (_) {
    /* non-fatal */
  }

  logger.info("mlm_joining_payment_rejected", {
    paymentId: payment._id.toString(),
    adminId: String(adminId),
  });

  return payment;
}

/**
 * Customer-facing fetch: return the latest non-terminal manual-QR
 * payment for the given customer (CREATED, PENDING_REVIEW, or the
 * most recent FAILED row if no open intent exists). Used by the
 * dashboard to render "resume / under review / try again" banners.
 *
 * Returns null when the customer has no relevant manual-QR row.
 */
export async function getLatestPendingJoiningPaymentForCustomer(customerId) {
  if (!customerId) return null;

  const open = await MlmJoiningPayment.findOne({
    customer: customerId,
    paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
    status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING_REVIEW] },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (open) return open;

  // Surface the most recent FAILED row only if there's no later
  // CAPTURED row (i.e., customer hasn't recovered with a new attempt).
  const lastTerminal = await MlmJoiningPayment.findOne({
    customer: customerId,
    paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
  })
    .sort({ createdAt: -1 })
    .lean();
  if (
    lastTerminal &&
    lastTerminal.status === PAYMENT_STATUS.FAILED
  ) {
    return lastTerminal;
  }
  return null;
}

/**
 * Read a single manual-QR payment with ownership enforcement. Used
 * by the customer ManualPaymentPage status poller.
 */
export async function getManualJoiningPaymentForCustomer({
  paymentId,
  customerId,
}) {
  const payment = await MlmJoiningPayment.findById(paymentId).lean();
  if (!payment) {
    const err = new Error("Joining payment not found.");
    err.statusCode = 404;
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }
  if (String(payment.customer) !== String(customerId)) {
    const err = new Error("Not authorized to view this payment.");
    err.statusCode = 403;
    err.code = "NOT_PAYMENT_OWNER";
    throw err;
  }
  return payment;
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
