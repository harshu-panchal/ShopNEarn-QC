import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import { MLM_BONUS_TYPE, MLM_COMMISSION_EVENT_STATUS, MLM_PLAN_TYPE, MLM_IDEMPOTENCY_PREFIX } from "../app/constants/mlm.js";
import { LEDGER_TRANSACTION_TYPE, OWNER_TYPE } from "../app/constants/finance.js";
import { calculateBinaryPairs } from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { debitWallet } from "../app/services/finance/walletService.js";
import { roundCurrency } from "../app/utils/money.js";

/**
 * Reverses every credited DIRECT_REFERRAL_ACTIVATION "first direct pair"
 * bonus that was paid on a bare 1 Left + 1 Right (invalid under the
 * corrected 2:1/1:2-opener rule). Debits each recipient's wallet, marks
 * the event CLAWED_BACK, decrements lifetime earnings, and resets
 * pairsCompleted/lastPaidPairIndex so the sponsor can legitimately earn
 * this bonus again later if they genuinely complete a 2:1/1:2 pair
 * (the corrected `applyDirectReferralFirstPairBonusInSession` now
 * reopens CLAWED_BACK rows for that case).
 *
 * Best-effort per event — a debit failure (e.g. insufficient balance)
 * skips that one event and continues; it never aborts the batch.
 */
async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI is missing in environment");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected.\n");

  const events = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    "meta.incomeType": "FIRST_DIRECT_PAIR",
    clawbackAt: { $exists: false },
  }).sort({ createdAt: 1 });

  let processed = 0;
  let skipped = 0;
  let totalAmount = 0;

  for (const event of events) {
    const left = Number(event.meta?.leftDirectCount);
    const right = Number(event.meta?.rightDirectCount);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      continue;
    }
    const correctPairs = calculateBinaryPairs(left, right).pairs;
    if (correctPairs >= 1) continue; // legitimately qualified

    const credited = roundCurrency(event.cappedAmount || event.bonusAmount || 0);
    const recipient = await Customer.findById(event.recipientId).select("name userId").lean();
    const label = recipient ? `${recipient.name} (${recipient.userId})` : String(event.recipientId);

    if (credited <= 0) {
      console.log(`SKIP (zero amount): ${label} eventId=${event._id}`);
      skipped += 1;
      continue;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const bucket = event.walletBucket || "earnings";
        const clawbackKey = `${MLM_IDEMPOTENCY_PREFIX.BONUS_CLAWBACK}-FDP-${event._id}`;

        await debitWallet({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: event.recipientId,
          amount: credited,
          bucket,
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BONUS_CLAWBACK_ON_RULE_CORRECTION,
          ledgerReference: clawbackKey,
          ledgerDescription: "Direct referral first-pair income reversed — bare 1L+1R does not meet the 2:1/1:2 opener rule",
          idempotencyKey: clawbackKey,
          syncUserWalletBalance: bucket === "available",
          metadata: {
            mlmEventId: String(event._id),
            leftDirectCount: left,
            rightDirectCount: right,
            correctionReason: "invalid_bare_1L1R_pair",
          },
        });

        const liveEvent = await MlmCommissionEvent.findById(event._id).session(session);
        liveEvent.status = MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK;
        liveEvent.clawbackAt = new Date();
        liveEvent.clawbackAmount = credited;
        liveEvent.meta = {
          ...(liveEvent.meta || {}),
          clawbackReason: "invalid_bare_1L1R_pair",
          correctionNote: "Reversed: bare 1 Left + 1 Right does not satisfy the 2:1/1:2 opening-pair rule.",
        };
        await liveEvent.save({ session });

        const incField =
          liveEvent.planType === MLM_PLAN_TYPE.B
            ? "lifetimePlanBEarnings"
            : "lifetimePlanAEarnings";
        await MlmMembership.updateOne(
          { userId: liveEvent.recipientId },
          { $inc: { [incField]: -credited } },
          { session },
        );

        await MlmMembership.updateOne(
          { userId: liveEvent.recipientId, pairsCompleted: 1 },
          { $set: { pairsCompleted: 0 }, $unset: { lastPaidPairIndex: "" } },
          { session },
        );
      });

      console.log(`OK: reversed ₹${credited} from ${label} (eventId=${event._id})`);
      processed += 1;
      totalAmount = roundCurrency(totalAmount + credited);
    } catch (error) {
      console.warn(`SKIP (failed): ${label} eventId=${event._id} — ${error.message}`);
      skipped += 1;
    } finally {
      await session.endSession();
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log({ processed, skipped, totalAmount });

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
