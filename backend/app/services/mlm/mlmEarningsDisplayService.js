import MlmMembership from "../../models/mlmMembership.js";
import {
  MLM_BONUS_TYPE,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { classifyDirectReferralsByLegUnderRoot } from "./mlmBinaryTreeBuilder.js";
import { computeBinaryTeamPairEarnedAtByIndex } from "./mlmBinaryPairIncomeService.js";
import {
  isDirectReferralFirstPairCommissionEvent,
  isBinaryPairMatchIndexCommissionEvent,
} from "./mlmFirstPairIncomeGuard.js";
import {
  resolvePerActivationActivatedUserId,
} from "./mlmSignupBonusService.js";
import { lookupMembershipTimelineByUserIds } from "../../utils/mlmMemberJoinedAt.js";

/**
 * When the sponsor's first direct L+R pair completed (one-time first-pair income).
 */
export async function computeFirstDirectPairEarnedAt(membership, { session } = {}) {
  if (!membership?.userId) return null;

  const directs = await MlmMembership.find({
    sponsorId: membership.userId,
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
  })
    .sort({ planAJoinedAt: 1, createdAt: 1 })
    .session(session || null)
    .lean();

  if (!directs.length) return null;

  const legByReferralId = await classifyDirectReferralsByLegUnderRoot({
    rootMembership: membership,
    directReferrals: directs,
  });

  let left = 0;
  let right = 0;
  for (const direct of directs) {
    const leg = legByReferralId.get(String(direct.userId));
    if (leg === "L") left += 1;
    else if (leg === "R") right += 1;

    if (Math.min(left, right) >= 1) {
      return direct.planAJoinedAt || direct.createdAt || null;
    }
  }

  return null;
}

export async function buildEarnedAtLookups(recipientMembership, { session } = {}) {
  const [pairEarnedAt, firstDirectPairAt] = await Promise.all([
    computeBinaryTeamPairEarnedAtByIndex(recipientMembership, { session }),
    computeFirstDirectPairEarnedAt(recipientMembership, { session }),
  ]);

  return { pairEarnedAt, firstDirectPairAt };
}

export function resolveEarnedAtForCommissionEvent(event, lookups, timelineByUserId) {
  if (!event) return null;

  if (event.bonusType === MLM_BONUS_TYPE.BINARY_PAIR_MATCH) {
    const pairIndex = Number(event.meta?.pairIndex);
    if (pairIndex > 0 && lookups?.pairEarnedAt?.has(pairIndex)) {
      return lookups.pairEarnedAt.get(pairIndex);
    }
  }

  if (isDirectReferralFirstPairCommissionEvent(event) && lookups?.firstDirectPairAt) {
    return lookups.firstDirectPairAt;
  }

  if (event.bonusType === MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION) {
    const activatedUserId = resolvePerActivationActivatedUserId(event);
    if (activatedUserId) {
      const timeline = timelineByUserId?.get(String(activatedUserId));
      if (timeline?.planAJoinedAt) return timeline.planAJoinedAt;
    }
  }

  return event.creditedAt || event.createdAt || null;
}

export async function enrichCommissionEventsWithEarnedAt(
  recipientUserId,
  items,
  { session } = {},
) {
  if (!items?.length) return items;

  const membership = await MlmMembership.findOne({ userId: recipientUserId })
    .session(session || null)
    .lean();
  if (!membership) return items;

  const lookups = await buildEarnedAtLookups(membership, { session });

  const activatedUserIds = items
    .map((row) => resolvePerActivationActivatedUserId(row))
    .filter(Boolean);
  const timelineByUserId = await lookupMembershipTimelineByUserIds(activatedUserIds);

  return items.map((row) => {
    const earnedAt = resolveEarnedAtForCommissionEvent(row, lookups, timelineByUserId);
    if (!earnedAt) return row;
    return {
      ...row,
      earnedAt,
      recordedAt: row.createdAt,
    };
  });
}

export function resolveEarnedAtForWalletLedgerRow(row, lookups) {
  if (!row) return null;

  const pairIndex = Number(row.metadata?.pairIndex);
  if (pairIndex > 0 && lookups?.pairEarnedAt?.has(pairIndex)) {
    return lookups.pairEarnedAt.get(pairIndex);
  }

  if (row.metadata?.activatedUserPlanAJoinedAt) {
    return row.metadata.activatedUserPlanAJoinedAt;
  }

  return row.createdAt || null;
}

export async function enrichWalletHistoryWithEarnedAt(
  recipientUserId,
  items,
  { session } = {},
) {
  if (!items?.length) return items;

  const membership = await MlmMembership.findOne({ userId: recipientUserId })
    .session(session || null)
    .lean();
  if (!membership) return items;

  const lookups = await buildEarnedAtLookups(membership, { session });

  return items.map((row) => {
    const earnedAt = resolveEarnedAtForWalletLedgerRow(row, lookups);
    if (!earnedAt || earnedAt === row.createdAt) return row;
    return {
      ...row,
      earnedAt,
      recordedAt: row.createdAt,
    };
  });
}

export function isFirstPairIncomeDisplayEvent(event) {
  return (
    isDirectReferralFirstPairCommissionEvent(event)
    || isBinaryPairMatchIndexCommissionEvent(event, 1)
  );
}
