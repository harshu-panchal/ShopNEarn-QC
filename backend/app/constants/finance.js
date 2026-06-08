export const CURRENCY = "INR";

export const PAYMENT_MODE = {
  ONLINE: "ONLINE",
  COD: "COD",
};

export const ORDER_PAYMENT_STATUS = {
  CREATED: "CREATED",
  PENDING_CASH_COLLECTION: "PENDING_CASH_COLLECTION",
  PAID: "PAID",
  CASH_COLLECTED: "CASH_COLLECTED",
  PARTIALLY_REMITTED: "PARTIALLY_REMITTED",
  COD_RECONCILED: "COD_RECONCILED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
};

export const ORDER_SETTLEMENT_STATUS = {
  PENDING: "PENDING",
  PARTIAL: "PARTIAL",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
};

export const OWNER_TYPE = {
  ADMIN: "ADMIN",
  SELLER: "SELLER",
  DELIVERY_PARTNER: "DELIVERY_PARTNER",
  CUSTOMER: "CUSTOMER",
};

export const WALLET_STATUS = {
  ACTIVE: "ACTIVE",
  FROZEN: "FROZEN",
  CLOSED: "CLOSED",
};

export const LEDGER_DIRECTION = {
  CREDIT: "CREDIT",
  DEBIT: "DEBIT",
};

export const LEDGER_STATUS = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
};

export const LEDGER_TRANSACTION_TYPE = {
  ORDER_ONLINE_PAYMENT_CAPTURED: "ORDER_ONLINE_PAYMENT_CAPTURED",
  ORDER_COD_COLLECTED: "ORDER_COD_COLLECTED",
  SELLER_PAYOUT_PENDING: "SELLER_PAYOUT_PENDING",
  SELLER_PAYOUT_PROCESSED: "SELLER_PAYOUT_PROCESSED",
  RIDER_PAYOUT_PENDING: "RIDER_PAYOUT_PENDING",
  RIDER_PAYOUT_PROCESSED: "RIDER_PAYOUT_PROCESSED",
  ADMIN_EARNING_CREDITED: "ADMIN_EARNING_CREDITED",
  COD_REMITTED: "COD_REMITTED",
  REFUND: "REFUND",
  ADJUSTMENT: "ADJUSTMENT",
  WITHDRAWAL: "WITHDRAWAL",
  CANCELLATION_REVERSAL: "CANCELLATION_REVERSAL",
  WALLET_REFUND: "WALLET_REFUND",
  // Audit Phase 1 (H-1): emitted by `cancelPendingPayoutForOrder` when a
  // pending seller/rider payout is reversed due to a return or order
  // cancellation. The ledger row debits the beneficiary's pending bucket
  // so the audit log reflects the reversal. Without this enum value the
  // ledger write inside `cancelPendingPayoutForOrder` threw a Mongoose
  // ValidationError and silently aborted the refund flow.
  PAYOUT_CANCELLED: "PAYOUT_CANCELLED",
  // Audit Phase 4 (H-5): emitted by `placeOrderAtomic` when a customer
  // redeems wallet balance at checkout. Previously the wallet debit only
  // wrote a legacy `Transaction({type:"Wallet Payment"})` row and mutated
  // `User.walletBalance` directly — the canonical `Wallet` document and
  // the `LedgerEntry` collection were both bypassed, leaving every
  // wallet-using customer in permanent drift between the two ledgers.
  WALLET_PAYMENT: "WALLET_PAYMENT",
  // MLM feature (Phase 1+): every customer-side bonus, milestone reward,
  // wallet seed, withdrawal charge and reversal gets its own ledger
  // type so the admin audit ledger can filter & reconcile cleanly.
  MLM_DIRECT_REFERRAL_MILESTONE: "MLM_DIRECT_REFERRAL_MILESTONE",
  // Plan A binary pair-matching bonus — paid every time the sponsor
  // completes a new pair of direct referrals (one in left subtree, one
  // in right subtree). Replaces the legacy
  // `MLM_DIRECT_REFERRAL_MILESTONE` payout for new credits; that ledger
  // type is retained only so historical rows continue to deserialise.
  MLM_BINARY_PAIR_MATCH: "MLM_BINARY_PAIR_MATCH",
  MLM_REPURCHASE_BONUS: "MLM_REPURCHASE_BONUS",
  MLM_MENTOR_ROYALTY: "MLM_MENTOR_ROYALTY",
  MLM_HOME_SHOPPING_SALES: "MLM_HOME_SHOPPING_SALES",
  MLM_HOME_SHOPPING_REFERRAL: "MLM_HOME_SHOPPING_REFERRAL",
  MLM_HOME_SHOPPING_ROYALTY: "MLM_HOME_SHOPPING_ROYALTY",
  MLM_JOINING_PACKAGE_SHOPPING_CREDIT: "MLM_JOINING_PACKAGE_SHOPPING_CREDIT",
  MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT: "MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT",
  MLM_GIFT_VOUCHER_MILESTONE: "MLM_GIFT_VOUCHER_MILESTONE",
  MLM_BONUS_CLAWBACK_ON_RETURN: "MLM_BONUS_CLAWBACK_ON_RETURN",
  MLM_BONUS_CAPPED_ROLLOVER: "MLM_BONUS_CAPPED_ROLLOVER",
  MLM_WITHDRAWAL_GROSS_DEBIT: "MLM_WITHDRAWAL_GROSS_DEBIT",
  MLM_WITHDRAWAL_ADMIN_CHARGE: "MLM_WITHDRAWAL_ADMIN_CHARGE",
  MLM_WITHDRAWAL_GST_CHARGE: "MLM_WITHDRAWAL_GST_CHARGE",
  MLM_WITHDRAWAL_NET_PAYOUT_QUEUED: "MLM_WITHDRAWAL_NET_PAYOUT_QUEUED",
  MLM_WITHDRAWAL_REVERSAL: "MLM_WITHDRAWAL_REVERSAL",
  MLM_MANUAL_ADJUSTMENT: "MLM_MANUAL_ADJUSTMENT",
  // MLM Phase 2: emitted by `returnWindowReleaseJob` when an MLM bonus
  // moves from the recipient's `pending` bucket to their `earnings`
  // bucket once the source order's return window has expired without
  // a return claim. Each release writes a paired DEBIT(pending) +
  // CREDIT(earnings) row carrying the same idempotency root.
  MLM_BONUS_RELEASED: "MLM_BONUS_RELEASED",
  // Customer-MLM-rebuild Phase 4: informational ledger row written
  // when a pair-match bonus is queued for a sponsor whose direct
  // referral is still `REGISTERED_UNPAID`. Amount stays 0 on the
  // wallet but the row creates an audit trail tying the held event
  // back to the sponsor + downline pair. The matching
  // `MlmCommissionEvent` carries the full computed bonus amount under
  // status `HELD_AWAITING_DOWNLINE_ACTIVATION`.
  MLM_BINARY_PAIR_MATCH_HELD_PENDING: "MLM_BINARY_PAIR_MATCH_HELD_PENDING",
  // Customer-MLM-rebuild Phase 4: emitted by
  // `releaseHeldPairBonusesForDownlineActivation` when a downline
  // user activates and the sponsor's previously-HELD pair-bonus is
  // released to the sponsor's `pending` wallet bucket. Paired with
  // the original `BINARY_PAIR_MATCH` MlmCommissionEvent flipped to
  // `CREDITED`.
  MLM_BINARY_PAIR_MATCH_RELEASED_ON_DOWNLINE_ACTIVATION:
    "MLM_BINARY_PAIR_MATCH_RELEASED_ON_DOWNLINE_ACTIVATION",
  // Signup bonus (added Jun 2026): every newly-registered customer
  // gets a flat shopping-wallet credit, and their sponsor gets a
  // smaller flat credit, the moment the membership is minted —
  // before joining-fee activation. Two separate ledger types so the
  // admin audit ledger filters cleanly between the self-credit and
  // the sponsor-credit.
  MLM_SIGNUP_BONUS_SELF: "MLM_SIGNUP_BONUS_SELF",
  MLM_SIGNUP_BONUS_SPONSOR: "MLM_SIGNUP_BONUS_SPONSOR",
};

