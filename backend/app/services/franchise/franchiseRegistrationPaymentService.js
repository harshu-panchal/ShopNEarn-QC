import crypto from "crypto";
import mongoose from "mongoose";
import FranchiseRegistrationPayment from "../../models/franchiseRegistrationPayment.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Customer from "../../models/customer.js";
import {
  FRANCHISE_MERCHANT_PREFIX,
  FRANCHISE_PARTNER_STATUS,
  FRANCHISE_PAYMENT_MODE,
} from "../../constants/franchise.js";
import {
  PAYMENT_EVENT_SOURCE,
  PAYMENT_GATEWAY,
  PAYMENT_STATUS,
  canTransitionPaymentStatus,
} from "../../constants/payment.js";
import { getActivePaymentProvider } from "../payment/providerRegistry.js";
import { getManualQrConfig } from "../mlm/mlmConfigService.js";
import { getFranchiseConfig } from "./franchiseConfigService.js";
import { parseFranchiseRegistrationAddress } from "./franchiseAddressUtils.js";
import { activateFranchiseFromRegistrationPayment } from "./franchiseActivationService.js";
import logger from "../logger.js";

const MAX_MERCHANT_ORDER_ID_LENGTH = 63;

function sanitizeMerchantOrderIdPart(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildMerchantOrderId(prefix, paymentId, attemptCount = 1) {
  const normalizedBase = sanitizeMerchantOrderIdPart(paymentId) || "PAY";
  const suffix = `-A${Math.max(1, Number(attemptCount) || 1)}`;
  const fullPrefix = `${prefix}-`;
  const maxBaseLength = MAX_MERCHANT_ORDER_ID_LENGTH - fullPrefix.length - suffix.length;
  return `${fullPrefix}${normalizedBase.slice(0, Math.max(1, maxBaseLength))}${suffix}`;
}

export function isFranchiseRegMerchantOrderId(merchantOrderId) {
  return String(merchantOrderId || "")
    .trim()
    .toUpperCase()
    .startsWith(`${FRANCHISE_MERCHANT_PREFIX.REGISTRATION}-`);
}

export function isFranchiseTopupMerchantOrderId(merchantOrderId) {
  return String(merchantOrderId || "")
    .trim()
    .toUpperCase()
    .startsWith(`${FRANCHISE_MERCHANT_PREFIX.TOPUP}-`);
}

async function transitionStatus(payment, { nextStatus, source, reason = "", gatewayPaymentId = null, rawGatewayResponse = null }) {
  const currentStatus = payment.status || PAYMENT_STATUS.CREATED;
  if (currentStatus === nextStatus) {
    if (gatewayPaymentId && !payment.gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
    await payment.save();
    return payment;
  }
  if (!canTransitionPaymentStatus(currentStatus, nextStatus)) {
    const err = new Error(`Invalid franchise registration transition ${currentStatus} -> ${nextStatus}`);
    err.statusCode = 409;
    throw err;
  }
  payment.status = nextStatus;
  if (gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
  if (rawGatewayResponse) {
    payment.rawGatewayResponse = { ...(payment.rawGatewayResponse || {}), ...rawGatewayResponse };
  }
  payment.statusHistory.push({
    fromStatus: currentStatus,
    toStatus: nextStatus,
    source,
    reason,
    changedAt: new Date(),
  });
  if (nextStatus === PAYMENT_STATUS.CAPTURED) payment.capturedAt = new Date();
  if (nextStatus === PAYMENT_STATUS.FAILED) {
    payment.failedAt = new Date();
    payment.failureReason = reason || payment.failureReason;
  }
  await payment.save();
  return payment;
}

async function handleCaptured(payment) {
  try {
    await activateFranchiseFromRegistrationPayment(payment._id);
  } catch (error) {
    payment.activationError = error.message;
    await payment.save();
    logger.error("[franchiseRegistration] activation failed", {
      paymentId: String(payment._id),
      error: error.message,
    });
  }
}

export async function initiateFranchiseRegistrationPayment({
  userId,
  idempotencyKey = null,
  territoryPincodes = [],
  address,
  locality,
  pincode,
  city,
  state,
  lat,
  lng,
}) {
  if (!userId) {
    const err = new Error("Authentication required");
    err.statusCode = 401;
    throw err;
  }

  const cfg = await getFranchiseConfig();
  if (!cfg.enabled) {
    const err = new Error("Home Shoppy franchise is not active yet.");
    err.statusCode = 422;
    throw err;
  }

  const price = Number(cfg.registrationPrice) || 0;
  if (price <= 0) {
    const err = new Error("Registration price is not configured.");
    err.statusCode = 422;
    throw err;
  }

  const existing = await FranchisePartner.findOne({
    userId,
    status: { $in: [FRANCHISE_PARTNER_STATUS.ACTIVE, FRANCHISE_PARTNER_STATUS.SUSPENDED] },
  }).lean();
  if (existing) {
    const err = new Error("You are already a franchise partner.");
    err.statusCode = 409;
    throw err;
  }

  const customer = await Customer.findById(userId, { name: 1, phone: 1 }).lean();
  if (!customer) {
    const err = new Error("Customer profile not found.");
    err.statusCode = 404;
    throw err;
  }

  const paymentMode =
    cfg.registrationPaymentMode === FRANCHISE_PAYMENT_MODE.RAZORPAY ||
    cfg.registrationPaymentMode === "phonepe"
      ? FRANCHISE_PAYMENT_MODE.RAZORPAY
      : FRANCHISE_PAYMENT_MODE.MANUAL_QR;
  const isManualQr = paymentMode === FRANCHISE_PAYMENT_MODE.MANUAL_QR;
  const effectiveIdempotencyKey =
    idempotencyKey || `franchise-reg-${userId}-${crypto.randomBytes(6).toString("hex")}`;

  const existingForKey = await FranchiseRegistrationPayment.findOne({
    customer: userId,
    idempotencyKey: effectiveIdempotencyKey,
  });
  if (existingForKey) {
    return {
      paymentId: String(existingForKey._id),
      merchantOrderId: existingForKey.gatewayOrderId,
      checkout: existingForKey.rawGatewayResponse?.checkout || null,
      redirectUrl: existingForKey.rawGatewayResponse?.redirectUrl,
      paymentMode: existingForKey.paymentMode,
      duplicate: true,
    };
  }

  const openStatuses = isManualQr
    ? [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING_REVIEW]
    : [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING];

  const existingOpen = await FranchiseRegistrationPayment.findOne({
    customer: userId,
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
      redirectUrl: existingOpen.rawGatewayResponse?.redirectUrl,
      paymentMode,
      manualQr: isManualQr ? await getManualQrConfig() : undefined,
      duplicate: true,
    };
  }

  const amountPaise = Math.round(price * 100);
  const paymentId = new mongoose.Types.ObjectId();
  const attemptCount =
    (await FranchiseRegistrationPayment.countDocuments({ customer: userId })) + 1;
  const merchantOrderId = buildMerchantOrderId(
    FRANCHISE_MERCHANT_PREFIX.REGISTRATION,
    paymentId.toString(),
    attemptCount,
  );

  const { snapshot: addressSnapshot, territoryPincodes: pincodes } =
    parseFranchiseRegistrationAddress({
      address,
      locality,
      pincode,
      city,
      state,
      lat,
      lng,
      territoryPincodes,
    });

  if (isManualQr) {
    const manualQr = await getManualQrConfig();
    const redirectUrl = `${process.env.FRONTEND_URL || ""}/mlm/franchise/register/payment/${paymentId.toString()}`;
    const payment = await FranchiseRegistrationPayment.create({
      _id: paymentId,
      customer: userId,
      gatewayName: PAYMENT_GATEWAY.MANUAL_QR,
      gatewayOrderId: merchantOrderId,
      paymentMode: FRANCHISE_PAYMENT_MODE.MANUAL_QR,
      amountPaise,
      registrationPriceSnapshot: price,
      territoryPincodesSnapshot: pincodes,
      addressSnapshot,
      idempotencyKey: effectiveIdempotencyKey,
      rawGatewayResponse: { redirectUrl, merchantOrderId, manualQrSnapshot: manualQr },
      statusHistory: [
        {
          fromStatus: PAYMENT_STATUS.CREATED,
          toStatus: PAYMENT_STATUS.CREATED,
          source: PAYMENT_EVENT_SOURCE.SYSTEM,
          reason: "Franchise registration manual QR intent",
        },
      ],
    });
    return {
      paymentId: String(payment._id),
      merchantOrderId,
      redirectUrl,
      paymentMode: FRANCHISE_PAYMENT_MODE.MANUAL_QR,
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
    description: `Franchise registration ${merchantOrderId}`,
  });

  const payment = await FranchiseRegistrationPayment.create({
    _id: paymentId,
    customer: userId,
    gatewayName: provider.providerName,
    gatewayOrderId: merchantOrderId,
    paymentMode: FRANCHISE_PAYMENT_MODE.RAZORPAY,
    amountPaise,
    status: PAYMENT_STATUS.PENDING,
    registrationPriceSnapshot: price,
    territoryPincodesSnapshot: pincodes,
    addressSnapshot,
    idempotencyKey: effectiveIdempotencyKey,
    rawGatewayResponse: {
      checkout: initResult.checkout,
      razorpayOrderId: initResult.gatewayOrderId,
      merchantOrderId,
    },
    statusHistory: [
      {
        fromStatus: PAYMENT_STATUS.CREATED,
        toStatus: PAYMENT_STATUS.PENDING,
        source: PAYMENT_EVENT_SOURCE.SYSTEM,
        reason: "Franchise registration Razorpay initiated",
      },
    ],
  });

  return {
    paymentId: String(payment._id),
    merchantOrderId,
    checkout: initResult.checkout,
    paymentMode: FRANCHISE_PAYMENT_MODE.RAZORPAY,
    duplicate: false,
  };
}

export async function verifyFranchiseRegistrationPaymentStatus({ merchantOrderId, userId }) {
  const payment = await FranchiseRegistrationPayment.findOne({ gatewayOrderId: merchantOrderId });
  if (!payment) {
    const err = new Error("Registration payment not found");
    err.statusCode = 404;
    throw err;
  }
  if (userId && String(payment.customer) !== String(userId)) {
    const err = new Error("Not authorized");
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
    reason: `Status check: ${statusResp.state}`,
    gatewayPaymentId: statusResp.transactionId,
    rawGatewayResponse: statusResp.gatewayResponse,
  });
  if (nextStatus === PAYMENT_STATUS.CAPTURED) await handleCaptured(payment);
  return { payment, status: nextStatus, orderKind: "franchise_registration" };
}

export async function verifyFranchiseRegistrationCheckoutCallback({
  merchantOrderId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  userId,
}) {
  const payment = await FranchiseRegistrationPayment.findOne({
    gatewayOrderId: merchantOrderId,
  });
  if (!payment) {
    const err = new Error("Registration payment not found");
    err.statusCode = 404;
    throw err;
  }
  if (userId && String(payment.customer) !== String(userId)) {
    const err = new Error("Not authorized");
    err.statusCode = 403;
    throw err;
  }
  if (payment.paymentMode === FRANCHISE_PAYMENT_MODE.MANUAL_QR) {
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
  await handleCaptured(payment);
  return {
    payment,
    status: PAYMENT_STATUS.CAPTURED,
    orderKind: "franchise_registration",
  };
}

export async function processFranchiseRegistrationWebhook({ payment, decoded }) {
  if (payment.paymentMode === FRANCHISE_PAYMENT_MODE.MANUAL_QR) {
    return { ignored: true, paymentStatus: payment.status };
  }
  const provider = getActivePaymentProvider();
  const nextStatus = provider.mapStatusToInternal(decoded.state);
  await transitionStatus(payment, {
    nextStatus,
    source: PAYMENT_EVENT_SOURCE.WEBHOOK,
    reason: `Webhook: ${decoded.state}`,
    gatewayPaymentId: decoded.transactionId,
    rawGatewayResponse: decoded.raw,
  });
  if (nextStatus === PAYMENT_STATUS.CAPTURED) await handleCaptured(payment);
  return { paymentStatus: nextStatus, paymentId: String(payment._id) };
}

export async function submitFranchiseRegistrationProof({ userId, paymentId, transactionId, screenshotUrl, paidAmount }) {
  const payment = await FranchiseRegistrationPayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Payment not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(payment.customer) !== String(userId)) {
    const err = new Error("Not authorized");
    err.statusCode = 403;
    throw err;
  }
  if (payment.paymentMode !== FRANCHISE_PAYMENT_MODE.MANUAL_QR) {
    const err = new Error("Not a manual payment");
    err.statusCode = 422;
    throw err;
  }
  if (!transactionId?.trim()) {
    const err = new Error("Transaction ID is required");
    err.statusCode = 422;
    throw err;
  }
  if (!screenshotUrl?.trim()) {
    const err = new Error("Payment screenshot is required");
    err.statusCode = 422;
    throw err;
  }
  payment.manualPaymentDetails = {
    transactionId: String(transactionId).trim(),
    screenshotUrl: String(screenshotUrl).trim(),
    paidAmount: paidAmount != null ? Number(paidAmount) : null,
    submittedAt: new Date(),
  };
  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.PENDING_REVIEW,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: "Proof submitted",
  });
  return payment;
}

