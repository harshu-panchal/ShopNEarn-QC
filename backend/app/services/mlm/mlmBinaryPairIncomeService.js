import mongoose from "mongoose";
import MlmMembership from "../../models/mlmMembership.js";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { getMlmConfig, resolvePlanABonusWalletBucket, getPlanAPairBonusForPairIndex } from "./mlmConfigService.js";
import { getMembershipByUserId } from "./mlmMembershipService.js";
import { creditBonusToEarningsWallet } from "./mlmBonusEngineService.js";
import { MLM_IDEMPOTENCY_PREFIX } from "../../constants/mlm.js";
import { hasCreditedDirectReferralFirstPairIncome } from "./mlmFirstPairIncomeGuard.js";
import { roundCurrency } from "../../utils/money.js";

// Canonical baseline every hardcoded tier amount below is expressed as
// a multiple of (200 => 1x, 250 => 1.25x, etc). A joining plan's
// `benefitBaseAmount` substitutes for this baseline to proportionally
// scale sponsor/referral/pair-matching bonuses for that plan's members.
const CANONICAL_BONUS_BASE = 200;

const IST_TZ_OFFSET_MIN = 330;
const ACTIVE_BINARY_PLAN_TYPES = [MLM_PLAN_TYPE.A, MLM_PLAN_TYPE.B];

