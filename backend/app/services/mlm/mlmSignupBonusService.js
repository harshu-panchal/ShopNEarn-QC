import mongoose from "mongoose";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import MlmMembership from "../../models/mlmMembership.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../../constants/finance.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { creditWallet, debitWallet } from "../finance/walletService.js";
import {
  getMlmConfig,
  getSignupBonusConfig,
  getDirectReferralActivationConfig,
} from "./mlmConfigService.js";
import {
  countActivePlanADirects,
  resolveFirstDirectPairIncomeAmount,
  calculateBinaryPairs,
} from "./mlmBinaryPairIncomeService.js";
import { classifyDirectReferralsByLegUnderRoot } from "./mlmBinaryTreeBuilder.js";
import { creditBonusToEarningsWallet } from "./mlmBonusEngineService.js";
import { roundCurrency } from "../../utils/money.js";
import {
  directReferralActivationFirstPairIdempotencyKey,
  hasCreditedBinaryPairMatchIndex,
  isBinaryPairMatchIndexCommissionEvent,
  isDirectReferralFirstPairCommissionEvent,
} from "./mlmFirstPairIncomeGuard.js";

export { directReferralActivationFirstPairIdempotencyKey } from "./mlmFirstPairIncomeGuard.js";

/** Idempotency key — one credit per (sponsor, activated direct). */
export function directReferralPerActivationIdempotencyKey(sponsorUserId, activatedUserId) {
  return `${MLM_IDEMPOTENCY_PREFIX.DIRECT_REFERRAL_PER_ACTIVATION}-${String(sponsorUserId)}-${String(activatedUserId)}`;
}

/** Legacy per-direct credits used DIRECT_REFERRAL_ACTIVATION + MLM-DRA-{sponsor}-{user}. */
export const LEGACY_PER_ACTIVATION_DRA_KEY_RE =
  /^MLM-DRA-[0-9a-f]{24}-[0-9a-f]{24}$/i;

export function parseLegacyPerActivationDraKey(idempotencyKey) {
  const key = String(idempotencyKey || "");
  const match = key.match(LEGACY_PER_ACTIVATION_DRA_KEY_RE);
  if (!match) return null;
  const parts = key.split("-");
  return {
    sponsorUserId: parts[2],
    activatedUserId: parts[3],
  };
}

/** Resolve which direct referral a per-activation credit belongs to. */
export function resolvePerActivationActivatedUserId(event) {
  if (!event) return null;

  const source = event.sourceUserId?._id || event.sourceUserId;
  if (source) return String(source);

  const legacy = parseLegacyPerActivationDraKey(event.idempotencyKey);
  if (legacy?.activatedUserId) return String(legacy.activatedUserId);

  const key = String(event.idempotencyKey || "");
  const drpaMatch = key.match(/DRPA-[0-9a-f]{24}-([0-9a-f]{24})$/i);
  if (drpaMatch) return drpaMatch[1];

  const backfillMatch = key.match(/MLM-DRA-BACKFILL-\d{4}-DRPA-[0-9a-f]{24}-([0-9a-f]{24})$/i);
  if (backfillMatch) return backfillMatch[1];

  if (event.meta?.activatedUserId) return String(event.meta.activatedUserId);
  return null;
}

export function isPerActivationIncomeCommissionEvent(event) {
  if (!event?.bonusType) return false;
  if (event.bonusType === MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION) {
    return true;
  }
  return isLegacyPerActivationDirectReferralCredit({
    bonusType: event.bonusType,
    idempotencyKey: event.idempotencyKey,
  });
}

export function isLegacyPerActivationDirectReferralCredit({
  bonusType,
  idempotencyKey,
}) {
  return (
    bonusType === MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION
    && LEGACY_PER_ACTIVATION_DRA_KEY_RE.test(String(idempotencyKey || ""))
  );
}

/** Map legacy per-direct rows to the canonical bonus type for reporting. */
export function normalizeEarningsBonusType(bonusType, idempotencyKey) {
  if (isLegacyPerActivationDirectReferralCredit({ bonusType, idempotencyKey })) {
    return MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION;
  }
  return bonusType;
}

/**
 * Customer-facing earnings breakdown — binary pair match #1 and one-time
 * first direct-pair income are the same payout and share the Pair Match row.
 */
export function resolveEarningsDisplayBonusType(event) {
  if (!event?.bonusType) return event?.bonusType;

  const row = {
    ...event,
    status: event.status || MLM_COMMISSION_EVENT_STATUS.CREDITED,
  };

  if (
    isLegacyPerActivationDirectReferralCredit({
      bonusType: row.bonusType,
      idempotencyKey: row.idempotencyKey,
    })
  ) {
    return MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION;
  }

  if (
    isDirectReferralFirstPairCommissionEvent(row)
    || isBinaryPairMatchIndexCommissionEvent(row, 1)
  ) {
    return MLM_BONUS_TYPE.BINARY_PAIR_MATCH;
  }

  return row.bonusType;
}

function commissionEventTimestamp(event) {
  const d = event?.creditedAt || event?.createdAt || event?.updatedAt;
  return d ? new Date(d).getTime() : 0;
}

function comparePerActivationEvents(a, b) {
  const aRegen = String(a.idempotencyKey || "").includes("REGEN");
  const bRegen = String(b.idempotencyKey || "").includes("REGEN");
  if (aRegen !== bRegen) return aRegen ? 1 : -1;

  const tsDiff = commissionEventTimestamp(a) - commissionEventTimestamp(b);
  if (tsDiff !== 0) return tsDiff;

  return String(a.idempotencyKey || "").localeCompare(
    String(b.idempotencyKey || ""),
  );
}

/** True when a credited row is the one-time first-pair payout (DRA or BPM #1). */
export function isFirstPairIncomeCommissionEvent(event) {
  if (!event) return false;
  const row = {
    ...event,
    status: event.status || MLM_COMMISSION_EVENT_STATUS.CREDITED,
  };
  return (
    isDirectReferralFirstPairCommissionEvent(row)
    || isBinaryPairMatchIndexCommissionEvent(row, 1)
  );
}

