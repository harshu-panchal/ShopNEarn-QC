/**
 * MLM (Multi-Level Marketing) constants and default rate sheet.
 *
 * All numeric thresholds, percentages, and amounts in this file are
 * DEFAULTS only. The canonical runtime values live in `Setting.mlm.*`
 * and are admin-editable. `mlmConfigService.getMlmConfig()` merges the
 * persisted Setting on top of these defaults.
 *
 * Rationale: keep `import` of MLM_DEFAULTS cheap (no DB read), let
 * tests/scripts use defaults directly, and never let the runtime code
 * crash if the Setting doc is missing or partially populated.
 */

/** Membership plan tiers. A customer is in EITHER A or B at any time. */
export const MLM_PLAN_TYPE = {
  A: "A", // Binary tree, direct referral milestone bonuses
  B: "B", // Unilevel, repurchase bonus L1-L6 + mentor royalty + home shopping
};
export const ALL_MLM_PLAN_TYPES = Object.values(MLM_PLAN_TYPE);

/** Membership lifecycle status. */
export const MLM_MEMBERSHIP_STATUS = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  TERMINATED: "terminated",
};
export const ALL_MLM_MEMBERSHIP_STATUSES = Object.values(MLM_MEMBERSHIP_STATUS);

/** Binary tree placement strategy (Plan A genealogy). */
export const MLM_BINARY_PLACEMENT_STRATEGY = {
  BALANCED_AUTO: "balanced_auto", // place new member on weaker leg via BFS
  SPILLOVER: "spillover", // honour sponsor preference; spillover to outer empty slot
  MANUAL: "manual", // sponsor explicitly picks the slot, no spillover
};
export const ALL_MLM_BINARY_PLACEMENT_STRATEGIES = Object.values(MLM_BINARY_PLACEMENT_STRATEGY);

/** Per-bonus event type tag — used on MlmCommissionEvent + audit reports. */
export const MLM_BONUS_TYPE = {
  DIRECT_REFERRAL_MILESTONE: "DIRECT_REFERRAL_MILESTONE",
  REPURCHASE_BONUS: "REPURCHASE_BONUS",
  MENTOR_ROYALTY: "MENTOR_ROYALTY",
  HOME_SHOPPING_SALES: "HOME_SHOPPING_SALES",
  HOME_SHOPPING_REFERRAL: "HOME_SHOPPING_REFERRAL",
  HOME_SHOPPING_ROYALTY: "HOME_SHOPPING_ROYALTY",
  GIFT_VOUCHER_MILESTONE: "GIFT_VOUCHER_MILESTONE",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
};
export const ALL_MLM_BONUS_TYPES = Object.values(MLM_BONUS_TYPE);

/** Status of a single commission credit event. */
export const MLM_COMMISSION_EVENT_STATUS = {
  CREDITED: "credited", // wallet+ledger row written successfully
  CAPPED_ROLLOVER: "capped_rollover", // daily cap exceeded; deferred to next day
  CLAWED_BACK: "clawed_back", // reversed via return clawback
  SKIPPED: "skipped", // recipient ineligible / config disabled
};
export const ALL_MLM_COMMISSION_EVENT_STATUSES = Object.values(MLM_COMMISSION_EVENT_STATUS);

/** Withdrawal request lifecycle. */
export const MLM_WITHDRAWAL_STATUS = {
  PENDING: "pending", // customer submitted, awaiting admin review
  APPROVED: "approved", // admin approved, payout queued
  PAID: "paid", // payout completed, UTR/reference captured
  REJECTED: "rejected", // admin rejected, wallet credit reversed
  CANCELLED: "cancelled", // customer cancelled before approval, wallet credit reversed
};
export const ALL_MLM_WITHDRAWAL_STATUSES = Object.values(MLM_WITHDRAWAL_STATUS);

/** Beneficiary capture method for withdrawal. */
export const MLM_WITHDRAWAL_METHOD = {
  BANK: "bank",
  UPI: "upi",
};
export const ALL_MLM_WITHDRAWAL_METHODS = Object.values(MLM_WITHDRAWAL_METHOD);

/** Milestone reward rule types (Phase 4). */
export const MLM_MILESTONE_TYPE = {
  DIRECT_REFERRAL_COUNT: "DIRECT_REFERRAL_COUNT",
  LIFETIME_EARNING: "LIFETIME_EARNING",
};
export const ALL_MLM_MILESTONE_TYPES = Object.values(MLM_MILESTONE_TYPE);

export const MLM_MILESTONE_REWARD_TYPE = {
  SHOPPING_CREDIT: "SHOPPING_CREDIT",
  EARNING_CREDIT: "EARNING_CREDIT",
  COUPON: "COUPON",
};
export const ALL_MLM_MILESTONE_REWARD_TYPES = Object.values(MLM_MILESTONE_REWARD_TYPE);

