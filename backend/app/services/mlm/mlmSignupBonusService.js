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
 * first direct-pair income are the same payout and share one row.
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
    return MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION;
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
    byType.set(MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION, {
      total: Number(canonical.cappedAmount) || 0,
      count: 1,
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

/** Count active Plan A directs on each binary leg under the sponsor. */
export function countDirectReferralLegPairsFromLegMap(directReferrals, legByReferralId) {
  let left = 0;
  let right = 0;
  for (const ref of directReferrals || []) {
    const leg = legByReferralId.get(String(ref._id));
    if (leg === "L") left += 1;
    else if (leg === "R") right += 1;
  }
  return { left, right, pairs: Math.min(left, right) };
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
 * neither the sponsor nor the new referral receives the signup bonus in
 * wallet/history. Both amounts are held until the sponsor activates.
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
  if (existing) return existing;

  const description =
    bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
      ? "MLM signup bonus — referral acquired (held until sponsor activates)"
      : "MLM signup bonus — welcome credit (held until sponsor activates)";

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

  const amount = roundCurrency(cfg.perActivation.amount);
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
  if (existing) {
    return { skipped: "ALREADY_CREDITED", event: existing };
  }

  if (await hasCreditedBinaryPairMatchIndex(sponsorUserId, 1, { session })) {
    return { skipped: "BINARY_PAIR_ALREADY_PAID", event: null };
  }

  const mlmCfg = await getMlmConfig();
  const directCount = await countActivePlanADirects(sponsorUserId, { session });
  const amount = roundCurrency(
    resolveFirstDirectPairIncomeAmount(
      mlmCfg,
      directCount,
      Boolean(sponsorMembership.binaryTopupMember),
      cfg.firstPair.amount,
    ),
  );
  if (amount <= 0) {
    return { skipped: "DISABLED", event: null };
  }
  const result = await creditDirectReferralEarning({
    sponsorUserId,
    sponsorMembership,
    activatedUserId,
    amount,
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    idempotencyKey,
    description: "Direct referral first-pair activation income",
    meta: {
      incomeType: "FIRST_DIRECT_PAIR",
      pairIndex: 1,
      leftDirectCount: pairsAfter.left,
      rightDirectCount: pairsAfter.right,
      directCount,
      pairIncome: amount,
    },
    session,
    correlationId,
  });

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
        releasedOnSponsorActivation: String(sponsorUserId),
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

    released.push({
      eventId: event._id,
      bonusType: event.bonusType,
      recipientId: event.recipientId,
      amount: event.bonusAmount,
    });
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