/**
 * Group credited earnings for customer breakdown.
 * First-pair income is one payout — if legacy data has both DRA and BPM #1,
 * only the earliest credited row is counted.
 */
export function groupEarningsEventsByDisplayType(events) {
  const byType = new Map();
  const firstPairCandidates = [];
  const perActivationByDirect = new Map();

  for (const row of events) {
    if (isFirstPairIncomeCommissionEvent(row)) {
      firstPairCandidates.push(row);
      continue;
    }

    if (isPerActivationIncomeCommissionEvent(row)) {
      const activatedId = resolvePerActivationActivatedUserId(row);
      const bucketKey = activatedId || `__unkeyed__:${row.idempotencyKey}`;
      if (!perActivationByDirect.has(bucketKey)) {
        perActivationByDirect.set(bucketKey, []);
      }
      perActivationByDirect.get(bucketKey).push(row);
      continue;
    }

    const key = resolveEarningsDisplayBonusType(row);
    const prev = byType.get(key) || { total: 0, count: 0 };
    byType.set(key, {
      total: prev.total + (Number(row.cappedAmount) || 0),
      count: prev.count + 1,
    });
  }

  if (firstPairCandidates.length > 0) {
    const canonical = [...firstPairCandidates].sort(
      (a, b) => commissionEventTimestamp(a) - commissionEventTimestamp(b),
    )[0];
    const key = MLM_BONUS_TYPE.BINARY_PAIR_MATCH;
    const prev = byType.get(key) || { total: 0, count: 0 };
    byType.set(key, {
      total: prev.total + (Number(canonical.cappedAmount) || 0),
      count: prev.count + 1,
    });
  }

  for (const rows of perActivationByDirect.values()) {
    const canonical = [...rows].sort(comparePerActivationEvents)[0];
    const key = MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION;
    const prev = byType.get(key) || { total: 0, count: 0 };
    byType.set(key, {
      total: prev.total + (Number(canonical.cappedAmount) || 0),
      count: prev.count + 1,
    });
  }

  return [...byType.entries()].map(([bonusType, stats]) => ({
    bonusType,
    total: stats.total,
    count: stats.count,
  }));
}

/**
 * Count active Plan A directs on each binary leg under the sponsor.
 *
 * `pairs` reuses `calculateBinaryPairs` (the same 2:1/1:2-opener-then-1:1
 * rule the team-wide BINARY_PAIR_MATCH engine enforces) instead of a naive
 * `Math.min(left, right)` — a bare 1 Left + 1 Right must NOT count as a
 * completed pair; the opening pair needs 2 on one leg and 1 on the other.
 */
export function countDirectReferralLegPairsFromLegMap(directReferrals, legByReferralId) {
  let left = 0;
  let right = 0;
  for (const ref of directReferrals || []) {
    const leg = legByReferralId.get(String(ref._id));
    if (leg === "L") left += 1;
    else if (leg === "R") right += 1;
  }
  return { left, right, pairs: calculateBinaryPairs(left, right).pairs };
}

/** True only on the activation that completes the sponsor's first L+R direct pair. */
export function shouldCreditFirstDirectReferralPair({ pairsBefore, pairsAfter }) {
  return pairsBefore === 0 && pairsAfter === 1;
}

async function loadActiveDirectReferralLegPairCounts(
  sponsorMembership,
  { excludeUserId = null, session },
) {
  const sponsorUserId =
    sponsorMembership.userId?._id || sponsorMembership.userId;
  const query = {
    sponsorId: sponsorUserId,
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
  };
  if (excludeUserId) {
    query.userId = { $ne: excludeUserId };
  }
  const directs = await MlmMembership.find(query).session(session).lean();
  const legByReferralId = await classifyDirectReferralsByLegUnderRoot({
    rootMembership: sponsorMembership,
    directReferrals: directs,
  });
  return countDirectReferralLegPairsFromLegMap(directs, legByReferralId);
}

/** Active direct-referral L/R leg pair counts for a sponsor (exported for regen scripts). */
export async function getActiveDirectReferralLegPairCounts(
  sponsorMembership,
  { session } = {},
) {
  return loadActiveDirectReferralLegPairCounts(sponsorMembership, { session });
}

async function resolveSponsorForDirectReferralBonus({
  activatedUserId,
  activatedMembership,
  session,
}) {
  if (!activatedUserId || !activatedMembership?.sponsorId) {
    return { skipped: "NO_SPONSOR", sponsorUserId: null, sponsorMembership: null };
  }

  const sponsorUserId = activatedMembership.sponsorId;
  if (String(sponsorUserId) === String(activatedUserId)) {
    return { skipped: "SELF_REFERRAL", sponsorUserId: null, sponsorMembership: null };
  }

  const sponsorMembership = await MlmMembership.findOne({
    userId: sponsorUserId,
  }).session(session);
  if (!sponsorMembership) {
    return { skipped: "SPONSOR_NOT_FOUND", sponsorUserId: null, sponsorMembership: null };
  }
  if (
    sponsorMembership.status === MLM_MEMBERSHIP_STATUS.SUSPENDED
    || sponsorMembership.status === MLM_MEMBERSHIP_STATUS.TERMINATED
  ) {
    return { skipped: "SPONSOR_INELIGIBLE", sponsorUserId: null, sponsorMembership: null };
  }

  return { skipped: null, sponsorUserId, sponsorMembership };
}

async function creditDirectReferralEarning({
  sponsorUserId,
  sponsorMembership,
  activatedUserId,
  amount,
  bonusType,
  idempotencyKey,
  description,
  meta,
  session,
  correlationId,
}) {
  const event = await creditBonusToEarningsWallet({
    recipientUserId: sponsorUserId,
    bonusType,
    planType: MLM_PLAN_TYPE.A,
    bonusAmount: amount,
    sourceUserId: activatedUserId,
    bucket: "earnings",
    description,
    meta: {
      activatedUserId: String(activatedUserId),
      sponsorUserId: String(sponsorUserId),
      ...(meta || {}),
    },
    idempotencyKey,
    correlationId,
    session,
  });

  return { event, amount: event?.cappedAmount || amount };
}

