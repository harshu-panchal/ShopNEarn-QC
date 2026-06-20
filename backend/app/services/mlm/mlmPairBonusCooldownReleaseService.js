import mongoose from "mongoose";
import logger from "../logger.js";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import {
  creditWallet,
  debitWallet,
} from "../finance/walletService.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../../constants/finance.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
} from "../../constants/mlm.js";
import { roundCurrency } from "../../utils/money.js";

const RELEASE_BATCH_SIZE = 200;

const PENDING_PLAN_A_BONUS_TYPES = [
  MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
  MLM_BONUS_TYPE.DIRECT_REFERRAL_MILESTONE,
];

function pendingBonusQuery(cutoff) {
  return {
    bonusType: { $in: PENDING_PLAN_A_BONUS_TYPES },
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    walletBucket: "pending",
    releasedAt: { $exists: false },
    createdAt: { $lte: cutoff },
  };
}

export async function releaseSinglePendingPlanABonusEvent(
  event,
  { cooldownDays, session: externalSession } = {},
) {
  const amount = roundCurrency(event.cappedAmount || 0);
  if (amount <= 0) {
    await MlmCommissionEvent.updateOne(
      { _id: event._id, releasedAt: { $exists: false } },
      { $set: { releasedAt: new Date(), walletBucket: "earnings" } },
      externalSession ? { session: externalSession } : {},
    );
    return { released: true, amount: 0 };
  }

  const run = async (session) => {
    const releaseKey = `${MLM_IDEMPOTENCY_PREFIX.PAIR_BONUS_RELEASE}-${event._id}`;

    await debitWallet({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: event.recipientId,
      amount,
      bucket: "pending",
      session,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_RELEASED,
      ledgerReference: releaseKey,
      ledgerDescription: "Plan A earnings bonus cooldown release (pending->earnings)",
      idempotencyKey: `${releaseKey}-D`,
      metadata: {
        mlmEventId: String(event._id),
        bonusType: event.bonusType,
        cooldownDays,
      },
      syncUserWalletBalance: false,
    });

    await creditWallet({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: event.recipientId,
      amount,
      bucket: "earnings",
      session,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_RELEASED,
      ledgerReference: releaseKey,
      ledgerDescription: "Plan A earnings bonus credited to earnings wallet",
      idempotencyKey: `${releaseKey}-C`,
      metadata: {
        mlmEventId: String(event._id),
        bonusType: event.bonusType,
        cooldownDays,
      },
      syncUserWalletBalance: false,
    });

    await MlmCommissionEvent.updateOne(
      { _id: event._id, releasedAt: { $exists: false } },
      {
        $set: {
          walletBucket: "earnings",
          releasedAt: new Date(),
        },
      },
      { session },
    );
  };

  if (externalSession) {
    await run(externalSession);
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(() => run(session));
    } finally {
      session.endSession();
    }
  }

  return { released: true, amount };
}

/**
 * Release one batch of pending Plan A pair/milestone bonuses whose
 * `createdAt` is on or before the cooldown cutoff.
 */
export async function releaseEligiblePendingPlanABonuses({
  cooldownDays,
  limit = RELEASE_BATCH_SIZE,
} = {}) {
  const days = Number(cooldownDays);
  const safeDays = Number.isFinite(days) && days >= 0 ? days : 0;
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

  const events = await MlmCommissionEvent.find(pendingBonusQuery(cutoff))
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  let processed = 0;
  let failed = 0;
  let totalAmount = 0;

  for (const event of events) {
    try {
      const result = await releaseSinglePendingPlanABonusEvent(event, {
        cooldownDays: safeDays,
      });
      if (result.released) {
        processed += 1;
        totalAmount += result.amount || 0;
      }
    } catch (err) {
      failed += 1;
      logger.warn("MLM pair bonus cooldown release failed for event", {
        mlmEventId: String(event._id),
        error: err.message,
      });
    }
  }

  return {
    processed,
    failed,
    scanned: events.length,
    totalAmount,
    hasMore: events.length >= limit,
    cooldownDays: safeDays,
  };
}

/**
 * Drain every pending Plan A bonus eligible under `cooldownDays`.
 * Used when admin sets cooldown to 0 so all backlog releases immediately.
 */
export async function drainAllPendingPlanABonuses({ cooldownDays = 0 } = {}) {
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalAmount = 0;
  let batches = 0;

  while (true) {
    const batch = await releaseEligiblePendingPlanABonuses({ cooldownDays });
    batches += 1;
    totalProcessed += batch.processed;
    totalFailed += batch.failed;
    totalAmount += batch.totalAmount;
    if (!batch.hasMore) break;
    if (batches > 500) {
      logger.warn("MLM pending bonus drain stopped after 500 batches", {
        cooldownDays,
        totalProcessed,
      });
      break;
    }
  }

  if (totalProcessed > 0 || totalFailed > 0) {
    logger.info("MLM pending Plan A bonus drain completed", {
      cooldownDays,
      totalProcessed,
      totalFailed,
      totalAmount,
      batches,
    });
  }

  return {
    processed: totalProcessed,
    failed: totalFailed,
    totalAmount,
    batches,
    cooldownDays,
  };
}
