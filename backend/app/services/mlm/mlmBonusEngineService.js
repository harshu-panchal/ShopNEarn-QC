import mongoose from "mongoose";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import Order from "../../models/order.js";
import {
  LEDGER_DIRECTION,
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
import { roundCurrency } from "../../utils/money.js";
import { creditWallet } from "../finance/walletService.js";
import {
  getDirectReferralMilestoneBonus,
  getMentorRoyaltyRate,
  getMlmConfig,
  getPlanAPairBonusForPairIndex,
  getRepurchaseBonusRate,
} from "./mlmConfigService.js";
import MlmMembership from "../../models/mlmMembership.js";
import {
  getMembershipByUserId,
  getUplineChain,
  recordLifetimeEarning,
} from "./mlmMembershipService.js";

// NOTE: `mlmActivationService` imports back from this file
// (`computeAndCreditDirectReferralMilestone`). To break the import cycle
// for the auto-upgrade trigger we dynamic-import the activation service
// inside `creditBonusToEarningsWallet` where it's actually called.

/**
 * mlmBonusEngineService — every customer-side bonus credit flows
 * through here. Public functions are all session-bound (per
 * `wallet-ledger-atomicity` skill) and idempotency-key protected
 * (per partial unique index on MlmCommissionEvent.idempotencyKey
 * AND LedgerEntry.idempotencyKey).
 *
 * Phase 1 implements:
 *   - creditBonusToEarningsWallet (the lowest-level credit primitive)
 *   - computeAndCreditDirectReferralMilestone
 *   - applyDailyCap stub (uncapped in Phase 1 to keep Phase 1 atomic
 *     and small — full daily-cap rollover engine lands in Phase 3)
 *
 * Phase 2 will add: computeAndCreditRepurchaseBonusChain,
 *   computeAndCreditMentorRoyaltyForCommission, plus full cap logic.
 * Phase 3 will add: clawbackBonusesOnReturn.
 * Phase 4 will add: computeAndCreditHomeShoppingCommissions.
 */

const IST_TZ_OFFSET_MIN = 330; // +05:30

function todayIstDateString(now = new Date()) {
  // Express the current UTC instant as YYYY-MM-DD in IST.
  const local = new Date(now.getTime() + IST_TZ_OFFSET_MIN * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Apply the per-recipient IST daily earning cap. Returns:
 *   { creditable, rollover, capUsedToday }
 *
 * `membership.dailyCapTracker` is bumped in place so the cap is honest
 * across multiple credits within the same session. The rollover amount
 * is persisted on the event row (status: CAPPED_ROLLOVER) so the
 * `mlmDailyCapRolloverJob` (IST midnight) can re-credit it the next day.
 */
export async function applyDailyCap({ membership, requestedAmount, session }) {
  const cfg = await getMlmConfig();
  const cap = Number(cfg.dailyEarningCap) || 0;
  const today = todayIstDateString();
  const tracker = membership.dailyCapTracker || {};
  const usedToday = tracker.date === today ? Number(tracker.usedAmount || 0) : 0;

  if (cap <= 0) {
    return { creditable: requestedAmount, rollover: 0, capUsedToday: usedToday };
  }

  const remaining = Math.max(cap - usedToday, 0);
  const creditable = Math.min(requestedAmount, remaining);
  const rollover = roundCurrency(requestedAmount - creditable);

  // Persist the tracker bump (event still logs the rollover so the
  // mlmDailyCapRolloverJob can find and re-credit it).
  membership.dailyCapTracker = {
    date: today,
    usedAmount: roundCurrency(usedToday + creditable),
  };
  await membership.save({ session });

  return { creditable, rollover, capUsedToday: roundCurrency(usedToday + creditable) };
}

function ledgerTypeForBonusType(bonusType) {
  switch (bonusType) {
    case MLM_BONUS_TYPE.DIRECT_REFERRAL_MILESTONE:
      return LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_MILESTONE;
    case MLM_BONUS_TYPE.BINARY_PAIR_MATCH:
      return LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH;
    case MLM_BONUS_TYPE.REPURCHASE_BONUS:
      return LEDGER_TRANSACTION_TYPE.MLM_REPURCHASE_BONUS;
    case MLM_BONUS_TYPE.MENTOR_ROYALTY:
      return LEDGER_TRANSACTION_TYPE.MLM_MENTOR_ROYALTY;
    case MLM_BONUS_TYPE.HOME_SHOPPING_SALES:
      return LEDGER_TRANSACTION_TYPE.MLM_HOME_SHOPPING_SALES;
    case MLM_BONUS_TYPE.HOME_SHOPPING_REFERRAL:
      return LEDGER_TRANSACTION_TYPE.MLM_HOME_SHOPPING_REFERRAL;
    case MLM_BONUS_TYPE.HOME_SHOPPING_ROYALTY:
      return LEDGER_TRANSACTION_TYPE.MLM_HOME_SHOPPING_ROYALTY;
    case MLM_BONUS_TYPE.GIFT_VOUCHER_MILESTONE:
      return LEDGER_TRANSACTION_TYPE.MLM_GIFT_VOUCHER_MILESTONE;
    case MLM_BONUS_TYPE.MANUAL_ADJUSTMENT:
      return LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT;
    default:
      throw new Error(`Unknown MLM bonus type: ${bonusType}`);
  }
}

/**
 * Low-level credit primitive. Writes:
 *   1. Wallet bump on the recipient (bucket: "pending" by default — the
 *      existing returnWindowReleaseJob moves it to "available" after
 *      the return window expires).
 *   2. Paired LedgerEntry inside the same session (via walletService).
 *   3. MlmCommissionEvent row inside the same session for richer audit.
 *   4. Bumps lifetime earnings counter (auto-upgrade trigger fires
 *      separately, via mlmActivationService.upgradeToPlanBIfEligible).
 *
 * Returns the persisted MlmCommissionEvent. Idempotency: if an event
 * with the same `idempotencyKey` already exists, returns it without
 * re-crediting.
 */
export async function creditBonusToEarningsWallet({
  recipientUserId,
  bonusType,
  planType,
  bonusAmount,
  level = null,
  baseAmount = 0,
  ratePercent = null,
  sourceUserId = null,
  sourceOrderId = null,
  sourceCommissionEventId = null,
  bucket = "pending", // start in pending; returnWindowReleaseJob releases
  description = "",
  meta = {},
  idempotencyKey,
  correlationId = null,
  session,
}) {
  if (!recipientUserId) throw new Error("recipientUserId is required");
  if (!idempotencyKey) throw new Error("idempotencyKey is required");
  const requested = roundCurrency(bonusAmount || 0);
  if (requested <= 0) return null;

  // Idempotency replay: if the event already exists, short-circuit.
  const existing = await MlmCommissionEvent.findOne(
    { idempotencyKey },
    null,
    session ? { session } : {},
  );
  if (existing) return existing;

  const membership = await getMembershipByUserId(recipientUserId, { session });
  if (!membership || membership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) {
    // Skip credit but still record the attempt for audit. The skip
    // is silent because non-MLM-member is the expected state for
    // most customers; the mentor-royalty cascade may target them.
    return MlmCommissionEvent.create(
      [
        {
          recipientId: recipientUserId,
          recipientMembershipId: membership?._id || null,
          sourceUserId,
          sourceOrderId,
          sourceCommissionEventId,
          bonusType,
          planType,
          level,
          baseAmount: roundCurrency(baseAmount),
          ratePercent,
          bonusAmount: requested,
          cappedAmount: 0,
          rolloverAmount: 0,
          walletBucket: bucket,
          status: MLM_COMMISSION_EVENT_STATUS.SKIPPED,
          idempotencyKey,
          correlationId,
          description: description || `Skipped: recipient not active MLM member`,
          meta,
        },
      ],
      session ? { session } : {},
    ).then((rows) => rows[0]);
  }

  // Apply daily cap (Phase 1 is a no-op when no cap configured).
  const { creditable, rollover } = await applyDailyCap({
    membership,
    requestedAmount: requested,
    session,
  });

  if (creditable <= 0) {
    // Whole amount was rolled over; record an audit row only.
    return MlmCommissionEvent.create(
      [
        {
          recipientId: recipientUserId,
          recipientMembershipId: membership._id,
          sourceUserId,
          sourceOrderId,
          sourceCommissionEventId,
          bonusType,
          planType,
          level,
          baseAmount: roundCurrency(baseAmount),
          ratePercent,
          bonusAmount: requested,
          cappedAmount: 0,
          rolloverAmount: rollover,
          walletBucket: bucket,
          status: MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER,
          idempotencyKey,
          correlationId,
          description,
          meta,
        },
      ],
      session ? { session } : {},
    ).then((rows) => rows[0]);
  }

  const ledgerType = ledgerTypeForBonusType(bonusType);

  // Credit wallet + write paired LedgerEntry atomically inside the session.
  // For MLM bonuses we credit the `pending` bucket so the existing
  // returnWindowReleaseJob can release to "available" later (Phase 2
  // wires the release path to bump `earningsBalance` instead).
  const result = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: recipientUserId,
    amount: creditable,
    bucket,
    session,
    ledgerType,
    ledgerReference: idempotencyKey,
    ledgerDescription: description || `${bonusType}${level ? ` L${level}` : ""}`,
    orderId: sourceOrderId,
    metadata: {
      mlmBonusType: bonusType,
      level,
      ratePercent,
      sourceUserId: sourceUserId ? String(sourceUserId) : null,
      ...meta,
    },
    idempotencyKey,
    correlationId,
    // The customer wallet shopping/earnings buckets are separate from
    // the legacy User.walletBalance mirror; don't double-count MLM
    // credits in the legacy mirror when we credit non-available buckets.
    syncUserWalletBalance: bucket === "available",
  });

  // Persist the richer audit row.
  const [eventDoc] = await MlmCommissionEvent.create(
    [
      {
        recipientId: recipientUserId,
        recipientMembershipId: membership._id,
        sourceUserId,
        sourceOrderId,
        sourceCommissionEventId,
        bonusType,
        planType,
        level,
        baseAmount: roundCurrency(baseAmount),
        ratePercent,
        bonusAmount: requested,
        cappedAmount: creditable,
        rolloverAmount: rollover,
        walletBucket: bucket,
        ledgerEntryId: result?.ledgerEntry?._id || null,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey,
        correlationId,
        description,
        meta,
      },
    ],
    session ? { session } : {},
  );

  // Bump lifetime earnings for the auto-upgrade trigger. Plan type is
  // assigned per-bonus (Plan A bonuses count toward planA totals;
  // Plan B bonuses toward planB totals).
  await recordLifetimeEarning({
    userId: recipientUserId,
    amount: creditable,
    planType,
    session,
  });

  // Phase 2: auto-upgrade check fires on every Plan A credit so the
  // member is promoted as soon as their lifetime Plan A earnings hit
  // the threshold (configurable; default ₹30,000). Dynamic import is
  // used to break the import cycle with `mlmActivationService`.
  if (planType === MLM_PLAN_TYPE.A) {
    try {
      const { upgradeToPlanBIfEligible } = await import("./mlmActivationService.js");
      await upgradeToPlanBIfEligible(recipientUserId, { session });
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[mlmBonusEngineService] upgradeToPlanBIfEligible failed; bonus already credited", {
          userId: String(recipientUserId),
          error: error.message,
        });
      }
    }
  }

  // Phase 5: customer-facing notification for every successful credit.
  // Fired regardless of bucket (pending counts because the customer can
  // already see it under "pending" in their wallet). Non-blocking;
  // emitter uses setImmediate internally.
  try {
    const { emitNotificationEvent } = await import(
      "../../modules/notifications/notification.emitter.js"
    );
    const { NOTIFICATION_EVENTS } = await import(
      "../../modules/notifications/notification.constants.js"
    );
    emitNotificationEvent(NOTIFICATION_EVENTS.MLM_BONUS_CREDITED, {
      userId: String(recipientUserId),
      data: {
        amount: creditable,
        bonusType,
        planType,
        level,
        sourceOrderId: sourceOrderId ? String(sourceOrderId) : null,
        commissionEventId: String(eventDoc._id),
      },
    });
  } catch (_) {
    /* non-fatal */
  }

  // Phase 4: milestone evaluator. After every commission credit
  // check whether the recipient just crossed an admin-defined milestone
  // threshold (lifetime earnings, direct count, etc) and award the
  // configured reward. Dynamic import to break the import cycle with
  // walletService. Failures here are non-fatal — the underlying
  // commission credit has already succeeded.
  try {
    const { evaluateMilestonesAfterCommission } = await import("./mlmRewardService.js");
    await evaluateMilestonesAfterCommission({
      userId: recipientUserId,
      session,
    });
  } catch (error) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[mlmBonusEngineService] milestone evaluator failed", {
        userId: String(recipientUserId),
        error: error.message,
      });
    }
  }

  // Phase 2: mentor-royalty cascade. Every commission credit pays a
  // small share (default L1=10%, L2=5%) to the recipient's upline.
  // Self-funded — comes out of the same notional pool, NOT additional
  // platform money. The cascade is skipped when the source IS already
  // a mentor royalty event to prevent infinite recursion.
  if (
    bonusType !== MLM_BONUS_TYPE.MENTOR_ROYALTY &&
    creditable > 0
  ) {
    try {
      await computeAndCreditMentorRoyaltyForCommission({
        originalCommissionEventId: eventDoc._id,
        recipientUserId,
        bonusAmount: creditable,
        sourceOrderId,
        correlationId,
        session,
      });
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[mlmBonusEngineService] mentor royalty cascade failed; primary credit succeeded", {
          userId: String(recipientUserId),
          error: error.message,
        });
      }
    }
  }

  return eventDoc;
}