/**
 * Signup bonus credits for the MLM program.
 *
 * Rule (Jun 2026): when the direct sponsor is still REGISTERED_UNPAID,
 * signup bonuses are not paid at registration. The welcome self credit
 * releases when the referral activates Plan A; the sponsor's referral
 * bonus stays held until the sponsor activates.
 */

async function creditMemberSignupBonus({
  recipientUserId,
  recipientMembership,
  amount,
  bonusType,
  ledgerType,
  ledgerReference,
  ledgerDescription,
  idempotencyKey,
  correlationId,
  meta,
  sourceUserId,
  session,
}) {
  const creditResult = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: recipientUserId,
    amount,
    bucket: "shopping",
    session,
    ledgerType,
    ledgerReference,
    ledgerDescription,
    metadata: meta,
    idempotencyKey,
    correlationId,
    syncUserWalletBalance: false,
  });

  const eventDoc = await MlmCommissionEvent.create(
    [
      {
        recipientId: recipientUserId,
        recipientMembershipId: recipientMembership?._id || null,
        sourceUserId,
        bonusType,
        planType: MLM_PLAN_TYPE.A,
        baseAmount: amount,
        bonusAmount: amount,
        cappedAmount: amount,
        rolloverAmount: 0,
        walletBucket: "shopping",
        ledgerEntryId: creditResult?.ledgerEntry?._id || null,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey,
        correlationId,
        description: ledgerDescription,
        meta,
      },
    ],
    { session },
  ).then((rows) => rows[0]);

  return {
    amount,
    walletBalanceAfter: creditResult?.after,
    ledgerEntryId: creditResult?.ledgerEntry?._id || null,
    eventId: eventDoc?._id || null,
  };
}

async function emitHeldSignupBonusEvent({
  recipientUserId,
  recipientMembershipId,
  sourceUserId,
  bonusType,
  amount,
  idempotencyKey,
  correlationId,
  unpaidSponsorUserId,
  referralUserId,
  session,
}) {
  const existing = await MlmCommissionEvent.findOne(
    { idempotencyKey },
    null,
    session ? { session } : {},
  );
  if (
    existing?.status === MLM_COMMISSION_EVENT_STATUS.CREDITED
    || existing?.status === MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION
  ) {
    return existing;
  }

  const description =
    bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
      ? "MLM signup bonus — referral acquired (held until sponsor activates)"
      : "MLM signup bonus — welcome credit (held until sponsor activates)";

  // Clawback reuses the same idempotencyKey row — convert it back to HELD
  // instead of silently skipping (which stranded bonuses after sponsor activation).
  if (existing?.status === MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK) {
    existing.status = MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION;
    existing.cappedAmount = 0;
    existing.rolloverAmount = 0;
    existing.clawbackAt = undefined;
    existing.clawbackAmount = undefined;
    existing.ledgerEntryId = null;
    existing.description = description;
    existing.meta = {
      ...(existing.meta || {}),
      unpaidSponsorUserId: String(unpaidSponsorUserId),
      heldReferralUserId: String(referralUserId),
      mlmEvent:
        bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
          ? "SIGNUP_BONUS_SPONSOR_HELD"
          : "SIGNUP_BONUS_SELF_HELD",
    };
    await existing.save({ session });
    return existing;
  }

  const [eventDoc] = await MlmCommissionEvent.create(
    [
      {
        recipientId: recipientUserId,
        recipientMembershipId: recipientMembershipId || null,
        sourceUserId: sourceUserId || null,
        bonusType,
        planType: MLM_PLAN_TYPE.A,
        baseAmount: amount,
        bonusAmount: amount,
        cappedAmount: 0,
        rolloverAmount: 0,
        walletBucket: "shopping",
        ledgerEntryId: null,
        status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
        idempotencyKey,
        correlationId,
        description,
        meta: {
          unpaidSponsorUserId: String(unpaidSponsorUserId),
          heldReferralUserId: String(referralUserId),
          mlmEvent:
            bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
              ? "SIGNUP_BONUS_SPONSOR_HELD"
              : "SIGNUP_BONUS_SELF_HELD",
        },
      },
    ],
    session ? { session } : {},
  );

  return eventDoc;
}

/**
 * Credit signup bonuses when a new customer registers with a referral code.
 * Defers both sponsor and self credits when the sponsor is unpaid.
 */
