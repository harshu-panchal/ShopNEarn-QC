import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import { MLM_BONUS_TYPE, MLM_COMMISSION_EVENT_STATUS, MLM_PLAN_TYPE } from "../app/constants/mlm.js";
import { calculateBinaryPairs } from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { getOrCreateWallet } from "../app/services/finance/walletService.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import { roundCurrency } from "../app/utils/money.js";

/**
 * Closes out the remaining invalid FIRST_DIRECT_PAIR events that
 * `fix-invalid-first-direct-pair-bonuses.js` could not reverse because
 * the recipient's earnings wallet balance was already 0 (money withdrawn
 * before correction). No wallet debit is attempted here — there is
 * nothing left to claw back. The event is still marked CLAWED_BACK
 * (clawbackAmount: 0, meta flagged as a write-off) so lifetime earnings
 * stay accurate for anything ELSE that already accounted for this event,
 * and pairsCompleted is reset so the sponsor can legitimately re-earn
 * this bonus later.
 *
 * Safety: refuses to touch any event whose recipient's earnings balance
 * is NOT currently 0 — those should go through the normal reversal
 * script instead.
 */
async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(mongoUri);

  const events = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    "meta.incomeType": "FIRST_DIRECT_PAIR",
    clawbackAt: { $exists: false },
  }).sort({ createdAt: 1 });

  let written = 0;

  for (const event of events) {
    const left = Number(event.meta?.leftDirectCount);
    const right = Number(event.meta?.rightDirectCount);
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    if (calculateBinaryPairs(left, right).pairs >= 1) continue; // legitimate

    const credited = roundCurrency(event.cappedAmount || event.bonusAmount || 0);
    const recipient = await Customer.findById(event.recipientId).select("name userId").lean();
    const label = recipient ? `${recipient.name} (${recipient.userId})` : String(event.recipientId);

    const wallet = await getOrCreateWallet(OWNER_TYPE.CUSTOMER, event.recipientId, {});
    const bucket = event.walletBucket || "earnings";
    const balance = roundCurrency(wallet[`${bucket}Balance`] || 0);

    if (balance > 0) {
      console.log(`SKIP (has recoverable balance ₹${balance}, use the normal reversal script): ${label}`);
      continue;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const liveEvent = await MlmCommissionEvent.findById(event._id).session(session);
        liveEvent.status = MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK;
        liveEvent.clawbackAt = new Date();
        liveEvent.clawbackAmount = 0; // nothing recovered — wallet was already 0
        liveEvent.meta = {
          ...(liveEvent.meta || {}),
          clawbackReason: "invalid_bare_1L1R_pair",
          correctionNote: `Written off: bare 1 Left + 1 Right does not satisfy the 2:1/1:2 opening-pair rule. Original ₹${credited} was already withdrawn/spent (wallet balance was 0 at correction time) and is unrecoverable.`,
          writtenOff: true,
          writtenOffAmount: credited,
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

      console.log(`WRITTEN OFF: ₹${credited} for ${label} (eventId=${event._id}) — unrecoverable, wallet was already 0`);
      written += 1;
    } finally {
      await session.endSession();
    }
  }

  console.log(`\nDone. ${written} event(s) written off.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