/**
 * @deprecated since the Plan A binary pair-matching refactor.
 *
 * The direct-referral COUNT milestone has been replaced by the
 * binary-pair-matching bonus. New activations call
 * `computeAndCreditBinaryPairBonus` instead. This function is kept
 * exported only to avoid breaking any external code that still
 * imports it; runtime activation no longer calls it.
 *
 * Removing this stub is safe once no caller imports it.
 */
export async function computeAndCreditDirectReferralMilestone({
  sponsorUserId,
  newReferralUserId,
  atDirectCount,
  session,
  correlationId = null,
}) {
  if (!sponsorUserId || !atDirectCount) return null;

  const sponsorMembership = await getMembershipByUserId(sponsorUserId, { session });
  if (!sponsorMembership) return null;

  const bonusAmount = await getDirectReferralMilestoneBonus(atDirectCount);
  if (!bonusAmount || bonusAmount <= 0) return null;

  const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.DIRECT_REFERRAL_MILESTONE}-${sponsorUserId}-${atDirectCount}`;

  return creditBonusToEarningsWallet({
    recipientUserId: sponsorUserId,
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_MILESTONE,
    planType: MLM_PLAN_TYPE.A,
    bonusAmount,
    level: null,
    baseAmount: 0,
    ratePercent: null,
    sourceUserId: newReferralUserId,
    sourceOrderId: null,
    bucket: "pending",
    description: `Direct referral milestone bonus at ${atDirectCount} directs`,
    meta: { atDirectCount: Number(atDirectCount) },
    idempotencyKey,
    correlationId,
    session,
  });
}

/**
 * Plan A binary pair-matching bonus.
 *
 * Called from `mlmActivationService.activateMembershipFromJoiningPayment`
 * after the new direct referral has been placed in the sponsor's
 * binary tree and the sponsor's `leftLegDirectCount` /
 * `rightLegDirectCount` counters have been bumped accordingly.
 *
 * Algorithm:
 *   1. Reload the sponsor's membership inside the session to read the
 *      freshly bumped leg counters.
 *   2. Compute `newPairCount = min(leftLegDirectCount, rightLegDirectCount)`.
 *   3. If `newPairCount > lastPaidPairIndex`, credit one BINARY_PAIR_MATCH
 *      event for every pair in `(lastPaidPairIndex, newPairCount]`. This
 *      catch-up loop covers rare scenarios where multiple directs land in
 *      sequence but the bonus check ran only at the last activation.
 *   4. Persist `lastPaidPairIndex` and `pairsCompleted` on the sponsor's
 *      membership inside the same session.
 *
 * Idempotency:
 *   - Each per-pair credit uses key
 *     `MLM-BPM-<sponsorUserId>-P<pairIndex>` so re-running activation
 *     for the same triggering member never double-credits.
 *   - The `lastPaidPairIndex` $set is monotonic: a re-run that finds
 *     no new pairs is a no-op.
 *
 * Returns the array of persisted `MlmCommissionEvent` rows
 * (zero-length if no new pair was completed). Pair amounts come from
 * `Setting.mlm.planAPairBonusTiers` with fallback to
 * `planAPairBonusFixedAmount` for pair indexes beyond
 * `planAPairBonusFixedAfterPair`.
 */
export async function computeAndCreditBinaryPairBonus({
  sponsorUserId,
  newReferralUserId,
  session,
  correlationId = null,
}) {
  if (!sponsorUserId) return [];

  const sponsor = await getMembershipByUserId(sponsorUserId, { session });
  if (!sponsor) return [];

  const leftLeg = Number(sponsor.leftLegDirectCount) || 0;
  const rightLeg = Number(sponsor.rightLegDirectCount) || 0;
  const newPairCount = Math.min(leftLeg, rightLeg);
  const lastPaid = Number(sponsor.lastPaidPairIndex) || 0;

  if (newPairCount <= lastPaid) {
    return [];
  }

  const events = [];
  for (let p = lastPaid + 1; p <= newPairCount; p += 1) {
    const bonusAmount = await getPlanAPairBonusForPairIndex(p);
    if (!bonusAmount || bonusAmount <= 0) {
      // No payout configured for this pair index; still mark the
      // pair as "paid" so we never re-evaluate it in the future
      // (otherwise the catch-up loop would always replay it on next
      // activation, which is wasted work).
      continue;
    }

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.BINARY_PAIR_MATCH}-${sponsorUserId}-P${p}`;

    const event = await creditBonusToEarningsWallet({
      recipientUserId: sponsorUserId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      planType: MLM_PLAN_TYPE.A,
      bonusAmount,
      level: null,
      baseAmount: 0,
      ratePercent: null,
      sourceUserId: newReferralUserId,
      sourceOrderId: null,
      bucket: "pending",
      description: `Plan A binary pair bonus #${p}`,
      meta: {
        pairIndex: p,
        leftLegDirectCount: leftLeg,
        rightLegDirectCount: rightLeg,
      },
      idempotencyKey,
      correlationId,
      session,
    });
    if (event) events.push(event);
  }

  // Persist progress markers regardless of whether any pair had a
  // configured payout — that way a subsequent re-run with non-zero
  // settings still only emits truly new pairs.
  await MlmMembership.updateOne(
    { userId: sponsorUserId },
    {
      $set: {
        lastPaidPairIndex: newPairCount,
        pairsCompleted: newPairCount,
      },
    },
    { session },
  );

  return events;
}