export const PAYOUT_TYPE = {
  SELLER: "SELLER",
  DELIVERY_PARTNER: "DELIVERY_PARTNER",
  // MLM feature (Phase 1): customer-side withdrawal payout. The
  // `Payout({ beneficiaryModel: "User" })` row is created at withdrawal
  // request time and processed (PENDING -> COMPLETED) on admin approval.
  CUSTOMER_WITHDRAWAL: "CUSTOMER_WITHDRAWAL",
};

export const PAYOUT_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  // Audit Phase 1 (H-1): `cancelPendingPayoutForOrder` writes this status
  // when reversing a HOLD/PENDING payout after a return or cancellation.
  // Previously `PAYOUT_STATUS.CANCELLED` was `undefined`, so
  //   - `{ $ne: PAYOUT_STATUS.CANCELLED }` matched every document (idempotency
  //     guard never short-circuited correctly), and
  //   - `payout.status = PAYOUT_STATUS.CANCELLED; await payout.save()` failed
  //     the schema enum (ALL_PAYOUT_STATUSES) and threw a ValidationError,
  //     aborting the return-refund flow.
  // Adding the value is additive: `ALL_PAYOUT_STATUSES` is derived below.
  CANCELLED: "CANCELLED",
};

export const COMMISSION_TYPE = {
  PERCENTAGE: "percentage",
  FIXED: "fixed",
};

export const COMMISSION_FIXED_RULE = {
  PER_ITEM: "per_item",
  PER_QTY: "per_qty",
};