export async function applyRegistrationBonusInSession({
  newCustomerId,
  newMembership,
  sponsorUserId = null,
  sponsorMembership = null,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "applyRegistrationBonusInSession requires an open mongoose session.",
    );
  }
  if (!newCustomerId || !newMembership) {
    throw new Error(
      "applyRegistrationBonusInSession requires `newCustomerId` and `newMembership`.",
    );
  }

  if (newMembership.signupBonusCreditedAt) {
    return { skipped: "ALREADY_CREDITED", selfCredit: null, sponsorCredit: null };
  }

  const cfg = await getSignupBonusConfig();
  if (!cfg.enabled) {
    return { skipped: "DISABLED", selfCredit: null, sponsorCredit: null };
  }
  if (cfg.selfAmount <= 0 && cfg.sponsorAmount <= 0) {
    return { skipped: "ZERO_AMOUNT", selfCredit: null, sponsorCredit: null };
  }

  let sponsorMemDoc = sponsorMembership || null;
  if (!sponsorMemDoc && sponsorUserId) {
    sponsorMemDoc = await MlmMembership.findOne({ userId: sponsorUserId }).session(
      session,
    );
  }

  const sponsorUnpaid =
    sponsorMemDoc?.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID;
  const sameAsSelf =
    sponsorUserId && String(sponsorUserId) === String(newCustomerId);

  if (sponsorUnpaid && sponsorUserId && !sameAsSelf) {
    if (cfg.selfAmount > 0) {
      await emitHeldSignupBonusEvent({
        recipientUserId: newCustomerId,
        recipientMembershipId: newMembership._id,
        sourceUserId: sponsorUserId,
        bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
        amount: cfg.selfAmount,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(newCustomerId)}`,
        correlationId,
        unpaidSponsorUserId: sponsorUserId,
        referralUserId: newCustomerId,
        session,
      });
    }
    if (cfg.sponsorAmount > 0) {
      await emitHeldSignupBonusEvent({
        recipientUserId: sponsorUserId,
        recipientMembershipId: sponsorMemDoc?._id || null,
        sourceUserId: newCustomerId,
        bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
        amount: cfg.sponsorAmount,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${String(sponsorUserId)}-${String(newCustomerId)}`,
        correlationId,
        unpaidSponsorUserId: sponsorUserId,
        referralUserId: newCustomerId,
        session,
      });
    }
    return {
      skipped: "HELD_UNTIL_SPONSOR_ACTIVATION",
      selfCredit: null,
      sponsorCredit: null,
    };
  }

  let selfCredit = null;
  if (cfg.selfAmount > 0) {
    const selfIdempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(newCustomerId)}`;
    selfCredit = await creditMemberSignupBonus({
      recipientUserId: newCustomerId,
      recipientMembership: newMembership,
      amount: cfg.selfAmount,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
      ledgerReference: selfIdempotencyKey,
      ledgerDescription: "MLM signup bonus — welcome credit",
      idempotencyKey: selfIdempotencyKey,
      correlationId,
      meta: {
        mlmEvent: "SIGNUP_BONUS_SELF",
        newCustomerId: String(newCustomerId),
        sponsorUserId: sponsorUserId ? String(sponsorUserId) : null,
      },
      sourceUserId: sponsorUserId || null,
      session,
    });
  }

  let sponsorCredit = null;
  if (cfg.sponsorAmount > 0 && sponsorUserId && !sameAsSelf) {
    const sponsorIdempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${String(sponsorUserId)}-${String(newCustomerId)}`;
    sponsorCredit = await creditMemberSignupBonus({
      recipientUserId: sponsorUserId,
      recipientMembership: sponsorMemDoc,
      amount: cfg.sponsorAmount,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR,
      ledgerReference: sponsorIdempotencyKey,
      ledgerDescription: "MLM signup bonus — referral acquired",
      idempotencyKey: sponsorIdempotencyKey,
      correlationId,
      meta: {
        mlmEvent: "SIGNUP_BONUS_SPONSOR",
        newCustomerId: String(newCustomerId),
        sponsorUserId: String(sponsorUserId),
      },
      sourceUserId: newCustomerId,
      session,
    });
  }

  newMembership.signupBonusCreditedAt = new Date();
  await newMembership.save({ session });

  return {
    skipped: null,
    selfCredit,
    sponsorCredit,
  };
}

/**
 * Per-direct Plan A activation earnings — credits sponsor each time a direct
 * referral activates (idempotent per sponsor + activated user).
 */
export async function applyDirectReferralPerActivationBonusInSession({
  activatedUserId,
  activatedMembership,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "applyDirectReferralPerActivationBonusInSession requires an open mongoose session.",
    );
  }

  const cfg = await getDirectReferralActivationConfig();
  if (!cfg.perActivation.enabled || cfg.perActivation.amount <= 0) {
    return { skipped: "DISABLED", event: null };
  }

  const sponsor = await resolveSponsorForDirectReferralBonus({
    activatedUserId,
    activatedMembership,
    session,
  });
  if (sponsor.skipped) {
    return { skipped: sponsor.skipped, event: null };
  }

  const { sponsorUserId, sponsorMembership } = sponsor;
  const idempotencyKey = directReferralPerActivationIdempotencyKey(
    sponsorUserId,
    activatedUserId,
  );

  const existing = await MlmCommissionEvent.findOne(
    { idempotencyKey, status: MLM_COMMISSION_EVENT_STATUS.CREDITED },
    null,
    { session },
  );
  if (existing) {
    return { skipped: "ALREADY_CREDITED", event: existing };
  }

  // Legacy per-referral credits used MLM-DRA-{sponsor}-{activated} + DIRECT_REFERRAL_ACTIVATION.
  const legacyKey = `${MLM_IDEMPOTENCY_PREFIX.DIRECT_REFERRAL_ACTIVATION}-${String(sponsorUserId)}-${String(activatedUserId)}`;
  const legacy = await MlmCommissionEvent.findOne(
    {
      idempotencyKey: legacyKey,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    },
    null,
    { session },
  );
  if (legacy) {
    return { skipped: "ALREADY_CREDITED", event: legacy };
  }

  // Plan-scaled amount: the activated member's joining plan snapshots
  // its own benefit base amount at activation time — prefer that over
  // the global config so bigger plans pay bigger sponsor bonuses.
  const planAmount = activatedMembership?.benefitBaseAmount;
  const amount = roundCurrency(
    planAmount != null && planAmount >= 0 ? planAmount : cfg.perActivation.amount,
  );
  const result = await creditDirectReferralEarning({
    sponsorUserId,
    sponsorMembership,
    activatedUserId,
    amount,
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
    idempotencyKey,
    description: "Direct referral Plan A activation income",
    meta: { incomeType: "PER_ACTIVATION" },
    session,
    correlationId,
  });

  return { skipped: null, ...result };
}

/**
 * Reverses already-CREDITED per-activation direct-referral income that
 * was paid to a member's OLD sponsor and re-credits the same amount to
 * the NEW sponsor. Opt-in helper for `executeChangeDirectSponsor` (admin
 * sponsor reassignment) — reversing wallet history isn't always wanted,
 * so callers must ask for it explicitly.
 *
 * Only touches `DIRECT_REFERRAL_PER_ACTIVATION` events (the one-time
 * bonus paid when a direct referral activates Plan A). Binary-tree-based
 * incomes are intentionally untouched — binary placement is a separate
 * concern from sponsor chain and isn't changed by a sponsor reassignment.
 *
 * `reconcileSince` (optional) limits reconciliation to events credited on
 * or after that date, so an admin can avoid reopening very old history.
 *
 * Best-effort per event: if reversing one event fails (e.g. the old
 * sponsor already withdrew the balance), that event is skipped and the
 * rest still proceed — a failed reversal must never abort the sponsor
 * reassignment itself.
 */