/**
 * Plan B repurchase bonus chain.
 *
 * Fires from `settleDeliveredOrder` for every delivered customer order
 * (whose customer has a Plan B upline). Walks the customer's
 * `sponsorChain` up to N levels (default 6) and credits each upline
 * `ratePercent` of the order's `paymentBreakdown.grandTotal` to their
 * pending bucket.
 *
 * Skip rules:
 *   - Skip if the upline is not an MLM member.
 *   - Skip if the upline is not on Plan B (only Plan B receives the
 *     repurchase bonus; Plan A still pays direct-referral milestones).
 *   - Skip if `ratePercent` is not configured for the level.
 *
 * Each credit is fully idempotent via
 *   `MLM-RBC-<orderId>-<recipientUserId>-L<level>`.
 *
 * Returns an array of created `MlmCommissionEvent` rows (some may be
 * `null` for skipped levels).
 */
export async function computeAndCreditRepurchaseBonusChain({
  orderId,
  downlineUserId,
  session,
  correlationId = null,
}) {
  if (!orderId || !downlineUserId) return [];

  const cfg = await getMlmConfig();
  const levels = (cfg.repurchaseBonusLevels || [])
    .filter((row) => Number(row.ratePercent) > 0)
    .sort((a, b) => Number(a.level) - Number(b.level));

  if (levels.length === 0) return [];

  const maxLevel = Math.max(...levels.map((row) => Number(row.level) || 0));
  if (maxLevel <= 0) return [];

  const order = await Order.findById(orderId).session(session);
  if (!order) return [];

  const grandTotal = roundCurrency(order.paymentBreakdown?.grandTotal || 0);
  if (grandTotal <= 0) return [];

  // Walk the upline. We use `getUplineChain` which already returns
  // ACTIVE memberships in level order [L1, L2, ...].
  const upline = await getUplineChain(downlineUserId, maxLevel, { session });
  if (upline.length === 0) return [];

  const events = [];
  for (let i = 0; i < upline.length; i += 1) {
    const level = i + 1;
    const ratePercent = levels.find((r) => Number(r.level) === level)?.ratePercent;
    if (!ratePercent || ratePercent <= 0) continue;

    const recipient = upline[i];
    if (recipient.planType !== MLM_PLAN_TYPE.B) continue;
    if (recipient.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) continue;

    const bonusAmount = roundCurrency((grandTotal * Number(ratePercent)) / 100);
    if (bonusAmount <= 0) continue;

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.REPURCHASE_BONUS}-${order._id}-${recipient.userId}-L${level}`;

    const event = await creditBonusToEarningsWallet({
      recipientUserId: recipient.userId,
      bonusType: MLM_BONUS_TYPE.REPURCHASE_BONUS,
      planType: MLM_PLAN_TYPE.B,
      bonusAmount,
      level,
      baseAmount: grandTotal,
      ratePercent: Number(ratePercent),
      sourceUserId: downlineUserId,
      sourceOrderId: order._id,
      bucket: "pending",
      description: `Repurchase bonus L${level} (${ratePercent}% of ₹${grandTotal})`,
      meta: {
        sourceOrderPublicId: order.orderId,
        downlineUserId: String(downlineUserId),
      },
      idempotencyKey,
      correlationId,
      session,
    });
    events.push(event);
  }
  return events;
}

/**
 * Phase 3 — Clawback all MLM bonuses associated with a returned order.
 *
 * Walks `MlmCommissionEvent` for the order and reverses each event
 * proportional to the refunded fraction (`refundedRatio = refundedValue
 * / originalGrandTotal`).
 *
 * For each non-zero clawback amount we:
 *   1. Debit the appropriate wallet bucket (earnings if `releasedAt` is
 *      set, otherwise pending — the bonus is still in flight).
 *   2. Write a paired LedgerEntry of type `MLM_BONUS_CLAWBACK_ON_RETURN`.
 *   3. Stamp `event.clawbackAt + event.clawbackAmount` for audit.
 *   4. If the recipient is on Plan A, decrement
 *      `lifetimePlanAEarnings`; on Plan B, decrement
 *      `lifetimePlanBEarnings` by the clawback amount (best-effort,
 *      doesn't reverse plan-B auto-upgrade once granted).
 *
 * Idempotent via `MLM-CB-<eventId>` key — re-running on the same return
 * is a no-op once the event's `clawbackAt` is set.
 *
 * If `bonusesOnReturn` is set to `forfeit_future` in Settings.mlm the
 * function is a no-op (the plan locks "clawback" as the only Phase 3
 * mode; the alternate behaviour is reserved for Phase 5+).
 */
export async function clawbackBonusesOnReturn({
  orderId,
  refundedItemsValue,
  originalGrandTotal,
  session,
  correlationId = null,
}) {
  if (!orderId) return { processed: 0, skipped: 0 };

  const cfg = await getMlmConfig();
  if (cfg.bonusesOnReturn && cfg.bonusesOnReturn !== "clawback") {
    return { processed: 0, skipped: 0, reason: "forfeit_future_mode" };
  }

  // Find every CREDITED event tied to this order that hasn't already
  // been clawed back (clawbackAt missing).
  const events = await MlmCommissionEvent.find({
    sourceOrderId: orderId,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    clawbackAt: { $exists: false },
  }).session(session);

  if (events.length === 0) return { processed: 0, skipped: 0 };

  const total = Number(originalGrandTotal) || 0;
  const refunded = Number(refundedItemsValue) || 0;
  // Refund ratio clamped to [0, 1]; if total is missing, default to
  // full clawback (safe over-reversal — never under-reverse).
  let ratio = total > 0 ? Math.min(1, Math.max(0, refunded / total)) : 1;
  ratio = roundCurrency(ratio * 10000) / 10000; // 4 decimals

  let processed = 0;
  let skipped = 0;

  for (const event of events) {
    const credited = roundCurrency(event.cappedAmount || 0);
    if (credited <= 0) {
      skipped += 1;
      continue;
    }
    const clawback = roundCurrency(credited * ratio);
    if (clawback <= 0) {
      skipped += 1;
      continue;
    }

    const bucket = event.releasedAt ? "earnings" : event.walletBucket || "pending";
    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.BONUS_CLAWBACK}-${event._id}`;

    try {
      // Use dynamic import to avoid a hard dependency cycle with
      // walletService at module-load time.
      const { debitWallet } = await import("../finance/walletService.js");

      await debitWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: event.recipientId,
        amount: clawback,
        bucket,
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_CLAWBACK_ON_RETURN,
        ledgerReference: idempotencyKey,
        ledgerDescription: `MLM bonus clawback for return of order ${orderId}`,
        idempotencyKey,
        metadata: {
          mlmEventId: String(event._id),
          orderId: String(orderId),
          ratio,
          originalCredited: credited,
        },
        orderId,
        syncUserWalletBalance: bucket === "available",
      });

      event.clawbackAt = new Date();
      event.clawbackAmount = clawback;
      event.meta = {
        ...(event.meta || {}),
        clawbackRatio: ratio,
        clawbackBucket: bucket,
      };
      await event.save({ session });

      // Roll back lifetime totals (best-effort; no negative clamp because
      // we want admins to detect data drift quickly via reconciliation).
      const incField = event.planType === MLM_PLAN_TYPE.B
        ? "lifetimePlanBEarnings"
        : "lifetimePlanAEarnings";
      await import("../../models/mlmMembership.js").then(({ default: MlmMembership }) =>
        MlmMembership.updateOne(
          { userId: event.recipientId },
          { $inc: { [incField]: -clawback } },
          { session },
        ),
      );

      processed += 1;
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[mlmBonusEngineService] clawback failed for event; continuing", {
          mlmEventId: String(event._id),
          error: error.message,
        });
      }
      skipped += 1;
    }
  }

  return { processed, skipped, ratio, totalEvents: events.length };
}