export async function getFranchiseRegistrationPaymentForCustomer(userId, paymentId) {
  const payment = await FranchiseRegistrationPayment.findById(paymentId).lean();
  if (!payment || String(payment.customer) !== String(userId)) return null;
  return payment;
}

function buildRegistrationPaymentPath(paymentId) {
  return `/mlm/franchise/register/payment/${String(paymentId)}`;
}

function summarizeRegistrationPayment(payment) {
  const paymentId = String(payment._id);
  const manualPath = `${process.env.FRONTEND_URL || ""}${buildRegistrationPaymentPath(paymentId)}`;
  return {
    paymentId,
    status: payment.status,
    registrationPriceSnapshot: payment.registrationPriceSnapshot,
    paymentMode: payment.paymentMode,
    redirectUrl:
      payment.rawGatewayResponse?.redirectUrl ||
      (payment.paymentMode === FRANCHISE_PAYMENT_MODE.MANUAL_QR ? manualPath : null),
    submittedAt: payment.manualPaymentDetails?.submittedAt || null,
    adminRemarks: payment.adminRemarks || payment.failureReason || "",
  };
}

/**
 * Customer-facing registration lifecycle (distinct from active partner record).
 */
export async function getFranchiseRegistrationStateForCustomer(userId) {
  const activePartner = await FranchisePartner.findOne({
    userId,
    status: {
      $in: [FRANCHISE_PARTNER_STATUS.ACTIVE, FRANCHISE_PARTNER_STATUS.SUSPENDED],
    },
  })
    .select("_id status")
    .lean();

  if (activePartner) {
    return { phase: "active" };
  }

  const latest = await FranchiseRegistrationPayment.findOne({ customer: userId })
    .sort({ createdAt: -1 })
    .lean();

  if (!latest) {
    return { phase: "none" };
  }

  const payment = summarizeRegistrationPayment(latest);

  if (latest.status === PAYMENT_STATUS.PENDING_REVIEW) {
    return { phase: "pending_review", payment };
  }

  if ([PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING].includes(latest.status)) {
    return { phase: "pending_payment", payment };
  }

  if ([PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELLED].includes(latest.status)) {
    return { phase: "rejected", payment };
  }

  if (latest.status === PAYMENT_STATUS.CAPTURED) {
    return { phase: "activating", payment };
  }

  return { phase: "none" };
}