export async function reconcileDirectReferralActivationIncomeOnSponsorChange({
  memberUserId,
  oldSponsorUserId,
  newSponsorUserId,
  reconcileSince = null,
  adminId = null,
  reason = null,
  correlationId = null,
  session = null,
}) {
  if (!memberUserId || !oldSponsorUserId || !newSponsorUserId) {
    return { processed: 0, skipped: 0, totalAmount: 0, events: [] };
  }
  if (String(oldSponsorUserId) === String(newSponsorUserId)) {
    return { processed: 0, skipped: 0, totalAmount: 0, events: [] };
  }

  const query = {
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
    sourceUserId: memberUserId,
    recipientId: oldSponsorUserId,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    clawbackAt: { $exists: false },
  };
  if (reconcileSince) {
    query.createdAt = { $gte: new Date(reconcileSince) };
  }

  const events = await MlmCommissionEvent.find(query).session(session);

  let processed = 0;
  let skipped = 0;
  let totalAmount = 0;
  const results = [];

  for (const event of events) {
    const credited = roundCurrency(event.cappedAmount || event.bonusAmount || 0);
    if (credited <= 0) {
      skipped += 1;
      continue;
    }

    try {
      const bucket = event.walletBucket || "earnings";
      const clawbackKey = `${MLM_IDEMPOTENCY_PREFIX.BONUS_CLAWBACK}-SC-${event._id}`;

      await debitWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: event.recipientId,
        amount: credited,
        bucket,
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_CLAWBACK_ON_SPONSOR_CHANGE,
        ledgerReference: clawbackKey,
        ledgerDescription: `Direct referral activation income reversed — sponsor reassigned`,
        idempotencyKey: clawbackKey,
        correlationId,
        syncUserWalletBalance: bucket === "available",
        metadata: {
          mlmEventId: String(event._id),
          memberUserId: String(memberUserId),
          oldSponsorUserId: String(oldSponsorUserId),
          newSponsorUserId: String(newSponsorUserId),
          adminId: adminId ? String(adminId) : null,
          reason: reason || null,
        },
      });

      event.status = MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK;
      event.clawbackAt = new Date();
      event.clawbackAmount = credited;
      event.meta = {
        ...(event.meta || {}),
        clawbackReason: "sponsor_reassigned",
        oldSponsorUserId: String(oldSponsorUserId),
        newSponsorUserId: String(newSponsorUserId),
        adminId: adminId ? String(adminId) : null,
        adminReason: reason || null,
      };
      await event.save({ session });

      const incField =
        event.planType === MLM_PLAN_TYPE.B
          ? "lifetimePlanBEarnings"
          : "lifetimePlanAEarnings";
      await MlmMembership.updateOne(
        { userId: oldSponsorUserId },
        { $inc: { [incField]: -credited } },
        { session },
      );

      const newIdempotencyKey = directReferralPerActivationIdempotencyKey(
        newSponsorUserId,
        memberUserId,
      );
      const newEvent = await creditBonusToEarningsWallet({
        recipientUserId: newSponsorUserId,
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
        planType: event.planType,
        bonusAmount: credited,
        sourceUserId: memberUserId,
        sourceCommissionEventId: event._id,
        bucket,
        description: "Direct referral Plan A activation income (sponsor reassigned)",
        meta: {
          activatedUserId: String(memberUserId),
          sponsorUserId: String(newSponsorUserId),
          incomeType: "PER_ACTIVATION",
          reassignedFromEventId: String(event._id),
          reassignedFromSponsorId: String(oldSponsorUserId),
        },
        idempotencyKey: newIdempotencyKey,
        correlationId,
        session,
        skipDailyCap: true,
      });

      processed += 1;
      totalAmount = roundCurrency(totalAmount + credited);
      results.push({
        originalEventId: event._id,
        newEventId: newEvent?._id || null,
        amount: credited,
      });
    } catch (error) {
      skipped += 1;
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "[mlmSignupBonusService] sponsor-change income reconciliation failed for event; continuing",
          { mlmEventId: String(event._id), error: error.message },
        );
      }
    }
  }

  return { processed, skipped, totalAmount, events: results };
}

/**
 * One-time earnings when a sponsor's direct referrals complete their first
 * binary pair (one active direct on L and one on R). Skipped when binary
 * pair match #1 was already paid — only one first-pair income total.
 */