/**
 * Phase 4 — Home Shopping commission disbursement.
 *
 * Fires from `settleDeliveredOrder` when `order.isHomeShoppingOrder ===
 * true`. Walks the customer's upline up to 3 levels and credits the
 * configured percentages:
 *   - L1 (`salesPercent`, default 10%) — direct sponsor
 *   - L2 (`referralPercent`, default 5%) — grandparent
 *   - L3 (`royaltyPercent`, default 2%) — great-grandparent
 *
 * Recipients must be ACTIVE Plan B members; non-Plan B uplines are
 * skipped (the bonus does NOT spill upward).
 *
 * Idempotent via `MLM-HSS|HSR|HSY-<orderId>-<recipientId>-L<level>`.
 */
export async function computeAndCreditHomeShoppingCommissions({
  orderId,
  downlineUserId,
  session,
  correlationId = null,
}) {
  if (!orderId || !downlineUserId) return [];

  const order = await Order.findById(orderId).session(session);
  if (!order || !order.isHomeShoppingOrder) return [];

  const grandTotal = roundCurrency(order.paymentBreakdown?.grandTotal || 0);
  if (grandTotal <= 0) return [];

  const cfg = await getMlmConfig();
  const hs = cfg.homeShoppingCommissions || {};
  const levels = [
    { level: 1, ratePercent: Number(hs.salesPercent) || 0, prefix: MLM_IDEMPOTENCY_PREFIX.HOME_SHOPPING_SALES, type: MLM_BONUS_TYPE.HOME_SHOPPING_SALES },
    { level: 2, ratePercent: Number(hs.referralPercent) || 0, prefix: MLM_IDEMPOTENCY_PREFIX.HOME_SHOPPING_REFERRAL, type: MLM_BONUS_TYPE.HOME_SHOPPING_REFERRAL },
    { level: 3, ratePercent: Number(hs.royaltyPercent) || 0, prefix: MLM_IDEMPOTENCY_PREFIX.HOME_SHOPPING_ROYALTY, type: MLM_BONUS_TYPE.HOME_SHOPPING_ROYALTY },
  ].filter((row) => row.ratePercent > 0);
  if (levels.length === 0) return [];

  const maxLevel = Math.max(...levels.map((r) => r.level));
  const upline = await getUplineChain(downlineUserId, maxLevel, { session });
  if (upline.length === 0) return [];

  const events = [];
  for (const { level, ratePercent, prefix, type } of levels) {
    const recipient = upline[level - 1];
    if (!recipient) continue;
    if (recipient.planType !== MLM_PLAN_TYPE.B) continue;
    if (recipient.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) continue;

    const bonusAmount = roundCurrency((grandTotal * ratePercent) / 100);
    if (bonusAmount <= 0) continue;

    const idempotencyKey = `${prefix}-${order._id}-${recipient.userId}-L${level}`;

    const event = await creditBonusToEarningsWallet({
      recipientUserId: recipient.userId,
      bonusType: type,
      planType: MLM_PLAN_TYPE.B,
      bonusAmount,
      level,
      baseAmount: grandTotal,
      ratePercent,
      sourceUserId: downlineUserId,
      sourceOrderId: order._id,
      bucket: "pending",
      description: `Home Shopping ${type} L${level} (${ratePercent}% of ₹${grandTotal})`,
      meta: {
        sourceOrderPublicId: order.orderId,
        downlineUserId: String(downlineUserId),
      },
      idempotencyKey,
      correlationId,
      session,
    });
    events.push(event);
  }
  return events;
}