export async function approveFranchiseRegistrationPayment({ paymentId, adminId, adminRemarks }) {
  const payment = await FranchiseRegistrationPayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Payment not found");
    err.statusCode = 404;
    throw err;
  }
  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.CAPTURED,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: adminRemarks || "Approved by admin",
  });
  payment.reviewedAt = new Date();
  payment.reviewedBy = adminId || null;
  payment.adminRemarks = adminRemarks || "";
  await payment.save();
  await handleCaptured(payment);
  return payment;
}

export async function rejectFranchiseRegistrationPayment({ paymentId, adminId, reason }) {
  const payment = await FranchiseRegistrationPayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Payment not found");
    err.statusCode = 404;
    throw err;
  }
  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.FAILED,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: reason || "Rejected",
  });
  payment.reviewedAt = new Date();
  payment.reviewedBy = adminId || null;
  payment.adminRemarks = reason || "";
  return payment;
}

export async function listFranchiseRegistrationReviews({ status, page = 1, limit = 25, q } = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const filter = {};
  if (status && status !== "ALL") filter.status = status;
  else if (!status) filter.status = PAYMENT_STATUS.PENDING_REVIEW;

  let items = await FranchiseRegistrationPayment.find(filter)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(safeLimit)
    .lean();
  const total = await FranchiseRegistrationPayment.countDocuments(filter);

  if (q) {
    const needle = String(q).toLowerCase();
    const customerIds = [...new Set(items.map((i) => String(i.customer)))];
    const customers = await Customer.find({ _id: { $in: customerIds } }, { name: 1, phone: 1, email: 1 }).lean();
    const cmap = new Map(customers.map((c) => [String(c._id), c]));
    items = items.filter((row) => {
      const c = cmap.get(String(row.customer)) || {};
      const txn = row.manualPaymentDetails?.transactionId || "";
      return (
        (c.name || "").toLowerCase().includes(needle) ||
        (c.phone || "").toLowerCase().includes(needle) ||
        txn.toLowerCase().includes(needle)
      );
    });
  }

  return { items, page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 };
}
