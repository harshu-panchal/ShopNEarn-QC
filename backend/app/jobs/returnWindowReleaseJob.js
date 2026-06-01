import dotenv from "dotenv";
import mongoose from "mongoose";
import Order from "../models/order.js";
import logger from "../services/logger.js";
import Payout from "../models/payout.js";
import MlmCommissionEvent from "../models/mlmCommissionEvent.js";
import { processPayout } from "../services/finance/payoutService.js";
import {
  creditWallet,
  debitWallet,
} from "../services/finance/walletService.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../constants/finance.js";
import { MLM_COMMISSION_EVENT_STATUS } from "../constants/mlm.js";
import { roundCurrency } from "../utils/money.js";

dotenv.config();

const DEFAULT_INTERVAL_MS = 60000;
const RETURN_HOLD_RELEASE_INTERVAL_MS = parseInt(
  process.env.RETURN_HOLD_RELEASE_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`,
  10,
);

const AUTO_RELEASE_SELLER_PAYOUT =
  String(process.env.AUTO_RELEASE_SELLER_PAYOUT || "true").toLowerCase() === "true";

const releaseExpiredSellerHolds = async () => {
  const startTime = Date.now();
  try {
    const now = new Date();
    const candidates = await Order.find({
      status: "delivered",
      returnStatus: "none",
      returnWindowExpiresAt: { $lte: now },
      "settlementStatus.sellerPayout": "HOLD",
    })
      .select("_id orderId")
      .lean();

    for (const row of candidates) {
      try {
        const payout = await Payout.findOne({
          payoutType: "SELLER",
          relatedOrderIds: row._id,
          status: { $in: ["PENDING", "PROCESSING"] },
        }).select("_id").lean();

        if (AUTO_RELEASE_SELLER_PAYOUT && payout?._id) {
          try {
            await processPayout(payout._id);
          } catch (err) {
            logger.warn("Auto-release seller payout failed", {
              jobName: "returnWindowReleaseJob",
              orderId: row.orderId,
              payoutId: String(payout._id),
              error: err.message,
            });
          }
        } else if (payout?._id) {
          await Order.updateOne(
            { _id: row._id },
            {
              $set: {
                "settlementStatus.sellerPayout": "PENDING",
                "financeFlags.sellerPayoutHeld": false,
              },
            },
          );
        }
      } catch (err) {
        logger.error("Failed to release seller payout hold", {
          jobName: "returnWindowReleaseJob",
          orderId: row.orderId,
          error: err.message,
        });
      }
    }

    // MLM Phase 2: release the recipient's `pending` MLM bonus to
    // `earnings` once the source order's return window has expired.
    // We scan `MlmCommissionEvent` rows with `status: CREDITED`,
    // `walletBucket: pending` whose sourceOrderId has an expired return
    // window AND no active return claim.
    try {
      await releaseMlmPendingForExpiredReturnWindows();
    } catch (err) {
      logger.error("MLM pending release failed", {
        jobName: "returnWindowReleaseJob",
        error: err.message,
      });
    }

    const duration = Date.now() - startTime;
    if (candidates.length > 0) {
      logger.info("Return window release job completed", {
        jobName: "returnWindowReleaseJob",
        duration,
        releasedCount: candidates.length,
      });
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Return window release job failed", {
      jobName: "returnWindowReleaseJob",
      duration,
      error: err.message,
      stack: err.stack,
    });
  }
};

const MLM_RELEASE_BATCH_SIZE = 100;

/**
 * MLM Phase 2: scan for MlmCommissionEvent rows that were credited to
 * the `pending` bucket and whose source order's return window has
 * expired (no active return). Move each event from `pending` →
 * `earnings` inside a session-bound debit+credit pair, then flip
 * `walletBucket = "earnings"` and `releasedAt = now`.
 *
 * Skip rules:
 *   - Source order has an active return (`returnStatus !== "none"`).
 *   - Source order isn't delivered yet.
 *   - Source order's `returnWindowExpiresAt` is in the future.
 *
 * Idempotent via `releasedAt` flag + new ledger entries carry their
 * own unique `idempotencyKey`.
 */
async function releaseMlmPendingForExpiredReturnWindows() {
  const now = new Date();

  // Step 1: find candidate orders whose return window has just closed.
  const orders = await Order.find({
    status: "delivered",
    returnStatus: "none",
    returnWindowExpiresAt: { $lte: now },
    mlmBonusesDisbursed: true,
  })
    .select("_id")
    .limit(MLM_RELEASE_BATCH_SIZE)
    .lean();

  if (orders.length === 0) return;

  const orderIds = orders.map((o) => o._id);

  // Step 2: find every pending-bucket event for those orders.
  const events = await MlmCommissionEvent.find({
    sourceOrderId: { $in: orderIds },
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    walletBucket: "pending",
    releasedAt: { $exists: false },
  })
    .limit(MLM_RELEASE_BATCH_SIZE * 6)
    .lean();

  if (events.length === 0) return;

  for (const event of events) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const amount = roundCurrency(event.cappedAmount || 0);
        if (amount <= 0) return;

        const releaseKey = `MLM-REL-${event._id}`;

        // 1. Debit pending bucket
        await debitWallet({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: event.recipientId,
          amount,
          bucket: "pending",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_RELEASED,
          ledgerReference: releaseKey,
          ledgerDescription: `MLM bonus release (pending→earnings) for ${event.bonusType}`,
          idempotencyKey: `${releaseKey}-D`,
          metadata: {
            mlmEventId: String(event._id),
            sourceOrderId: String(event.sourceOrderId),
          },
          syncUserWalletBalance: false,
        });

        // 2. Credit earnings bucket
        await creditWallet({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: event.recipientId,
          amount,
          bucket: "earnings",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_RELEASED,
          ledgerReference: releaseKey,
          ledgerDescription: `MLM bonus release credited to earnings`,
          idempotencyKey: `${releaseKey}-C`,
          metadata: {
            mlmEventId: String(event._id),
            sourceOrderId: String(event.sourceOrderId),
          },
          syncUserWalletBalance: false,
        });

        // 3. Flip the event walletBucket + releasedAt
        await MlmCommissionEvent.updateOne(
          { _id: event._id },
          {
            $set: {
              walletBucket: "earnings",
              releasedAt: new Date(),
            },
          },
          { session },
        );
      });
    } catch (err) {
      logger.warn("MLM event release failed", {
        jobName: "returnWindowReleaseJob",
        mlmEventId: String(event._id),
        error: err.message,
      });
    } finally {
      session.endSession();
    }
  }

  if (events.length > 0) {
    logger.info("MLM pending→earnings release completed", {
      jobName: "returnWindowReleaseJob",
      releasedEvents: events.length,
    });
  }
}

export const getReturnWindowReleaseJobHandler = () => releaseExpiredSellerHolds;

export const getReturnWindowReleaseJobInterval = () => RETURN_HOLD_RELEASE_INTERVAL_MS;

export default releaseExpiredSellerHolds;
