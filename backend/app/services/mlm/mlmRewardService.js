import mongoose from "mongoose";
import MlmRewardMilestone from "../../models/mlmRewardMilestone.js";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import {
  MLM_BONUS_TYPE,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MILESTONE_REWARD_TYPE,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { LEDGER_TRANSACTION_TYPE, OWNER_TYPE } from "../../constants/finance.js";
import { creditWallet } from "../finance/walletService.js";
import { getMembershipByUserId } from "./mlmMembershipService.js";
import { roundCurrency } from "../../utils/money.js";

/**
 * Phase 4 — Milestone Reward Engine.
 *
 * Runs after every commission credit (called from
 * `creditBonusToEarningsWallet` via a dynamic import to avoid cycles).
 * Scans the active `MlmRewardMilestone` rules table for thresholds the
 * member has just crossed and credits the configured reward.
 *
 * Supported milestoneType values:
 *   - LIFETIME_EARNINGS (any plan)
 *   - LIFETIME_PLAN_A_EARNINGS
 *   - LIFETIME_PLAN_B_EARNINGS
 *   - DIRECT_REFERRALS_COUNT
 *   - TOTAL_DOWNLINE_COUNT
 *
 * Supported rewardType values:
 *   - SHOPPING_CREDIT → credits `shoppingBalance`
 *   - EARNING_CREDIT  → credits `pending` (subject to release window)
 *   - COUPON          → creates a coupon-linked audit row (Phase 4 logs
 *                       only; the integrated coupon issuance lives in
 *                       a future iteration)
 *
 * Idempotent via `MLM-GVM-<membershipId>-<milestoneId>` — once a
 * milestone has been awarded to a member it never fires again.
 */
export async function evaluateMilestonesAfterCommission({ userId, session }) {
  if (!userId) return [];

  const membership = await getMembershipByUserId(userId, { session });
  if (!membership) return [];

  const planType = membership.planType || MLM_PLAN_TYPE.A;
  const lifetime = (membership.lifetimePlanAEarnings || 0)
    + (membership.lifetimePlanBEarnings || 0);

  const rules = await MlmRewardMilestone.find({ active: true }, null, { session });
  if (!rules.length) return [];

  const triggered = [];

  for (const rule of rules) {
    // Plan gating
    if (rule.planRequired && rule.planRequired !== "ANY" && rule.planRequired !== planType) {
      continue;
    }

    const currentValue = valueForMilestoneType(rule.milestoneType, membership, lifetime);
    if (currentValue < Number(rule.threshold)) continue;

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.GIFT_VOUCHER_MILESTONE}-${membership._id}-${rule._id}`;
    const existing = await MlmCommissionEvent.findOne(
      { idempotencyKey },
      { _id: 1 },
      session ? { session } : {},
    ).lean();
    if (existing) continue; // already awarded

    const event = await awardMilestone({
      membership,
      rule,
      currentValue,
      idempotencyKey,
      session,
    });
    if (event) triggered.push(event);
  }
  return triggered;
}

function valueForMilestoneType(type, membership, lifetimeAll) {
  switch (type) {
    case "LIFETIME_EARNINGS":
      return lifetimeAll;
    case "LIFETIME_PLAN_A_EARNINGS":
      return membership.lifetimePlanAEarnings || 0;
    case "LIFETIME_PLAN_B_EARNINGS":
      return membership.lifetimePlanBEarnings || 0;
    case "DIRECT_REFERRALS_COUNT":
      return membership.directReferralsCount || 0;
    case "TOTAL_DOWNLINE_COUNT":
      return membership.totalDownlineCount || 0;
    default:
      return 0;
  }
}

async function awardMilestone({ membership, rule, currentValue, idempotencyKey, session }) {
  const amount = roundCurrency(Number(rule.rewardAmount) || 0);
  const bucketByReward = {
    [MLM_MILESTONE_REWARD_TYPE.SHOPPING_CREDIT]: "shopping",
    [MLM_MILESTONE_REWARD_TYPE.EARNING_CREDIT]: "pending",
    [MLM_MILESTONE_REWARD_TYPE.COUPON]: null,
  };
  const bucket = bucketByReward[rule.rewardType];

  let ledgerEntryId = null;
  if (bucket && amount > 0) {
    try {
      const result = await creditWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: membership.userId,
        amount,
        bucket,
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_GIFT_VOUCHER_MILESTONE,
        ledgerReference: idempotencyKey,
        ledgerDescription: `Milestone reward: ${rule.name || rule.milestoneType}`,
        idempotencyKey,
        correlationId: `MILESTONE-${rule._id}`,
        metadata: {
          mlmEvent: "MILESTONE_AWARDED",
          milestoneRuleId: String(rule._id),
          milestoneType: rule.milestoneType,
          threshold: rule.threshold,
          currentValue,
        },
        syncUserWalletBalance: false,
      });
      ledgerEntryId = result?.ledgerEntry?._id || null;
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[mlmRewardService] milestone wallet credit failed", {
          milestoneId: String(rule._id),
          userId: String(membership.userId),
          error: error.message,
        });
      }
    }
  }

  const [event] = await MlmCommissionEvent.create(
    [
      {
        recipientId: membership.userId,
        recipientMembershipId: membership._id,
        sourceUserId: null,
        bonusType: MLM_BONUS_TYPE.GIFT_VOUCHER_MILESTONE,
        planType: membership.planType,
        level: null,
        baseAmount: 0,
        ratePercent: null,
        bonusAmount: amount,
        cappedAmount: amount,
        walletBucket: bucket || "pending",
        ledgerEntryId,
        status: "credited",
        idempotencyKey,
        description: `Milestone: ${rule.name || rule.milestoneType} at ${rule.threshold}`,
        meta: {
          milestoneRuleId: String(rule._id),
          milestoneType: rule.milestoneType,
          rewardType: rule.rewardType,
          threshold: rule.threshold,
          currentValue,
          couponId: rule.couponId ? String(rule.couponId) : null,
        },
      },
    ],
    session ? { session } : {},
  );

  // Phase 5: milestone-reached notification. Non-blocking.
  try {
    const { emitNotificationEvent } = await import(
      "../../modules/notifications/notification.emitter.js"
    );
    const { NOTIFICATION_EVENTS } = await import(
      "../../modules/notifications/notification.constants.js"
    );
    emitNotificationEvent(NOTIFICATION_EVENTS.MLM_MILESTONE_REACHED, {
      userId: String(membership.userId),
      data: {
        milestoneId: String(rule._id),
        milestoneName: rule.name || rule.milestoneType,
        rewardType: rule.rewardType,
        rewardAmount: amount,
      },
    });
  } catch (_) {
    /* non-fatal */
  }

  return event;
}
