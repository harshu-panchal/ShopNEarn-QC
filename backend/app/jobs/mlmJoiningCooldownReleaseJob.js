import dotenv from "dotenv";
import mongoose from "mongoose";
import logger from "../services/logger.js";
import MlmCommissionEvent from "../models/mlmCommissionEvent.js";
import {
  creditWallet,
  debitWallet,
} from "../services/finance/walletService.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../constants/finance.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
} from "../constants/mlm.js";
import { roundCurrency } from "../utils/money.js";
import { getPlanAPairBonusReleaseCooldownDays } from "../services/mlm/mlmConfigService.js";

dotenv.config();

/**
 * MLM Joining Cooldown Release Job — Plan A binary pair-match bonuses
 *
 * Plan A's `BINARY_PAIR_MATCH` bonuses are credited to the recipient's
 * `pending` bucket synchronously when a pair-completing referral
 * activates. They are NOT tied to an Order (joining is a direct
 * payment), so the existing `returnWindowReleaseJob` cannot move them
 * to `earnings` because that job keys off `Order.returnWindowExpiresAt`.
 *
 * Instead, this job runs on its own cadence and promotes pair-match
 * events that have sat in pending for at least
 * `Setting.mlm.planAPairBonusReleaseCooldownDays` (default 7 days).
 * The cooldown gives finance a window to dispute / refund a joining
 * payment before the sponsor can withdraw the bonus.
 *
 * Mechanics (per event, atomic inside one session):
 *   1. Debit the recipient's `pending` bucket
 *      (LedgerEntry: MLM_BONUS_RELEASED, idempotency `MLM-BPR-<id>-D`)
 *   2. Credit the recipient's `earnings` bucket
 *      (LedgerEntry: MLM_BONUS_RELEASED, idempotency `MLM-BPR-<id>-C`)
 *   3. Stamp `MlmCommissionEvent.releasedAt` and flip
 *      `walletBucket: "earnings"` so it never re-enters the candidate
 *      query.
 *
 * Idempotent: failures partway through a session roll the event back
 * intact, and the next run picks it up via the same `releasedAt`
 * filter. The unique idempotency keys on the new ledger rows prevent
 * any double-release if the job overlaps itself.
 *
 * Toggle via `ENABLE_MLM_JOINING_COOLDOWN_RELEASE_JOB`
 * (default `true`). Cadence via
 * `MLM_JOINING_COOLDOWN_RELEASE_INTERVAL_MS` (default 1h).
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h
const RELEASE_BATCH_SIZE = 200;

const isJobEnabled = () =>
  String(
    process.env.ENABLE_MLM_JOINING_COOLDOWN_RELEASE_JOB || "true",
  ).toLowerCase() === "true";

const getJobInterval = () =>
  parseInt(
    process.env.MLM_JOINING_COOLDOWN_RELEASE_INTERVAL_MS ||
      `${DEFAULT_INTERVAL_MS}`,
    10,
  );

const mlmJoiningCooldownReleaseJobHandler = async () => {
  const startTime = Date.now();
  try {
    const cooldownDays = await getPlanAPairBonusReleaseCooldownDays();
    const cutoff = new Date(
      Date.now() - cooldownDays * 24 * 60 * 60 * 1000,
    );

    // Candidate events: pair-match credits sitting in pending whose
    // creation time is at or before the cutoff. The `releasedAt`
    // existence check is the post-release marker.
    const events = await MlmCommissionEvent.find({
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      walletBucket: "pending",
      releasedAt: { $exists: false },
      createdAt: { $lte: cutoff },
    })
      .sort({ createdAt: 1 })
      .limit(RELEASE_BATCH_SIZE)
      .lean();

    if (events.length === 0) return;

    let processed = 0;
    let failed = 0;

    for (const event of events) {
      const amount = roundCurrency(event.cappedAmount || 0);
      if (amount <= 0) {
        // Defensive: stamp the row so we never re-evaluate it.
        await MlmCommissionEvent.updateOne(
          { _id: event._id, releasedAt: { $exists: false } },
          { $set: { releasedAt: new Date(), walletBucket: "earnings" } },
        );
        continue;
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const releaseKey = `${MLM_IDEMPOTENCY_PREFIX.PAIR_BONUS_RELEASE}-${event._id}`;

          await debitWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: event.recipientId,
            amount,
            bucket: "pending",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_RELEASED,
            ledgerReference: releaseKey,
            ledgerDescription: `Plan A pair bonus cooldown release (pending->earnings)`,
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
            ledgerDescription: `Plan A pair bonus credited to earnings`,
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
        });
        processed += 1;
      } catch (err) {
        failed += 1;
        logger.warn("MLM pair bonus cooldown release failed for event", {
          jobName: "mlmJoiningCooldownReleaseJob",
          mlmEventId: String(event._id),
          error: err.message,
        });
      } finally {
        session.endSession();
      }
    }

    const duration = Date.now() - startTime;
    if (processed > 0 || failed > 0) {
      logger.info("MLM pair bonus cooldown release completed", {
        jobName: "mlmJoiningCooldownReleaseJob",
        duration,
        processed,
        failed,
        scanned: events.length,
        cooldownDays,
      });
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("MLM pair bonus cooldown release job failed", {
      jobName: "mlmJoiningCooldownReleaseJob",
      duration,
      error: err.message,
      stack: err.stack,
    });
  }
};

export const getMlmJoiningCooldownReleaseJobHandler = () =>
  mlmJoiningCooldownReleaseJobHandler;
export const getMlmJoiningCooldownReleaseJobIntervalMs = () =>
  getJobInterval();
export const isMlmJoiningCooldownReleaseJobEnabled = () => isJobEnabled();

export default mlmJoiningCooldownReleaseJobHandler;
