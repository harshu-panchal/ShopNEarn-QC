/**
 * Home Shoppy franchise constants.
 *
 * Decision gates (plan defaults — G1 separate from MLM Home Shopping):
 *   G1: Keep MLM Home Shopping unchanged
 *   G2: Pincode territory routing
 *   G3: Franchise fulfills from wallet-purchased stock
 *   G4: B2B stock purchase from Harsh's Hub catalog
 *
 * Franchise partners use the existing Customer account + franchise role.
 * ₹10,000 registration is one-time; wallet top-ups are separate deposits.
 */

export const FRANCHISE_PARTNER_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  TERMINATED: "terminated",
};

export const ALL_FRANCHISE_PARTNER_STATUSES = Object.values(
  FRANCHISE_PARTNER_STATUS,
);

export const FRANCHISE_ORDER_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  FULFILLED: "fulfilled",
};

export const ALL_FRANCHISE_ORDER_STATUSES = Object.values(
  FRANCHISE_ORDER_STATUS,
);

/** Legacy hub-confirmation step (deprecated — partners self-fulfill). */
export const FRANCHISE_HUB_ACCEPTANCE_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
};

export const ALL_FRANCHISE_HUB_ACCEPTANCE_STATUSES = Object.values(
  FRANCHISE_HUB_ACCEPTANCE_STATUS,
);

/** Franchise partner creates shipment after accepting (no hub confirmation). */
export const FRANCHISE_SHIPMENT_STATUS = {
  PENDING: "pending",
  CREATED: "created",
};

export const ALL_FRANCHISE_SHIPMENT_STATUSES = Object.values(
  FRANCHISE_SHIPMENT_STATUS,
);

export const FRANCHISE_PAYMENT_MODE = {
  RAZORPAY: "razorpay",
  MANUAL_QR: "manual_qr",
};

export const ALL_FRANCHISE_PAYMENT_MODES = Object.values(
  FRANCHISE_PAYMENT_MODE,
);

export const FRANCHISE_TOPUP_STATUS = {
  CREATED: "created",
  PENDING_REVIEW: "pending_review",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export const ALL_FRANCHISE_TOPUP_STATUSES = Object.values(
  FRANCHISE_TOPUP_STATUS,
);

export const FRANCHISE_IDEMPOTENCY_PREFIX = {
  REGISTRATION_ACTIVATED: "FRANCHISE-REG-ACTIVATED",
  TOPUP_CREDIT: "FRANCHISE-TOPUP-CREDIT",
  STOCK_PURCHASE: "FRANCHISE-STOCK",
  MANUAL_ADJUSTMENT: "FRANCHISE-MANUAL-ADJ",
  POS_SALE: "FRANCHISE-POS",
};

export const FRANCHISE_POS_PAYMENT_METHOD = {
  CASH: "cash",
  UPI_PARTNER: "upi_partner",
  SHOPPING_WALLET: "shopping_wallet",
  EARNINGS_WALLET: "earnings_wallet",
};

export const ALL_FRANCHISE_POS_PAYMENT_METHODS = Object.values(
  FRANCHISE_POS_PAYMENT_METHOD,
);

export const FRANCHISE_POS_BUYER_KIND = {
  GUEST: "guest",
  REGISTERED: "registered",
};

/** Reserved phone for the platform walk-in POS customer User document. */
export const FRANCHISE_POS_WALKIN_PHONE = "+910000009999";

export const FRANCHISE_MERCHANT_PREFIX = {
  REGISTRATION: "FRANCHISE-REG",
  TOPUP: "FRANCHISE-TOPUP",
};

export const FRANCHISE_DEFAULTS = {
  enabled: true,
  registrationPrice: 10000,
  walletCreditMultiplier: 2,
  registrationPaymentMode: FRANCHISE_PAYMENT_MODE.MANUAL_QR,
  hubSellerId: null,
  hubShopDisplayName: "Harsh's Hub",
  posEnabled: false,
  posShowOutOfStockInCatalog: true,
};
