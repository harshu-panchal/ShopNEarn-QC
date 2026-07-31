export const PAYMENT_GATEWAY = {
  RAZORPAY: "RAZORPAY",
  // Kept for historical Payment / webhook rows only — do not write on new docs.
  PHONEPE: "PHONEPE",
  // Manual / out-of-band payment captured by the merchant (MLM joining /
  // franchise registration fallback). Has no real provider integration;
  // the customer pays via a static UPI QR and submits proof for admin review.
  MANUAL_QR: "MANUAL_QR",
};

export const PAYMENT_STATUS = {
  CREATED: "CREATED",
  PENDING: "PENDING",
  // Customer has submitted out-of-band payment proof (txn id +
  // screenshot for the manual-QR flow). Admin must explicitly approve
  // (-> CAPTURED) or reject (-> FAILED). Only legal for manual-QR
  // payments; the gateway-driven flow never enters this state.
  PENDING_REVIEW: "PENDING_REVIEW",
  AUTHORIZED: "AUTHORIZED",
  CAPTURED: "CAPTURED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  CANCELLED: "CANCELLED",
};

export const PAYMENT_EVENT_SOURCE = {
  CLIENT_VERIFY: "CLIENT_VERIFY",
  WEBHOOK: "WEBHOOK",
  SYSTEM: "SYSTEM",
};

export const ALL_PAYMENT_GATEWAYS = Object.values(PAYMENT_GATEWAY);
export const ALL_PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);
export const ALL_PAYMENT_EVENT_SOURCES = Object.values(PAYMENT_EVENT_SOURCE);

const TRANSITIONS = {
  [PAYMENT_STATUS.CREATED]: new Set([
    PAYMENT_STATUS.PENDING,
    PAYMENT_STATUS.PENDING_REVIEW,
    PAYMENT_STATUS.AUTHORIZED,
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
  ]),
  [PAYMENT_STATUS.PENDING]: new Set([
    PAYMENT_STATUS.AUTHORIZED,
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
  ]),
  [PAYMENT_STATUS.PENDING_REVIEW]: new Set([
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
  ]),
  [PAYMENT_STATUS.AUTHORIZED]: new Set([
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.REFUNDED,
  ]),
  [PAYMENT_STATUS.CAPTURED]: new Set([PAYMENT_STATUS.REFUNDED]),
  [PAYMENT_STATUS.FAILED]: new Set(),
  [PAYMENT_STATUS.CANCELLED]: new Set(),
  [PAYMENT_STATUS.REFUNDED]: new Set(),
};

export function canTransitionPaymentStatus(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return false;
  if (fromStatus === toStatus) return true;
  return TRANSITIONS[fromStatus]?.has(toStatus) || false;
}