/** What "return clawback" does to credited bonuses. */
export const MLM_RETURN_CLAWBACK_MODE = {
  CLAWBACK: "clawback", // reverse credits proportional to refunded amount
  FORFEIT_FUTURE: "forfeit_future", // keep credits, deny future bonuses for that order
};
export const ALL_MLM_RETURN_CLAWBACK_MODES = Object.values(MLM_RETURN_CLAWBACK_MODE);

/**
 * Default MLM rate sheet. Every value here is an admin-editable default.
 * Read these via `mlmConfigService.getMlmConfig()` — never import directly
 * for runtime decisions (admin overrides will be missed).
 */
export const MLM_DEFAULTS = Object.freeze({
  enabled: false,

  // Joining package — direct payment + activation (no Product/Order).
  // Lifecycle lives in `MlmJoiningPayment`; price + credit are
  // snapshotted at intent time so mid-flight admin edits don't cheat
  // customers.
  joiningPackagePrice: 2999,
  joiningPackageShoppingWalletCredit: 5000,

  // Auto-upgrade trigger from Plan A to Plan B
  planBAutoUpgradeAtPlanALifetimeEarnings: 30000,
  premiumUpgradeShoppingWalletTopup: 10000,

  // Plan A: Direct Referral Milestone Bonus (cumulative table — paid when
  // sponsor reaches each direct-referral count threshold).
  // Default: at 2 directs => ₹200, at 3 => ₹150, at 4 => ₹100.
  directReferralMilestones: [
    { atDirectCount: 2, bonusAmount: 200, planRequired: MLM_PLAN_TYPE.A },
    { atDirectCount: 3, bonusAmount: 150, planRequired: MLM_PLAN_TYPE.A },
    { atDirectCount: 4, bonusAmount: 100, planRequired: MLM_PLAN_TYPE.A },
  ],

  // Plan B: Repurchase Bonus on every paid+delivered downline order.
  // Base = grandTotal. Walked 6 levels deep via sponsorChain.
  repurchaseBonusLevels: [
    { level: 1, ratePercent: 6 },
    { level: 2, ratePercent: 5 },
    { level: 3, ratePercent: 4 },
    { level: 4, ratePercent: 3 },
    { level: 5, ratePercent: 2 },
    { level: 6, ratePercent: 1 },
  ],

  // Plan B: Mentor Royalty cascades on EVERY commission credit (not on
  // order base). Self-funded — does NOT create new money.
  mentorRoyaltyLevels: [
    { level: 1, ratePercent: 10 },
    { level: 2, ratePercent: 5 },
  ],

  // Plan B: Home Shopping (only fires on orders where isHomeShoppingOrder).
  homeShoppingProductId: null,
  homeShoppingPrice: 50000,
  homeShoppingProductCreditValue: 100000,
  homeShoppingCommissions: {
    salesPercent: 10,
    referralPercent: 5,
    royaltyPercent: 2,
  },

  // Withdrawal config
  withdrawalMinAmount: 500,
  withdrawalAdminChargePercent: 10,
  withdrawalGstOnAdminChargePercent: 18,

  // Anti-runaway-compounding guardrail
  dailyEarningCap: 10000,

  // Genealogy + behaviour toggles
  binaryPlacementStrategy: MLM_BINARY_PLACEMENT_STRATEGY.BALANCED_AUTO,
  bonusesOnReturn: MLM_RETURN_CLAWBACK_MODE.CLAWBACK,

  // Sponsor chain depth cap (denormalised on MlmMembership for fast upline reads)
  sponsorChainMaxDepth: 10,

  // Referral code generation
  referralCodeLength: 8,
  referralCodeAlphabet: "ABCDEFGHJKMNPQRSTUVWXYZ23456789", // omit I, L, O, 0, 1 to avoid confusion
});

/** Idempotency-key prefixes for ledger replay protection. */
export const MLM_IDEMPOTENCY_PREFIX = {
  DIRECT_REFERRAL_MILESTONE: "MLM-DRM",
  REPURCHASE_BONUS: "MLM-RB",
  MENTOR_ROYALTY: "MLM-MR",
  HOME_SHOPPING_SALES: "MLM-HSS",
  HOME_SHOPPING_REFERRAL: "MLM-HSR",
  HOME_SHOPPING_ROYALTY: "MLM-HSY",
  GIFT_VOUCHER_MILESTONE: "MLM-GVM",
  JOINING_PACKAGE_CREDIT: "MLM-JPC",
  PREMIUM_UPGRADE_CREDIT: "MLM-PUC",
  BONUS_CLAWBACK: "MLM-CB",
  WITHDRAWAL_GROSS: "MLM-WG",
  WITHDRAWAL_ADMIN_CHARGE: "MLM-WAC",
  WITHDRAWAL_GST: "MLM-WGST",
  WITHDRAWAL_PAYOUT: "MLM-WPO",
  MANUAL_ADJUSTMENT: "MLM-ADJ",
};
