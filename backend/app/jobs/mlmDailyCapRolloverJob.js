import mongoose from "mongoose";
import logger from "../services/logger.js";
import MlmCommissionEvent from "../models/mlmCommissionEvent.js";
import { creditBonusToEarningsWallet } from "../services/mlm/mlmBonusEngineService.js";
import { MLM_COMMISSION_EVENT_STATUS } from "../constants/mlm.js";

/**
 * MLM Daily Cap Rollover Job
 *
 * Runs hourly (so the IST midnight crossover is caught within an hour).
 * Idempotent: each rolled-over event mints a brand-new commission event
 * with idempotency key suffixed `:RO-<YYYYMMDD>`. Once the new event is
 * credited the source event is flagged with `rolledOverAt` so subsequent
 * runs skip it.
 *
 * The job ONLY processes events with status = `capped_rollover` AND
 * unspent rollover amount. It tries to re-credit the rollover amount
 * subject to the new day's `dailyEarningCap`. Anything still over the
 * new cap becomes a fresh capped_rollover event for the next day —
 * "carries forward" pattern, never lost.
 *
 * Default cadence: every 60 minutes. Override via
 * `MLM_DAILY_CAP_ROLLOVER_INTERVAL_MS`.
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h
const ROLLOVER_BATCH_SIZE = 200;

const isMlmCapRolloverJobEnabled = () =>
  String(process.env.ENABLE_MLM_DAILY_CAP_ROLLOVER_JOB || "true").toLowerCase() === "true";

const getMlmDailyCapRolloverJobInterval = () =>
  parseInt(process.env.MLM_DAILY_CAP_ROLLOVER_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`, 10);

const todayKey = () => {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

const mlmDailyCapRolloverJobHandler = async () => {
  const startTime = Date.now();
  try {
    const events = await MlmCommissionEvent.find({
      status: MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER,
      rolloverAmount: { $gt: 0 },
      rolledOverAt: { $exists: false },
    })
      .sort({ createdAt: 1 })
      .limit(ROLLOVER_BATCH_SIZE)
      .lean();

    if (events.length === 0) {
      return;
    }

    const day = todayKey();
    let processed = 0;
    let failed = 0;

    for (const event of events) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const idemKey = `${event.idempotencyKey || `MLM-EV-${event._id}`}:RO-${day}`;

          await creditBonusToEarningsWallet({
            recipientUserId: event.recipientId,
            bonusType: event.bonusType,
            planType: event.planType,
            bonusAmount: event.rolloverAmount,
            level: event.level,
            baseAmount: event.baseAmount,
            ratePercent: event.ratePercent,
            sourceUserId: event.sourceUserId,
            sourceOrderId: event.sourceOrderId,
            sourceCommissionEventId: event._id,
            bucket: event.walletBucket || "pending",
            description: `Daily-cap rollover credit (${day})`,
            meta: {
              ...(event.meta || {}),
              rolloverSource: String(event._id),
              rolloverDay: day,
            },
            idempotencyKey: idemKey,
            correlationId: event.correlationId,
            session,
          });

          await MlmCommissionEvent.updateOne(
            { _id: event._id },
            {
              $set: {
                rolledOverAt: new Date(),
                rolloverIdempotencyKey: idemKey,
              },
            },
            { session },
          );
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        logger.warn("MLM daily cap rollover failed for event", {
          jobName: "mlmDailyCapRolloverJob",
          eventId: String(event._id),
          error: error.message,
        });
      } finally {
        session.endSession();
      }
    }

    const duration = Date.now() - startTime;
    if (processed > 0 || failed > 0) {
      logger.info("MLM daily cap rollover completed", {
        jobName: "mlmDailyCapRolloverJob",
        duration,
        processed,
        failed,
        scanned: events.length,
      });
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("MLM daily cap rollover job failed", {
      jobName: "mlmDailyCapRolloverJob",
      duration,
      error: err.message,
      stack: err.stack,
    });
  }
};

export const getMlmDailyCapRolloverJobHandler = () => mlmDailyCapRolloverJobHandler;
export const getMlmDailyCapRolloverJobIntervalMs = () => getMlmDailyCapRolloverJobInterval();
export const isMlmDailyCapRolloverJobEnabled = () => isMlmCapRolloverJobEnabled();

export default mlmDailyCapRolloverJobHandler;