export async function applyDirectReferralFirstPairBonusInSession({
  activatedUserId,
  activatedMembership,
  session,
  correlationId = null,
  backfill = false,
}) {
  if (!session) {
    throw new Error(
      "applyDirectReferralFirstPairBonusInSession requires an open mongoose session.",
    );
  }

  const cfg = await getDirectReferralActivationConfig();
  if (!cfg.firstPair.enabled) {
    return { skipped: "DISABLED", event: null };
  }

  const sponsor = await resolveSponsorForDirectReferralBonus({
    activatedUserId,
    activatedMembership,
    session,
  });
  if (sponsor.skipped) {
    return { skipped: sponsor.skipped, event: null };
  }

  const { sponsorUserId, sponsorMembership } = sponsor;

  const pairsBefore = await loadActiveDirectReferralLegPairCounts(
    sponsorMembership,
    { excludeUserId: activatedUserId, session },
  );
  const pairsAfter = await loadActiveDirectReferralLegPairCounts(
    sponsorMembership,
    { session },
  );

  if (!backfill) {
    if (
      !shouldCreditFirstDirectReferralPair({
        pairsBefore: pairsBefore.pairs,
        pairsAfter: pairsAfter.pairs,
      })
    ) {
      if (pairsAfter.pairs === 0) {
        return { skipped: "PAIR_NOT_COMPLETE", event: null };
      }
      return { skipped: "NOT_FIRST_PAIR", event: null };
    }
  } else if (pairsAfter.pairs < 1) {
    return { skipped: "PAIR_NOT_COMPLETE", event: null };
  }

  const idempotencyKey =
    directReferralActivationFirstPairIdempotencyKey(sponsorUserId);
  const existing = await MlmCommissionEvent.findOne(
    { idempotencyKey },
    null,
    { session },
  );
  // A CLAWED_BACK row (e.g. an earlier invalid bare-1L+1R credit that was
  // reversed) must NOT permanently block this sponsor from legitimately
  // earning the bonus later once they genuinely complete a 2:1/1:2 pair —
  // fall through to the reopen branch below instead of short-circuiting.
  if (existing && existing.status !== MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK) {
    return { skipped: "ALREADY_CREDITED", event: existing };
  }

  if (await hasCreditedBinaryPairMatchIndex(sponsorUserId, 1, { session })) {
    return { skipped: "BINARY_PAIR_ALREADY_PAID", event: null };
  }

  const mlmCfg = await getMlmConfig();
  const directCount = await countActivePlanADirects(sponsorUserId, { session });
  // Plan-scaled base: the activated member (whose pair completion
  // triggered this bonus) snapshots its joining plan's benefit base
  // amount — substitutes for the canonical ₹200 baseline that
  // resolveFirstDirectPairIncomeAmount's tiers are expressed relative to.
  const planBaseAmount = activatedMembership?.benefitBaseAmount;
  const baseAmount = planBaseAmount != null && planBaseAmount >= 0 ? planBaseAmount : 200;
  const amount = roundCurrency(
    resolveFirstDirectPairIncomeAmount(
      mlmCfg,
      directCount,
      Boolean(sponsorMembership.binaryTopupMember),
      cfg.firstPair.amount,
      baseAmount,
    ),
  );
  if (amount <= 0) {
    return { skipped: "DISABLED", event: null };
  }

  const meta = {
    incomeType: "FIRST_DIRECT_PAIR",
    pairIndex: 1,
    leftDirectCount: pairsAfter.left,
    rightDirectCount: pairsAfter.right,
    directCount,
    pairIncome: amount,
  };

  let result;
  if (existing) {
    // Reopen: the sponsor's earlier credit was reversed as invalid, and
    // they've now genuinely completed a 2:1/1:2 opening pair. Reuse the
    // same MlmCommissionEvent row (idempotencyKey is unique) rather than
    // inserting a new one — mirrors `restoreOneClawedSignupBonusEvent`.
    const reopenLedgerKey = `${idempotencyKey}-REOPEN-${Date.now()}`;
    const creditResult = await creditWallet({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: sponsorUserId,
      amount,
      bucket: "earnings",
      session,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_ACTIVATION,
      ledgerReference: reopenLedgerKey,
      ledgerDescription: "Direct referral first-pair activation income (re-earned after correction)",
      metadata: { ...meta, reopenedAfterClawback: true, activatedUserId: String(activatedUserId), sponsorUserId: String(sponsorUserId) },
      idempotencyKey: reopenLedgerKey,
      correlationId,
      syncUserWalletBalance: false,
    });
    existing.status = MLM_COMMISSION_EVENT_STATUS.CREDITED;
    existing.bonusAmount = amount;
    existing.cappedAmount = amount;
    existing.rolloverAmount = 0;
    existing.clawbackAt = undefined;
    existing.clawbackAmount = undefined;
    existing.ledgerEntryId = creditResult?.ledgerEntry?._id || null;
    existing.description = "Direct referral first-pair activation income";
    existing.meta = { ...meta, reopenedAfterClawback: true };
    await existing.save({ session });
    result = { event: existing, amount };
  } else {
    result = await creditDirectReferralEarning({
      sponsorUserId,
      sponsorMembership,
      activatedUserId,
      amount,
      bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
      idempotencyKey,
      description: "Direct referral first-pair activation income",
      meta,
      session,
      correlationId,
    });
  }

  const paidPairs = Number(sponsorMembership.pairsCompleted) || 0;
  if (paidPairs < 1) {
    await MlmMembership.updateOne(
      { _id: sponsorMembership._id },
      { $set: { pairsCompleted: 1, lastPaidPairIndex: 1 } },
      { session },
    );
  }

  return { skipped: null, ...result };
}

/**
 * Runs both direct-referral earnings flows on Plan A activation:
 *   1. Per-direct activation income (each direct)
 *   2. First direct L+R pair income (one-time)
 */
export async function applyDirectReferralActivationBonusInSession({
  activatedUserId,
  activatedMembership,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "applyDirectReferralActivationBonusInSession requires an open mongoose session.",
    );
  }

  const perActivation = await applyDirectReferralPerActivationBonusInSession({
    activatedUserId,
    activatedMembership,
    session,
    correlationId,
  });
  const firstPair = await applyDirectReferralFirstPairBonusInSession({
    activatedUserId,
    activatedMembership,
    session,
    correlationId,
  });

  return { perActivation, firstPair };
}

/**
 * Release signup bonuses held while this member was REGISTERED_UNPAID.
 * Called when the sponsor activates Plan A (paid or admin approval).
 */
async function creditHeldSignupBonusEvent(
  event,
  { session, correlationId, releaseMeta = {} },
) {
  const recipientMembership = event.recipientMembershipId
    ? await MlmMembership.findById(event.recipientMembershipId).session(session)
    : await MlmMembership.findOne({ userId: event.recipientId }).session(session);

  const ledgerType =
    event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
      ? LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR
      : LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF;

  const creditResult = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: event.recipientId,
    amount: event.bonusAmount,
    bucket: "shopping",
    session,
    ledgerType,
    ledgerReference: event.idempotencyKey,
    ledgerDescription:
      event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
        ? "MLM signup bonus — referral acquired"
        : "MLM signup bonus — welcome credit",
    metadata: {
      ...(event.meta || {}),
      ...releaseMeta,
    },
    idempotencyKey: event.idempotencyKey,
    correlationId,
    syncUserWalletBalance: false,
  });

  event.status = MLM_COMMISSION_EVENT_STATUS.CREDITED;
  event.cappedAmount = event.bonusAmount;
  event.ledgerEntryId = creditResult?.ledgerEntry?._id || null;
  event.releasedAt = new Date();
  event.description =
    event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
      ? "MLM signup bonus — referral acquired"
      : "MLM signup bonus — welcome credit";
  await event.save({ session });

  if (
    event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SELF &&
    recipientMembership &&
    !recipientMembership.signupBonusCreditedAt
  ) {
    recipientMembership.signupBonusCreditedAt = new Date();
    await recipientMembership.save({ session });
  }

  return {
    eventId: event._id,
    bonusType: event.bonusType,
    recipientId: event.recipientId,
    amount: event.bonusAmount,
  };
}

