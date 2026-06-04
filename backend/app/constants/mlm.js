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
  // Customer-MLM-rebuild Phase 1: customer has signed up (referral
  // captured, leg captured, referral code minted, binary tree placement
  // done) but the ₹2999 joining payment has NOT yet been CAPTURED.
  // While in this state the membership row:
  //   - has its own referralCode (shareable immediately)
  //   - has binaryParentId / binaryPosition set under sponsor's chosen leg
  //   - counts toward sponsor's leftLegDirectCount / rightLegDirectCount
  //   - does NOT receive any bonus credits as recipient
  //   - sponsor's pair-bonus tied to THIS member is emitted with
  //     `MlmCommissionEvent.status = HELD_AWAITING_DOWNLINE_ACTIVATION`
  //     and released to sponsor's wallet only when this member's joining
  //     payment is captured (see `mlmActivationService`).
  REGISTERED_UNPAID: "registered_unpaid",
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
  // Legacy: direct-referral count milestone (replaced by BINARY_PAIR_MATCH
  // for new credits). The constant is retained so historical
  // MlmCommissionEvent rows continue to deserialise; no runtime code
  // path emits new credits of this type after the binary-pair refactor.
  DIRECT_REFERRAL_MILESTONE: "DIRECT_REFERRAL_MILESTONE",
  // Plan A binary pair-matching bonus — paid every time the sponsor
  // completes a new pair of direct referrals
  // (min(leftLegDirectCount, rightLegDirectCount) increments by 1).
  // Amount comes from `Setting.mlm.planAPairBonusTiers` per pair index,
  // falling back to `planAPairBonusFixedAmount` for pairs beyond
  // `planAPairBonusFixedAfterPair`.
  BINARY_PAIR_MATCH: "BINARY_PAIR_MATCH",
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
  // Customer-MLM-rebuild Phase 4: pair-match bonus for a sponsor whose
  // newly-added direct referral is still `REGISTERED_UNPAID`. No wallet
  // credit and no ledger row are written; the event sits here until the
  // downline activates and `releaseHeldPairBonusesForDownlineActivation`
  // flips it to `CREDITED` inside the activation transaction.
  HELD_AWAITING_DOWNLINE_ACTIVATION: "held_awaiting_downline_activation",
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
 * MLM joining payment mode. Controls which gateway code path
 * `mlmJoiningPaymentService.initiateJoiningPayment` takes.
 *
 *  - `phonepe`    — production flow: PhonePe-pg checkout, automatic
 *    activation on webhook capture.
 *  - `manual_qr`  — temporary fallback used while PhonePe KYC is
 *    pending. Customer scans an admin-uploaded UPI QR, pays out-of-band,
 *    and submits a transaction id + screenshot. Admin manually approves
 *    or rejects in `/admin/mlm/joining-reviews`.
 *
 * The active mode is read from `Setting.mlm.joiningPaymentMode` at
 * intent-creation time and snapshotted on the `MlmJoiningPayment` row,
 * so flipping the toggle never strands payments mid-flight.
 */
export const MLM_PAYMENT_MODE = {
  MANUAL_QR: "manual_qr",
  PHONEPE: "phonepe",
};
export const ALL_MLM_PAYMENT_MODES = Object.values(MLM_PAYMENT_MODE);

/**
 * Default MLM rate sheet. Every value here is an admin-editable default.
 * Read these via `mlmConfigService.getMlmConfig()` — never import directly
 * for runtime decisions (admin overrides will be missed).
 */
