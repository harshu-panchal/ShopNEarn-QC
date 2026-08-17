import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import { MLM_BONUS_TYPE, MLM_COMMISSION_EVENT_STATUS } from "../app/constants/mlm.js";
import { calculateBinaryPairs } from "../app/services/mlm/mlmBinaryPairIncomeService.js";

/**
 * Read-only audit: every credited DIRECT_REFERRAL_ACTIVATION "first direct
 * pair" bonus recorded `leftDirectCount`/`rightDirectCount` in its meta at
 * the moment it was paid. Re-run the CORRECT 2:1/1:2-opener rule
 * (`calculateBinaryPairs`) against those recorded counts to find events
 * that were paid on a bare 1 Left + 1 Right (which never should have
 * completed the opening pair).
 */
async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(mongoUri);

  const events = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    "meta.incomeType": "FIRST_DIRECT_PAIR",
    clawbackAt: { $exists: false },
  })
    .sort({ createdAt: 1 })
    .lean();

  console.log(`Found ${events.length} credited FIRST_DIRECT_PAIR events.\n`);

  let invalidCount = 0;
  let invalidTotal = 0;
  const invalidEvents = [];

  for (const ev of events) {
    const left = Number(ev.meta?.leftDirectCount);
    const right = Number(ev.meta?.rightDirectCount);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      console.log(`  SKIP (no leg counts recorded in meta): eventId=${ev._id}`);
      continue;
    }
    const correctPairs = calculateBinaryPairs(left, right).pairs;
    if (correctPairs >= 1) continue; // legitimately qualified under 2:1/1:2

    const recipient = await Customer.findById(ev.recipientId).select("name userId").lean();
    invalidCount += 1;
    invalidTotal += Number(ev.cappedAmount || ev.bonusAmount || 0);
    invalidEvents.push({
      eventId: String(ev._id),
      recipient: recipient ? `${recipient.name} (${recipient.userId})` : String(ev.recipientId),
      recipientId: String(ev.recipientId),
      leftDirectCount: left,
      rightDirectCount: right,
      amount: Number(ev.cappedAmount || ev.bonusAmount || 0),
      walletBucket: ev.walletBucket,
      createdAt: ev.createdAt,
    });
  }

  console.log("=== INVALID (bare 1L+1R, no 2:1/1:2 opener) EVENTS ===");
  console.log(invalidEvents);
  console.log(`\nTotal invalid events: ${invalidCount}, total amount to reverse: ₹${invalidTotal}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