export const HANDLING_FEE_TYPE = {
  NONE: "none",
  FIXED: "fixed",
  PERCENTAGE: "percentage",
};

export const HANDLING_FEE_STRATEGY = {
  HIGHEST_CATEGORY_FEE: "highest_category_fee",
  SUM_OF_CATEGORY_FEES: "sum_of_category_fees",
  MAX_SINGLE_FEE: "max_single_fee",
  PER_ITEM_FEE: "per_item_fee",
};

export const DELIVERY_PRICING_MODE = {
  FIXED_PRICE: "fixed_price",
  DISTANCE_BASED: "distance_based",
};

export const FINANCE_AUDIT_ACTION = {
  ORDER_FINANCE_SNAPSHOT_FROZEN: "ORDER_FINANCE_SNAPSHOT_FROZEN",
  ONLINE_PAYMENT_VERIFIED: "ONLINE_PAYMENT_VERIFIED",
  COD_MARKED_COLLECTED: "COD_MARKED_COLLECTED",
  COD_RECONCILED: "COD_RECONCILED",
  ORDER_DELIVERED_SETTLED: "ORDER_DELIVERED_SETTLED",
  PAYOUT_QUEUED: "PAYOUT_QUEUED",
  PAYOUT_PROCESSED: "PAYOUT_PROCESSED",
  DELIVERY_SETTINGS_UPDATED: "DELIVERY_SETTINGS_UPDATED",
  FINANCE_ADJUSTMENT_APPLIED: "FINANCE_ADJUSTMENT_APPLIED",
};

// Audit Phase 4 (C-1 + H-5): when this flag is on, `grandTotal` is
// computed as (subtotal + delivery + handling + tip + tax - discount -
// walletAmount) and the wallet redemption is routed through
// `walletService.debitWallet` so a `LedgerEntry` row is written inside
// the same transaction as the order documents.
//
// When the flag is off, the legacy buggy behaviour is preserved bit-for-bit
// to make rollback trivial (env flip back). Default is OFF for production
// safety — flip to "true" only after backfilling historical over-charges
// (see audit PHASE 5 rollout plan).
export function isWalletRedemptionReducesPayableEnabled() {
  return String(process.env.WALLET_REDEMPTION_REDUCES_PAYABLE || "").toLowerCase() === "true";
}

// Audit Phase 5 (C-2 + C-4 + H-2 + H-6 + H-7): when this flag is on, the
// checkout pricing pipeline IGNORES any client-supplied `discountTotal`
// and instead routes coupon discount and free-delivery decisions through
// `services/finance/couponService.computeOrderDiscount` using the
// server-hydrated cart items. The order document also persists
// `coupon` (ObjectId ref) and `couponSnapshot` (frozen rule + applied
// amount) so per-user usage counts can be enforced from real data
// instead of the hard-coded `userUsageCount = 0` in couponController.
//
// When the flag is OFF, the legacy buggy behaviour (client trust on
// `discountTotal`, hard-coded user usage count, free-delivery silently
// ignored at place-order) is preserved bit-for-bit so rollback is an
// env flip. Default is OFF for production safety.
export function isServerSideCouponEngineEnabled() {
  return String(process.env.SERVER_SIDE_COUPON_ENGINE || "").toLowerCase() === "true";
}

export const ALL_PAYMENT_MODES = Object.values(PAYMENT_MODE);
export const ALL_ORDER_PAYMENT_STATUSES = Object.values(ORDER_PAYMENT_STATUS);
export const ALL_ORDER_SETTLEMENT_STATUSES = Object.values(ORDER_SETTLEMENT_STATUS);
export const ALL_OWNER_TYPES = Object.values(OWNER_TYPE);
export const ALL_WALLET_STATUSES = Object.values(WALLET_STATUS);
export const ALL_LEDGER_DIRECTIONS = Object.values(LEDGER_DIRECTION);
export const ALL_LEDGER_STATUSES = Object.values(LEDGER_STATUS);
export const ALL_LEDGER_TRANSACTION_TYPES = Object.values(LEDGER_TRANSACTION_TYPE);
export const ALL_PAYOUT_TYPES = Object.values(PAYOUT_TYPE);
export const ALL_PAYOUT_STATUSES = Object.values(PAYOUT_STATUS);
export const ALL_COMMISSION_TYPES = Object.values(COMMISSION_TYPE);
export const ALL_COMMISSION_FIXED_RULES = Object.values(COMMISSION_FIXED_RULE);
export const ALL_HANDLING_FEE_TYPES = Object.values(HANDLING_FEE_TYPE);
export const ALL_HANDLING_FEE_STRATEGIES = Object.values(HANDLING_FEE_STRATEGY);
export const ALL_DELIVERY_PRICING_MODES = Object.values(DELIVERY_PRICING_MODE);
export const ALL_FINANCE_AUDIT_ACTIONS = Object.values(FINANCE_AUDIT_ACTION);