export const MLM_DEFAULTS = Object.freeze({
  enabled: false,

  // Gatekeeper for new customer signup. When `true`, the
  // /customer/send-otp endpoint refuses to issue an OTP unless the
  // payload carries a `referralCode` that resolves to an ACTIVE
  // MlmMembership. The first member of the system bootstraps via a
  // seed script (or by toggling this OFF temporarily). When `false`,
  // the referral code stays optional and the legacy capture-on-signup
  // behaviour is preserved.
  signupRequiresReferralCode: true,

  // Joining package — direct payment + activation (no Product/Order).
  // Lifecycle lives in `MlmJoiningPayment`; price + credit are
  // snapshotted at intent time so mid-flight admin edits don't cheat
  // customers.
  joiningPackagePrice: 2999,
  joiningPackageShoppingWalletCredit: 5000,

  // Joining payment mode toggle. See `MLM_PAYMENT_MODE`. Defaults to
  // `manual_qr` because the temporary UPI-QR flow is the production
  // mode while PhonePe KYC verification is pending. Switch to
  // `phonepe` once KYC clears.
  joiningPaymentMode: "manual_qr",

  // Manual-QR config. Empty `imageUrl` falls back to the bundled
  // `frontend/src/assets/payment_QR.jpeg` asset on the customer page,
  // so the feature stays functional even if the admin hasn't uploaded
  // a custom QR yet. `upiId` / `merchantName` / `instructions` are
  // shown alongside the QR for cross-verification by the customer.
  manualQr: {
    imageUrl: "",
    upiId: "",
    merchantName: "",
    instructions: "",
  },

  // Auto-upgrade trigger from Plan A to Plan B
  planBAutoUpgradeAtPlanALifetimeEarnings: 30000,
  premiumUpgradeShoppingWalletTopup: 10000,

  // Plan A: Direct Referral Milestone Bonus — DEPRECATED in favour of
  // `planAPairBonusTiers` (binary pair-matching). The shape is kept so
  // existing Setting rows don't lose data, but no runtime code path
  // reads from it for new credits.
  directReferralMilestones: [
    { atDirectCount: 2, bonusAmount: 200, planRequired: MLM_PLAN_TYPE.A },
    { atDirectCount: 3, bonusAmount: 150, planRequired: MLM_PLAN_TYPE.A },
    { atDirectCount: 4, bonusAmount: 100, planRequired: MLM_PLAN_TYPE.A },
  ],

  // Plan A: Binary Pair Bonus — paid every time the sponsor completes a
  // new pair of direct referrals matched across legs (one personally
  // referred member in the left subtree, one in the right subtree).
  // `pairIndex` is 1-based.
  // Default flow (matches the v2 product spec):
  //   Pair 1 -> ₹200 (200)
  //   Pair 2 -> ₹350 (200 + 150)
  //   Pair 3 -> ₹300 (200 + 100)
  //   Pair 4 -> ₹250 (200 + 50)
  //   Pair 5+ -> ₹400 fixed (planAPairBonusFixedAmount).
  // Admin can edit every entry, add/remove tiers, change the
  // `fixedAfterPair` cutover point, and the `fixedAmount`.
  planAPairBonusTiers: [
    { pairIndex: 1, bonusAmount: 200 },
    { pairIndex: 2, bonusAmount: 350 },
    { pairIndex: 3, bonusAmount: 300 },
    { pairIndex: 4, bonusAmount: 250 },
  ],
  // Pair index after which `planAPairBonusFixedAmount` applies. Set to
  // 0 to apply the fixed amount to ALL pairs not explicitly listed in
  // `planAPairBonusTiers`. Default 4 means: pairs 5, 6, 7, ... pay the
  // fixed amount.
  planAPairBonusFixedAfterPair: 4,
  // Fixed bonus paid for every pair beyond `planAPairBonusFixedAfterPair`
  // when the pair index is not explicitly listed in
  // `planAPairBonusTiers`. Set to 0 to disable fixed-mode payouts.
  planAPairBonusFixedAmount: 400,
  // Number of days a `BINARY_PAIR_MATCH` event sits in the recipient's
  // `pending` wallet bucket before `mlmJoiningCooldownReleaseJob`
  // promotes it to `earnings` (withdrawable). Cooldown protects against
  // joining-payment refunds. Set to 0 to release immediately.
  planAPairBonusReleaseCooldownDays: 7,

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
  // Plan A binary pair-match bonus credit. Key shape:
  //   `MLM-BPM-<sponsorUserId>-P<pairIndex>` — one row per (sponsor, pair).
  BINARY_PAIR_MATCH: "MLM-BPM",
  // Pending->earnings release for a `BINARY_PAIR_MATCH` event that has
  // sat in pending for `planAPairBonusReleaseCooldownDays`. Key shape:
  //   `MLM-BPR-<commissionEventId>` (suffixed `-D` and `-C` for the
  //   debit/credit pair inside the release job).
  PAIR_BONUS_RELEASE: "MLM-BPR",
  // Customer-MLM-rebuild Phase 4: when a `REGISTERED_UNPAID` downline
  // activates (joining payment captured), every HELD pair-bonus tied
  // to them is released to the sponsor's `pending` wallet bucket.
  // Key shape: `MLM-BPH-<commissionEventId>`.
  PAIR_BONUS_HELD_RELEASE: "MLM-BPH",
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