function todayIstDateString(now = new Date()) {
  const local = new Date(now.getTime() + IST_TZ_OFFSET_MIN * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Mirror of client PHP `getPairIncome($directCount, $isTopup)`.
 * Tiers are read from `Setting.mlm.binaryPairIncomeTiers` (highest
 * `minDirectCount` first). Topup override from `binaryTopupPairIncome`.
 */
export function resolvePairIncomeConfig(cfg, directCount, isTopup = false) {
  if (isTopup) {
    const topup = cfg.binaryTopupPairIncome || {};
    return {
      pairIncome: Number(topup.pairIncome) || 550,
      dailyPairCap: Number(topup.dailyPairCap) || 20,
    };
  }

  const tiers = [...(cfg.binaryPairIncomeTiers || [])].sort(
    (a, b) => Number(b.minDirectCount) - Number(a.minDirectCount),
  );

  for (const tier of tiers) {
    if (Number(directCount) >= Number(tier.minDirectCount)) {
      return {
        pairIncome: Number(tier.pairIncome) || 0,
        dailyPairCap: Number(tier.dailyPairCap) || 0,
      };
    }
  }

  return { pairIncome: 0, dailyPairCap: 0 };
}

/**
 * First direct L+R pair income rule:
 *   - 3+ active directs => 1.25x baseAmount (₹250 at the canonical ₹200 base)
 *   - 2 active directs  => 1x baseAmount (₹200 at the canonical base)
 *   - fallback          => configured flat fallback
 *
 * `baseAmount` defaults to the canonical ₹200 baseline but is meant to
 * be the *activated* member's joining-plan `benefitBaseAmount` when
 * available, so bigger plans pay proportionally bigger first-pair bonuses.
 *
 * Team-pair income (`resolvePairIncomeConfig`) remains independent and
 * can continue to be ₹300/₹400 based on higher direct-count tiers.
 */
export function resolveFirstDirectPairIncomeAmount(
  cfg,
  directCount,
  isTopup = false,
  flatFallback = 0,
  baseAmount = CANONICAL_BONUS_BASE,
) {
  const directs = Number(directCount) || 0;
  const base = Number(baseAmount);
  const safeBase = Number.isFinite(base) && base >= 0 ? base : CANONICAL_BONUS_BASE;
  if (directs >= 3) return roundCurrency(safeBase * 1.25);
  if (directs >= 2) return safeBase;
  const fallback = Number(flatFallback);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

/**
 * Mirror of client PHP `calculateBinaryIncome`.
 * First pair requires 2:1 or 1:2; only after that opener do 1:1 pairs count.
 */
export function calculateBinaryPairs(leftActive, rightActive) {
  let left = Math.max(0, Number(leftActive) || 0);
  let right = Math.max(0, Number(rightActive) || 0);
  let pairs = 0;

  if (left >= 2 && right >= 1) {
    left -= 2;
    right -= 1;
    pairs += 1;
    const extraPairs = Math.min(left, right);
    pairs += extraPairs;
    left -= extraPairs;
    right -= extraPairs;
  } else if (right >= 2 && left >= 1) {
    right -= 2;
    left -= 1;
    pairs += 1;
    const extraPairs = Math.min(left, right);
    pairs += extraPairs;
    left -= extraPairs;
    right -= extraPairs;
  }

  return {
    pairs,
    leftBalance: left,
    rightBalance: right,
  };
}

/**
 * Count active Plan A members in the binary subtree rooted at `rootUserId`
 * (includes the root node when active Plan A).
 */
export async function countActivePlanAInBinarySubtree(rootUserId, { session } = {}) {
  if (!rootUserId) return 0;

  const pipeline = [
    { $match: { userId: new mongoose.Types.ObjectId(String(rootUserId)) } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
        // No maxDepth: production trees exceed 64 levels and a depth cap
        // silently drops deep members from leg volumes, shorting pair
        // income for high uplines. $graphLookup is cycle-safe without it.
      },
    },
    {
      $project: {
        activeCount: {
          $add: [
            {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", MLM_MEMBERSHIP_STATUS.ACTIVE] },
                    { $in: ["$planType", ACTIVE_BINARY_PLAN_TYPES] },
                  ],
                },
                1,
                0,
              ],
            },
            {
              $size: {
                $filter: {
                  input: "$descendants",
                  as: "d",
                  cond: {
                    $and: [
                      { $eq: ["$$d.status", MLM_MEMBERSHIP_STATUS.ACTIVE] },
                      { $in: ["$$d.planType", ACTIVE_BINARY_PLAN_TYPES] },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    },
  ];

  const agg = session
    ? await MlmMembership.aggregate(pipeline).session(session)
    : await MlmMembership.aggregate(pipeline);

  return Number(agg[0]?.activeCount) || 0;
}

export async function countLegActivePlanAVolumes(sponsorMembership, { session } = {}) {
  const [leftActive, rightActive] = await Promise.all([
    countActivePlanAInBinarySubtree(sponsorMembership.binaryLeftChildId, { session }),
    countActivePlanAInBinarySubtree(sponsorMembership.binaryRightChildId, { session }),
  ]);
  return { leftActive, rightActive };
}

/**
 * Full team-pair snapshot for one member (no wallet credits).
 */
export async function computeBinaryTeamPairSnapshot(membership, { session } = {}) {
  const { leftActive, rightActive } = await countLegActivePlanAVolumes(membership, {
    session,
  });
  const pairResult = calculateBinaryPairs(leftActive, rightActive);

  return {
    leftLegTeamActiveCount: leftActive,
    rightLegTeamActiveCount: rightActive,
    binaryPairsEligible: pairResult.pairs,
    binaryLeftBalance: pairResult.leftBalance,
    binaryRightBalance: pairResult.rightBalance,
  };
}

export async function countPaidBinaryPairEvents(recipientUserId, { session } = {}) {
  const filter = {
    recipientId: recipientUserId,
    bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
  };
  return MlmCommissionEvent.countDocuments(filter, session ? { session } : {});
}

export async function countActivePlanADirects(sponsorUserId, { session } = {}) {
  return MlmMembership.countDocuments(
    {
      sponsorId: sponsorUserId,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      planType: { $in: ACTIVE_BINARY_PLAN_TYPES },
    },
    session ? { session } : {},
  );
}

async function loadActivePlanAMembersInSubtree(rootUserId, { session } = {}) {
  if (!rootUserId) return [];

  const pipeline = [
    { $match: { userId: new mongoose.Types.ObjectId(String(rootUserId)) } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
        // No maxDepth — must match countActivePlanAInBinarySubtree so the
        // chronological replay sees the same member set as the live count.
      },
    },
    {
      $project: {
        members: {
          $concatArrays: [
            {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", MLM_MEMBERSHIP_STATUS.ACTIVE] },
                    { $in: ["$planType", ACTIVE_BINARY_PLAN_TYPES] },
                  ],
                },
                [
                  {
                    userId: "$userId",
                    planAJoinedAt: "$planAJoinedAt",
                    createdAt: "$createdAt",
                  },
                ],
                [],
              ],
            },
            {
              $map: {
                input: {
                  $filter: {
                    input: "$descendants",
                    as: "d",
                    cond: {
                      $and: [
                        { $eq: ["$$d.status", MLM_MEMBERSHIP_STATUS.ACTIVE] },
                        { $in: ["$$d.planType", ACTIVE_BINARY_PLAN_TYPES] },
                      ],
                    },
                  },
                },
                as: "d",
                in: {
                  userId: "$$d.userId",
                  planAJoinedAt: "$$d.planAJoinedAt",
                  createdAt: "$$d.createdAt",
                },
              },
            },
          ],
        },
      },
    },
    { $unwind: "$members" },
    { $replaceRoot: { newRoot: "$members" } },
    {
      $project: {
        userId: 1,
        activatedAt: {
          $ifNull: ["$planAJoinedAt", "$createdAt"],
        },
      },
    },
  ];

  const agg = session
    ? await MlmMembership.aggregate(pipeline).session(session)
    : await MlmMembership.aggregate(pipeline);

  return agg.filter((row) => row.activatedAt);
}

/**
 * Replay downline Plan A activations chronologically to find when each
 * team binary pair index first became eligible.
 */
export async function computeBinaryTeamPairEarnedAtByIndex(
  membership,
  { session } = {},
) {
  const earnedAtByPair = new Map();
  if (!membership?.userId) return earnedAtByPair;

  const [leftMembers, rightMembers] = await Promise.all([
    loadActivePlanAMembersInSubtree(membership.binaryLeftChildId, { session }),
    loadActivePlanAMembersInSubtree(membership.binaryRightChildId, { session }),
  ]);

  const activations = [
    ...leftMembers.map((row) => ({
      leg: "L",
      at: new Date(row.activatedAt),
    })),
    ...rightMembers.map((row) => ({
      leg: "R",
      at: new Date(row.activatedAt),
    })),
  ]
    .filter((row) => Number.isFinite(row.at?.getTime()))
    .sort((a, b) => a.at - b.at);

  let leftActive = 0;
  let rightActive = 0;
  let prevPairs = 0;

  for (const activation of activations) {
    if (activation.leg === "L") leftActive += 1;
    else rightActive += 1;

    const { pairs } = calculateBinaryPairs(leftActive, rightActive);
    while (prevPairs < pairs) {
      prevPairs += 1;
      earnedAtByPair.set(prevPairs, activation.at);
    }
  }

  return earnedAtByPair;
}

/**
 * Preview the next binary pair payout for dashboard/API surfaces.
 * Uses the same tier resolution as `computeAndCreditBinaryTeamPairIncome`.
 */
export async function getBinaryPairIncomePreview(membership, { session } = {}) {
  if (!membership?.userId) {
    return {
      nextPairBonusAmount: 0,
      dailyPairCap: 0,
      activePlanADirectCount: 0,
      isTopup: false,
      leftLegTeamActiveCount: 0,
      rightLegTeamActiveCount: 0,
      binaryPairsEligible: 0,
      binaryLeftBalance: 0,
      binaryRightBalance: 0,
      pairsRemaining: 0,
    };
  }

  const cfg = await getMlmConfig();
  const directCount = await countActivePlanADirects(membership.userId, { session });
  const isTopup = Boolean(membership.binaryTopupMember);
  const { dailyPairCap } = resolvePairIncomeConfig(cfg, directCount, isTopup);

  const hasSnapshot =
    membership.leftLegTeamActiveCount != null
    && membership.rightLegTeamActiveCount != null;
  const snapshot = hasSnapshot
    ? {
        leftLegTeamActiveCount: membership.leftLegTeamActiveCount || 0,
        rightLegTeamActiveCount: membership.rightLegTeamActiveCount || 0,
        binaryPairsEligible: membership.binaryPairsEligible || 0,
        binaryLeftBalance: membership.binaryLeftBalance || 0,
        binaryRightBalance: membership.binaryRightBalance || 0,
      }
    : await computeBinaryTeamPairSnapshot(membership, { session });

  const pairsCompleted = Number(membership.pairsCompleted) || 0;
  const pairsRemaining = Math.max(
    (snapshot.binaryPairsEligible || 0) - pairsCompleted,
    0,
  );

  const nextPairIndex = pairsCompleted + 1;
  let nextPairBonusAmount = 0;
  if (isTopup) {
    nextPairBonusAmount = Number(cfg.binaryTopupPairIncome?.pairIncome) || 550;
  } else {
    nextPairBonusAmount = await getPlanAPairBonusForPairIndex(nextPairIndex);
  }

  return {
    nextPairBonusAmount,
    dailyPairCap,
    activePlanADirectCount: directCount,
    isTopup,
    ...snapshot,
    pairsRemaining,
  };
}

/**
 * Set `binaryTopupMember` when lifetime earnings cross the configured threshold.
 */
export async function syncBinaryTopupMemberFlag(membership, { session, cfg } = {}) {
  if (!membership || membership.binaryTopupMember) return membership;
  const config = cfg || (await getMlmConfig());
  const threshold = Number(config.binaryTopupPairIncome?.eligibilityLifetimeEarnings) || 0;
  if (threshold <= 0) return membership;

  const lifetime =
    (Number(membership.lifetimePlanAEarnings) || 0)
    + (Number(membership.lifetimePlanBEarnings) || 0);
  if (lifetime < threshold) return membership;

  membership.binaryTopupMember = true;
  await membership.save({ session });
  return membership;
}

/**
 * Walk binary-parent chain upward from `startUserId` (exclusive of start).
 */
async function getBinaryAncestorUserIds(startUserId, { session } = {}) {
  const ids = [];
  let cursor = await getMembershipByUserId(startUserId, { session });
  if (!cursor?.binaryParentId) return ids;

  let parentId = cursor.binaryParentId;
  const seen = new Set();
  while (parentId && !seen.has(String(parentId))) {
    seen.add(String(parentId));
    ids.push(parentId);
    const parent = await getMembershipByUserId(parentId, { session });
    if (!parent) break;
    parentId = parent.binaryParentId;
  }
  return ids;
}

/**
 * Credit newly completed binary pairs for one sponsor after a downline
 * activation changed leg volumes. Idempotent per pair index.
 */
export async function computeAndCreditBinaryTeamPairIncome({
  sponsorUserId,
  triggerUserId,
  session,
  correlationId = null,
}) {
  if (!sponsorUserId) return [];

  const cfg = await getMlmConfig();
  const sponsor = await getMembershipByUserId(sponsorUserId, { session });
  if (!sponsor || sponsor.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) return [];

  const { leftActive, rightActive } = await countLegActivePlanAVolumes(sponsor, { session });
  const { pairs: totalPairsEligible } = calculateBinaryPairs(leftActive, rightActive);

  const alreadyPaid = Number(sponsor.pairsCompleted) || 0;
  let newPairs = totalPairsEligible - alreadyPaid;
  if (newPairs <= 0) return [];

  const directCount = await countActivePlanADirects(sponsorUserId, { session });
  const isTopup = Boolean(sponsor.binaryTopupMember);
  const { pairIncome: defaultPairIncome, dailyPairCap } = resolvePairIncomeConfig(cfg, directCount, isTopup);

  if (dailyPairCap <= 0) return [];

  // Plan-scaled: the triggering member's joining plan snapshots its own
  // benefit base amount at activation — substitutes for the canonical
  // ₹200 baseline that binaryPairIncomeTiers/planAPairBonusTiers are
  // expressed relative to. Topup pair income is a separate, unrelated
  // mechanic and is never scaled. Falls back to 1x (no scaling) for
  // legacy members with no plan snapshot.
  let pairScale = 1;
  if (!isTopup) {
    const triggerMembership = triggerUserId
      ? await getMembershipByUserId(triggerUserId, { session })
      : null;
    const triggerBase = triggerMembership?.benefitBaseAmount;
    if (triggerBase != null && triggerBase >= 0) {
      pairScale = triggerBase / CANONICAL_BONUS_BASE;
    }
  }

  const today = todayIstDateString();
  const tracker = sponsor.binaryDailyPairTracker || {};
  const pairsPaidToday =
    tracker.date === today ? Number(tracker.pairsPaid || 0) : 0;
  const dailyRemaining = Math.max(dailyPairCap - pairsPaidToday, 0);
  newPairs = Math.min(newPairs, dailyRemaining);
  if (newPairs <= 0) return [];

  const bonusBucket = await resolvePlanABonusWalletBucket();
  const events = [];
  for (let i = 0; i < newPairs; i += 1) {
    const pairIndex = alreadyPaid + i + 1;

    if (
      pairIndex === 1
      && (await hasCreditedDirectReferralFirstPairIncome(sponsorUserId, { session }))
    ) {
      continue;
    }

    let currentPairIncome = roundCurrency(defaultPairIncome * pairScale);
    if (!isTopup) {
      const tierIncome = await getPlanAPairBonusForPairIndex(pairIndex);
      currentPairIncome = Math.max(
        roundCurrency(defaultPairIncome * pairScale),
        roundCurrency(tierIncome * pairScale),
      );
    }

    if (currentPairIncome <= 0) continue;

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.BINARY_PAIR_MATCH}-${sponsorUserId}-P${pairIndex}`;

    const event = await creditBonusToEarningsWallet({
      recipientUserId: sponsorUserId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      planType: MLM_PLAN_TYPE.A,
      bonusAmount: currentPairIncome,
      level: null,
      baseAmount: 0,
      ratePercent: null,
      sourceUserId: triggerUserId,
      sourceOrderId: null,
      bucket: bonusBucket,
      description: `Binary pair #${pairIndex} team match (₹${currentPairIncome})`,
      meta: {
        pairIndex,
        matchingMode: "team",
        triggerUserId: triggerUserId ? String(triggerUserId) : null,
        leftActive,
        rightActive,
        leftTeamActive: leftActive,
        rightTeamActive: rightActive,
        directCount,
        pairIncome: currentPairIncome,
        dailyPairCap,
        isTopup,
        leftBalance: calculateBinaryPairs(leftActive, rightActive).leftBalance,
        rightBalance: calculateBinaryPairs(leftActive, rightActive).rightBalance,
      },
      idempotencyKey,
      correlationId,
      session,
    });
    if (event) events.push(event);
  }

  sponsor.pairsCompleted = alreadyPaid + newPairs;
  sponsor.lastPaidPairIndex = sponsor.pairsCompleted;

  const snapshot = await computeBinaryTeamPairSnapshot(sponsor, { session });
  Object.assign(sponsor, snapshot);
  sponsor.binaryPairSnapshotAt = new Date();

  sponsor.binaryDailyPairTracker = {
    date: today,
    pairsPaid: pairsPaidToday + newPairs,
  };
  await sponsor.save({ session });

  return events;
}

/**
 * After a member activates Plan A, re-evaluate binary pair income for
 * every binary ancestor (upline in the placement tree).
 */
export async function propagateBinaryTeamPairIncome({
  activatedUserId,
  session,
  correlationId = null,
}) {
  const ancestorIds = await getBinaryAncestorUserIds(activatedUserId, { session });
  const allEvents = [];

  for (const sponsorUserId of ancestorIds) {
    const events = await computeAndCreditBinaryTeamPairIncome({
      sponsorUserId,
      triggerUserId: activatedUserId,
      session,
      correlationId,
    });
    allEvents.push(...events);
  }

  return allEvents;
}
