import mongoose from "mongoose";
import MlmMembership from "../../models/mlmMembership.js";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { getMlmConfig, resolvePlanABonusWalletBucket } from "./mlmConfigService.js";
import { getMembershipByUserId } from "./mlmMembershipService.js";
import { creditBonusToEarningsWallet } from "./mlmBonusEngineService.js";
import { MLM_IDEMPOTENCY_PREFIX } from "../../constants/mlm.js";
import { hasCreditedDirectReferralFirstPairIncome } from "./mlmFirstPairIncomeGuard.js";

const IST_TZ_OFFSET_MIN = 330;

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
 * First direct L+R pair income uses the same tier table as team pair
 * matching (`binaryPairIncomeTiers`) keyed by active Plan A direct count.
 */
export function resolveFirstDirectPairIncomeAmount(
  cfg,
  directCount,
  isTopup = false,
  flatFallback = 0,
) {
  const { pairIncome } = resolvePairIncomeConfig(cfg, directCount, isTopup);
  if (pairIncome > 0) return pairIncome;
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
        maxDepth: 64,
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
                    { $eq: ["$planType", MLM_PLAN_TYPE.A] },
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
                      { $eq: ["$$d.planType", MLM_PLAN_TYPE.A] },
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
      planType: MLM_PLAN_TYPE.A,
    },
    session ? { session } : {},
  );
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
  const { pairIncome, dailyPairCap } = resolvePairIncomeConfig(cfg, directCount, isTopup);

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

  return {
    nextPairBonusAmount: pairIncome,
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
  const { pairIncome, dailyPairCap } = resolvePairIncomeConfig(cfg, directCount, isTopup);

  if (pairIncome <= 0 || dailyPairCap <= 0) return [];

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

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.BINARY_PAIR_MATCH}-${sponsorUserId}-P${pairIndex}`;

    const event = await creditBonusToEarningsWallet({
      recipientUserId: sponsorUserId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      planType: MLM_PLAN_TYPE.A,
      bonusAmount: pairIncome,
      level: null,
      baseAmount: 0,
      ratePercent: null,
      sourceUserId: triggerUserId,
      sourceOrderId: null,
      bucket: bonusBucket,
      description: `Binary pair #${pairIndex} team match (₹${pairIncome})`,
      meta: {
        pairIndex,
        matchingMode: "team",
        triggerUserId: triggerUserId ? String(triggerUserId) : null,
        leftActive,
        rightActive,
        leftTeamActive: leftActive,
        rightTeamActive: rightActive,
        directCount,
        pairIncome,
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