/**
 * Plan B mentor-royalty cascade.
 *
 * Fires inside `creditBonusToEarningsWallet` for every non-mentor-royalty
 * commission. Pays a small share (default L1=10%, L2=5% of the
 * downline's commission) to the immediate upline (up to 2 levels).
 *
 * Self-funded: this is NOT additional platform money — the percentages
 * (10/5%) of the downline's bonus are paid as a "thank-you" cascade.
 * The platform recognises the full repurchase bonus pool as expense at
 * the time of credit; the mentor share is just a re-allocation within
 * the same network.
 *
 * Skip rules:
 *   - Skip if the upline is not an MLM member.
 *   - Skip if the upline is not on Plan B (mentor royalty is a Plan B
 *     benefit; Plan A members don't cascade royalties).
 *   - Skip if `ratePercent` is not configured for the level.
 *
 * Idempotent via
 *   `MLM-MRY-<originalCommissionEventId>-<recipientUserId>-L<level>`.
 */
export async function computeAndCreditMentorRoyaltyForCommission({
  originalCommissionEventId,
  recipientUserId,
  bonusAmount,
  sourceOrderId = null,
  session,
  correlationId = null,
}) {
  if (!originalCommissionEventId || !recipientUserId) return [];
  const base = roundCurrency(bonusAmount || 0);
  if (base <= 0) return [];

  const cfg = await getMlmConfig();
  const levels = (cfg.mentorRoyaltyLevels || [])
    .filter((row) => Number(row.ratePercent) > 0)
    .sort((a, b) => Number(a.level) - Number(b.level));
  if (levels.length === 0) return [];

  const maxLevel = Math.max(...levels.map((row) => Number(row.level) || 0));
  if (maxLevel <= 0) return [];

  const upline = await getUplineChain(recipientUserId, maxLevel, { session });
  if (upline.length === 0) return [];

  const events = [];
  for (let i = 0; i < upline.length; i += 1) {
    const level = i + 1;
    const ratePercent = levels.find((r) => Number(r.level) === level)?.ratePercent;
    if (!ratePercent || ratePercent <= 0) continue;

    const mentor = upline[i];
    if (mentor.planType !== MLM_PLAN_TYPE.B) continue;
    if (mentor.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) continue;

    const royaltyAmount = roundCurrency((base * Number(ratePercent)) / 100);
    if (royaltyAmount <= 0) continue;

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.MENTOR_ROYALTY}-${originalCommissionEventId}-${mentor.userId}-L${level}`;

    const event = await creditBonusToEarningsWallet({
      recipientUserId: mentor.userId,
      bonusType: MLM_BONUS_TYPE.MENTOR_ROYALTY,
      planType: MLM_PLAN_TYPE.B,
      bonusAmount: royaltyAmount,
      level,
      baseAmount: base,
      ratePercent: Number(ratePercent),
      sourceUserId: recipientUserId,
      sourceOrderId,
      sourceCommissionEventId: originalCommissionEventId,
      bucket: "pending",
      description: `Mentor royalty L${level} (${ratePercent}% of ₹${base})`,
      meta: {
        cascadedFromUserId: String(recipientUserId),
      },
      idempotencyKey,
      correlationId,
      session,
    });
    events.push(event);
  }
  return events;
}
