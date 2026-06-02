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
  const gst = round((adminCharge * gstPct) / 100);
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
 * DEPRECATED: replaced by `getPlanAPairBonusForPairIndex` after the
 * Plan A binary pair-matching refactor. Retained so older imports do
 * not break compilation; no runtime path consumes it.
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

  const fixedAfter = Number(cfg.planAPairBonusFixedAfterPair) || 0;
  if (idx > fixedAfter) return Number(cfg.planAPairBonusFixedAmount) || 0;

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