/**
 * Release the welcome signup bonus held at registration once the referral
 * activates Plan A, even if their direct sponsor is still unpaid.
 */
export async function releaseHeldSelfSignupBonusOnReferralActivation({
  activatedUserId,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "releaseHeldSelfSignupBonusOnReferralActivation requires an open mongoose session.",
    );
  }
  if (!activatedUserId) return [];

  const heldSelf = await MlmCommissionEvent.findOne({
    recipientId: activatedUserId,
    bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
    status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
  }).session(session);

  if (!heldSelf) return [];

  const released = await creditHeldSignupBonusEvent(heldSelf, {
    session,
    correlationId,
    releaseMeta: {
      releasedOnReferralActivation: String(activatedUserId),
    },
  });

  return [released];
}

export async function releaseHeldSignupBonusesForSponsorActivation({
  sponsorUserId,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "releaseHeldSignupBonusesForSponsorActivation requires an open mongoose session.",
    );
  }
  if (!sponsorUserId) return [];

  const heldEvents = await MlmCommissionEvent.find({
    status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
    "meta.unpaidSponsorUserId": String(sponsorUserId),
  }).session(session);

  if (!heldEvents.length) return [];

  const released = [];
  for (const event of heldEvents) {
    released.push(
      await creditHeldSignupBonusEvent(event, {
        session,
        correlationId,
        releaseMeta: {
          releasedOnSponsorActivation: String(sponsorUserId),
        },
      }),
    );
  }

  return released;
}

/**
 * Claw back signup bonuses that were incorrectly credited while the
 * sponsor was still unpaid, and re-create HELD commission events.
 */
export async function reclawSignupBonusesForUnpaidSponsor({
  referralUserId,
  referralMembership,
  sponsorUserId,
  sponsorMembership,
  session,
  correlationId = null,
}) {
  const cfg = await getSignupBonusConfig();
  if (!cfg.enabled) return { clawed: 0 };

  let clawed = 0;
  const referralId = String(referralUserId);
  const sponsorId = String(sponsorUserId);

  const pairs = [
    {
      idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${referralId}`,
      recipientUserId: referralUserId,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
      amount: cfg.selfAmount,
      recipientMembershipId: referralMembership?._id,
      sourceUserId: sponsorUserId,
    },
    {
      idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${sponsorId}-${referralId}`,
      recipientUserId: sponsorUserId,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
      amount: cfg.sponsorAmount,
      recipientMembershipId: sponsorMembership?._id,
      sourceUserId: referralUserId,
    },
  ];

  for (const row of pairs) {
    if (row.amount <= 0) continue;

    const credited = await MlmCommissionEvent.findOne({
      idempotencyKey: row.idempotencyKey,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    }).session(session);

    if (credited?.ledgerEntryId) {
      await debitWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: row.recipientUserId,
        amount: credited.cappedAmount || credited.bonusAmount || row.amount,
        bucket: "shopping",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
        ledgerReference: `${row.idempotencyKey}-CLAW`,
        ledgerDescription:
          "Signup bonus reversed — sponsor was unpaid at referral time",
        idempotencyKey: `${row.idempotencyKey}-CLAW`,
        correlationId,
        syncUserWalletBalance: false,
      });
      credited.status = MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK;
      credited.clawbackAt = new Date();
      credited.clawbackAmount = credited.cappedAmount || credited.bonusAmount;
      await credited.save({ session });
      clawed += 1;
    }

    const held = await MlmCommissionEvent.findOne({
      idempotencyKey: row.idempotencyKey,
      status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
    }).session(session);

    if (!held) {
      await emitHeldSignupBonusEvent({
        recipientUserId: row.recipientUserId,
        recipientMembershipId: row.recipientMembershipId,
        sourceUserId: row.sourceUserId,
        bonusType: row.bonusType,
        amount: row.amount,
        idempotencyKey: row.idempotencyKey,
        correlationId,
        unpaidSponsorUserId: sponsorUserId,
        referralUserId: referralUserId,
        session,
      });
    }
  }

  if (referralMembership?.signupBonusCreditedAt) {
    referralMembership.signupBonusCreditedAt = null;
    await referralMembership.save({ session });
  }

  return { clawed };
}

async function resolveUnpaidSponsorUserIdForSignupEvent(event, session) {
  const meta = event?.meta || {};
  if (meta.unpaidSponsorUserId) return String(meta.unpaidSponsorUserId);
  if (meta.sponsorUserId) return String(meta.sponsorUserId);

  if (event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SELF) {
    const membership = await MlmMembership.findOne({ userId: event.recipientId })
      .select("sponsorId")
      .session(session);
    return membership?.sponsorId ? String(membership.sponsorId) : null;
  }

  if (event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR) {
    return event.recipientId ? String(event.recipientId) : null;
  }

  return null;
}

