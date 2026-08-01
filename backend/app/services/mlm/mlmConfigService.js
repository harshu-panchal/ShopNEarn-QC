import Setting from "../../models/setting.js";
import { MLM_DEFAULTS } from "../../constants/mlm.js";

/**
 * mlmConfigService — single source of truth for ALL runtime MLM
 * configuration. Every other MLM service MUST read its knobs through
 * this module (never import MLM_DEFAULTS directly for runtime logic).
 *
 * Reads `Setting.mlm` (a singleton — one row per tenant) and overlays
 * the persisted values on top of `MLM_DEFAULTS`. Missing fields fall
 * back to defaults, so a fresh deployment with an empty Setting still
 * has a working rate sheet.
 *
 * No in-process caching here — `Setting` reads are already memoised in
 * `cacheService` for the public-settings flow. The MLM service runs
 * inside transactions where stale settings would be a correctness bug,
 * so we always read fresh.
 */

function mergeShallow(defaults, overrides) {
  if (!overrides || typeof overrides !== "object") return { ...defaults };
  const out = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out[key] = value;
    } else if (typeof value === "object" && !mongooseLikeIdentity(value)) {
      out[key] = mergeShallow(defaults[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function mongooseLikeIdentity(value) {
  // ObjectId / Date / Buffer instances must be assigned as-is, not deep-merged.
  return (
    value instanceof Date ||
    (typeof value.toString === "function" &&
      typeof value._bsontype === "string")
  );
}

/**
 * Read the merged MLM config for the current tenant. Always returns a
 * complete shape (every key in `MLM_DEFAULTS` is present).
 *
 * @param {object} [opts]
 * @param {string|null} [opts.tenantId] - optional tenant filter. Defaults to "default tenant".
 * @returns {Promise<object>}
 */
export async function getMlmConfig({ tenantId = null } = {}) {
  const filter = tenantId
    ? { tenantId }
    : { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] };
  const doc = await Setting.findOne(filter).select("mlm").lean();
  const overrides = doc?.mlm || {};
  return mergeShallow(MLM_DEFAULTS, overrides);
}

export async function isMlmEnabled(opts) {
  const cfg = await getMlmConfig(opts);
  return Boolean(cfg.enabled);
}

export async function getHomeShoppingProductId(opts) {
  const cfg = await getMlmConfig(opts);
  return cfg.homeShoppingProductId || null;
}

export async function getDailyEarningCap(opts) {
  const cfg = await getMlmConfig(opts);
  return Number(cfg.dailyEarningCap) || 0;
}

export async function getMinWithdrawalAmount(opts) {
  const cfg = await getMlmConfig(opts);
  return Number(cfg.withdrawalMinAmount) || 0;
}

/**
 * Compute the (adminCharge, gst, net) breakdown for a withdrawal request.
 * Returned amounts are rounded to 2 decimals.
 */
export async function computeWithdrawalCharges(grossAmount, opts) {
  const cfg = await getMlmConfig(opts);
  const adminPct = Number(cfg.withdrawalAdminChargePercent) || 0;
  const gstPct = Number(cfg.withdrawalGstOnAdminChargePercent) || 0;

  const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  const gross = round(grossAmount);
  const adminCharge = round((gross * adminPct) / 100);
  const gst = round((gross * gstPct) / 100);
  const net = round(gross - adminCharge - gst);

  return {
    gross,
    adminCharge,
    adminChargePercent: adminPct,
    gst,
    gstOnChargePercent: gstPct,
    net,
  };
}

/**
 * Look up the bonus rate for a given repurchase level. Returns null if
 * the level is not configured (no bonus for that level).
 */
export async function getRepurchaseBonusRate(level, opts) {
  const cfg = await getMlmConfig(opts);
  const entry = (cfg.repurchaseBonusLevels || []).find(
    (row) => Number(row.level) === Number(level),
  );
  return entry ? Number(entry.ratePercent) : null;
}

export async function getMentorRoyaltyRate(level, opts) {
  const cfg = await getMlmConfig(opts);
  const entry = (cfg.mentorRoyaltyLevels || []).find(
    (row) => Number(row.level) === Number(level),
  );
  return entry ? Number(entry.ratePercent) : null;
}

/**
 * One-time matching-income amount when the sponsor reaches
 * `atDirectCount` activated Plan A direct referrals.
 */
export async function getDirectReferralMilestoneBonus(atDirectCount, opts) {
  const cfg = await getMlmConfig(opts);
  const entry = (cfg.directReferralMilestones || []).find(
    (row) => Number(row.atDirectCount) === Number(atDirectCount),
  );
  return entry ? Number(entry.bonusAmount) : null;
}

/**
 * Look up the Plan A binary pair-match bonus payable when the sponsor
 * completes their `pairIndex`-th matched pair (1-based).
 *
 * Resolution order:
 *   1. If `planAPairBonusTiers` contains an explicit row for
 *      `pairIndex`, return its `bonusAmount`.
 *   2. Otherwise, if `pairIndex > planAPairBonusFixedAfterPair`,
 *      return `planAPairBonusFixedAmount`.
 *   3. Otherwise return 0 (no bonus configured for this pair).
 *
 * Returns a Number (never null) so callers can short-circuit on `<=0`.
 */
export async function getPlanAPairBonusForPairIndex(pairIndex, opts) {
  const cfg = await getMlmConfig(opts);
  const idx = Number(pairIndex);
  if (!Number.isFinite(idx) || idx < 1) return 0;

  const tier = (cfg.planAPairBonusTiers || []).find(
    (row) => Number(row.pairIndex) === idx,
  );
  if (tier) return Number(tier.bonusAmount) || 0;

  return 0;
}

/**
 * Cooldown days a `BINARY_PAIR_MATCH` event sits in `pending` before
 * `mlmJoiningCooldownReleaseJob` promotes it to `earnings`.
 */
export async function getPlanAPairBonusReleaseCooldownDays(opts) {
  const cfg = await getMlmConfig(opts);
  const days = Number(cfg.planAPairBonusReleaseCooldownDays);
  return Number.isFinite(days) && days >= 0 ? days : 0;
}

/** Wallet bucket for Plan A pair/milestone bonuses at credit time. */
export async function resolvePlanABonusWalletBucket(opts) {
  const days = await getPlanAPairBonusReleaseCooldownDays(opts);
  return days <= 0 ? "earnings" : "pending";
}

/**
 * Active joining payment mode (`"manual_qr"` or `"razorpay"`). Always
 * returns one of the two canonical values — unknown overrides and the
 * legacy `"phonepe"` value fall back / map to `"razorpay"`.
 */
export async function getJoiningPaymentMode(opts) {
  const cfg = await getMlmConfig(opts);
  if (
    cfg.joiningPaymentMode === "razorpay" ||
    cfg.joiningPaymentMode === "phonepe"
  ) {
    return "razorpay";
  }
  return "manual_qr";
}

/**
 * Public-safe slice of the manual-QR config. Always returns an object
 * with all four keys (empty strings if unset).
 */
export async function getManualQrConfig(opts) {
  const cfg = await getMlmConfig(opts);
  const src = cfg.manualQr || {};
  return {
    imageUrl: src.imageUrl || "",
    upiId: src.upiId || "",
    merchantName: src.merchantName || "",
    instructions: src.instructions || "",
  };
}

/**
 * Signup bonus rates — single getter so callers (`mlmSignupBonusService`,
 * the backfill script, admin UI) never re-derive the {enabled, self,
 * sponsor} triple from the raw config. Negative or non-finite values
 * are clamped to 0 because a negative bonus is meaningless and would
 * trip `creditWallet`'s `assertPositiveAmount` guard at the wallet
 * layer.
 *
 * Always returns the full shape — the caller short-circuits on
 * `enabled === false` or `selfAmount + sponsorAmount === 0`.
 */
export async function getSignupBonusConfig(opts) {
  const cfg = await getMlmConfig(opts);
  const clampNonNegative = (n) => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  return {
    enabled: Boolean(cfg.signupBonusEnabled),
    selfAmount: clampNonNegative(cfg.signupBonusSelfAmount),
    sponsorAmount: clampNonNegative(cfg.signupBonusSponsorAmount),
  };
}

export async function getDirectReferralActivationConfig(opts) {
  const cfg = await getMlmConfig(opts);
  const clampNonNegative = (n) => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const legacyAmount = clampNonNegative(cfg.directReferralActivationSponsorAmount);
  const masterEnabled = cfg.directReferralActivationBonusEnabled !== false;
  return {
    enabled: masterEnabled,
    sponsorAmount: legacyAmount,
    firstPair: {
      enabled:
        masterEnabled
        && cfg.directReferralFirstPairEnabled !== false,
      amount: clampNonNegative(cfg.directReferralFirstPairAmount) || legacyAmount,
    },
    perActivation: {
      enabled:
        masterEnabled
        && cfg.directReferralPerActivationEnabled !== false,
      amount:
        clampNonNegative(cfg.directReferralPerActivationAmount) || legacyAmount,
    },
  };
}

/**
 * Resolve the shopping-wallet credit for a joining payment. Prefer the
 * snapshot taken at intent time; fall back to live config when legacy
 * rows have a missing/zero snapshot.
 */
export async function resolveJoiningPackageShoppingCredit(payment, opts = {}) {
  const snapshot = Number(payment?.shoppingCreditSnapshot) || 0;
  if (snapshot > 0) return snapshot;
  const cfg = await getMlmConfig(opts);
  return Number(cfg.joiningPackageShoppingWalletCredit) || 0;
}