async function restoreOneClawedSignupBonusEvent(event, { session, correlationId }) {
  const amount = roundCurrency(
    event.bonusAmount || event.clawbackAmount || event.cappedAmount || 0,
  );
  if (amount <= 0) {
    return { skipped: "ZERO_AMOUNT", idempotencyKey: event.idempotencyKey };
  }

  const alreadyCredited = await MlmCommissionEvent.findOne({
    idempotencyKey: event.idempotencyKey,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
  }).session(session);
  if (alreadyCredited) {
    return { skipped: "ALREADY_CREDITED", idempotencyKey: event.idempotencyKey };
  }

  const live = await MlmCommissionEvent.findById(event._id).session(session);
  if (!live || live.status !== MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK) {
    return { skipped: "NOT_CLAWED", idempotencyKey: event.idempotencyKey };
  }

  const ledgerType =
    live.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
      ? LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR
      : LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF;

  const restoreIdempotencyKey = `${live.idempotencyKey}-RESTORE`;
  const creditResult = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: live.recipientId,
    amount,
    bucket: "shopping",
    session,
    ledgerType,
    ledgerReference: restoreIdempotencyKey,
    ledgerDescription:
      live.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
        ? "MLM signup bonus — referral acquired (restored after sponsor activation)"
        : "MLM signup bonus — welcome credit (restored after sponsor activation)",
    metadata: {
      ...(live.meta || {}),
      restoredFromClawback: true,
      originalIdempotencyKey: live.idempotencyKey,
    },
    idempotencyKey: restoreIdempotencyKey,
    correlationId,
    syncUserWalletBalance: false,
  });

  live.status = MLM_COMMISSION_EVENT_STATUS.CREDITED;
  live.cappedAmount = amount;
  live.rolloverAmount = 0;
  live.clawbackAt = undefined;
  live.clawbackAmount = undefined;
  live.ledgerEntryId = creditResult?.ledgerEntry?._id || null;
  live.releasedAt = new Date();
  live.description =
    live.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
      ? "MLM signup bonus — referral acquired"
      : "MLM signup bonus — welcome credit";
  await live.save({ session });

  if (live.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SELF) {
    const recipientMembership = live.recipientMembershipId
      ? await MlmMembership.findById(live.recipientMembershipId).session(session)
      : await MlmMembership.findOne({ userId: live.recipientId }).session(session);
    if (recipientMembership && !recipientMembership.signupBonusCreditedAt) {
      recipientMembership.signupBonusCreditedAt = new Date();
      await recipientMembership.save({ session });
    }
  }

  return {
    restored: true,
    idempotencyKey: live.idempotencyKey,
    recipientId: String(live.recipientId),
    bonusType: live.bonusType,
    amount,
  };
}

/**
 * Re-credit signup bonuses that were clawed back while the sponsor was
 * unpaid but the sponsor is now ACTIVE. Also handles the gap where clawback
 * left CLAWED_BACK rows instead of HELD rows (idempotencyKey collision).
 */
export async function restoreClawedSignupBonusesForActivatedSponsors({
  sponsorUserId = null,
  recipientUserId = null,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "restoreClawedSignupBonusesForActivatedSponsors requires an open mongoose session.",
    );
  }

  const clawedQuery = {
    bonusType: {
      $in: [MLM_BONUS_TYPE.SIGNUP_BONUS_SELF, MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR],
    },
    status: MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
  };
  if (recipientUserId) {
    clawedQuery.recipientId = recipientUserId;
  }

  const clawedEvents = await MlmCommissionEvent.find(clawedQuery).session(session);

  const restored = [];
  const skipped = [];

  for (const event of clawedEvents) {
    const unpaidSponsorUserId = await resolveUnpaidSponsorUserIdForSignupEvent(
      event,
      session,
    );
    if (!unpaidSponsorUserId) {
      skipped.push({
        idempotencyKey: event.idempotencyKey,
        reason: "NO_UNPAID_SPONSOR",
      });
      continue;
    }
    if (sponsorUserId && String(sponsorUserId) !== unpaidSponsorUserId) {
      continue;
    }

    const sponsorMembership = await MlmMembership.findOne({
      userId: unpaidSponsorUserId,
    }).session(session);
    if (
      !sponsorMembership
      || sponsorMembership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE
    ) {
      skipped.push({
        idempotencyKey: event.idempotencyKey,
        reason: "SPONSOR_NOT_ACTIVE",
        unpaidSponsorUserId,
      });
      continue;
    }

    const result = await restoreOneClawedSignupBonusEvent(event, {
      session,
      correlationId,
    });
    if (result.restored) restored.push(result);
    else skipped.push(result);
  }

  return { restored, skipped };
}

/** @deprecated Self bonus at activation is unused; kept for API compat. */
export async function applySelfSignupBonusAtActivation({
  newCustomerId,
  newMembership,
  session,
  correlationId = null,
}) {
  if (newMembership.signupBonusCreditedAt) {
    return { skipped: "ALREADY_CREDITED", selfCredit: null };
  }
  return { skipped: "DEFERRED_TO_REGISTRATION_OR_SPONSOR_RELEASE", selfCredit: null };
}

export async function applyRegistrationBonusStandalone({
  newCustomerId,
  newMembership,
  sponsorUserId = null,
  sponsorMembership = null,
  correlationId = null,
}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await applyRegistrationBonusInSession({
        newCustomerId,
        newMembership,
        sponsorUserId,
        sponsorMembership,
        session,
        correlationId,
      });
    });
  } finally {
    await session.endSession();
  }
  return result;
}

export async function applyDirectReferralActivationBonusStandalone({
  activatedUserId,
  activatedMembership,
  correlationId = null,
}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await applyDirectReferralActivationBonusInSession({
        activatedUserId,
        activatedMembership,
        session,
        correlationId,
      });
    });
  } finally {
    await session.endSession();
  }
  return result;
}

export async function applyDirectReferralPerActivationBonusStandalone({
  activatedUserId,
  activatedMembership,
  correlationId = null,
}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await applyDirectReferralPerActivationBonusInSession({
        activatedUserId,
        activatedMembership,
        session,
        correlationId,
      });
    });
  } finally {
    await session.endSession();
  }
  return result;
}

export async function applyDirectReferralFirstPairBonusStandalone({
  activatedUserId,
  activatedMembership,
  correlationId = null,
  backfill = false,
}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await applyDirectReferralFirstPairBonusInSession({
        activatedUserId,
        activatedMembership,
        session,
        correlationId,
        backfill,
      });
    });
  } finally {
    await session.endSession();
  }
  return result;
}
