import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import { MLM_MEMBERSHIP_STATUS, MLM_PLAN_TYPE } from "../app/constants/mlm.js";

const ACTIVE_BINARY_PLAN_TYPES = [MLM_PLAN_TYPE.A, MLM_PLAN_TYPE.B];

async function auditUnderpaidPairIncome() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI missing in environment");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.\n");

  console.log("Auditing all BINARY_PAIR_MATCH commission events across the system...\n");

  const pairEvents = await MlmCommissionEvent.find({
    bonusType: "BINARY_PAIR_MATCH",
  })
    .sort({ createdAt: 1 })
    .lean();

  console.log(`Total BINARY_PAIR_MATCH events in DB: ${pairEvents.length}`);

  const underpaidMembersMap = new Map();
  let totalUnderpaidEvents = 0;
  let totalUnderpaidAmount = 0;

  for (const ev of pairEvents) {
    const recipientUserId = ev.recipientId;
    if (!recipientUserId) continue;

    const activeDirectsCount = await MlmMembership.countDocuments({
      sponsorId: recipientUserId,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      planType: { $in: ACTIVE_BINARY_PLAN_TYPES },
    });

    const metaDirectCount = Number(ev.meta?.directCount) || 0;
    const effectiveDirectCount = Math.max(activeDirectsCount, metaDirectCount);

    let expectedRate = 0;
    if (effectiveDirectCount >= 7) expectedRate = 400;
    else if (effectiveDirectCount >= 5) expectedRate = 300;
    else if (effectiveDirectCount >= 3) expectedRate = 250;
    else if (effectiveDirectCount >= 2) expectedRate = 200;

    const actualCredited = Number(ev.bonusAmount || ev.cappedAmount || 0);

    if (expectedRate > actualCredited && effectiveDirectCount >= 5) {
      totalUnderpaidEvents += 1;
      const difference = expectedRate - actualCredited;
      totalUnderpaidAmount += difference;

      const key = String(recipientUserId);
      if (!underpaidMembersMap.has(key)) {
        underpaidMembersMap.set(key, {
          recipientUserId,
          activeDirectsCount: effectiveDirectCount,
          events: [],
          totalShortage: 0,
        });
      }

      const record = underpaidMembersMap.get(key);
      record.totalShortage += difference;
      record.events.push({
        eventId: ev._id,
        createdAt: ev.createdAt,
        actualCredited,
        expectedRate,
        shortage: difference,
        pairIndex: ev.meta?.pairIndex || "N/A",
        triggerUserId: ev.sourceUserId,
      });
    }
  }

  console.log("\n=========================================================================================");
  console.log(`AUDIT RESULT: Found ${underpaidMembersMap.size} affected member(s) with ${totalUnderpaidEvents} underpaid pair event(s).`);
  console.log(`Total System Underpaid Shortage: ₹${totalUnderpaidAmount}`);
  console.log("=========================================================================================\n");

  if (underpaidMembersMap.size === 0) {
    console.log("🎉 No other members have underpaid binary pair income!");
    await mongoose.disconnect();
    return;
  }

  let index = 1;
  for (const [userIdStr, data] of underpaidMembersMap.entries()) {
    const customer = await Customer.findById(data.recipientUserId).select("name userId phone email").lean();
    const membership = await MlmMembership.findOne({ userId: data.recipientUserId }).select("referralCode status").lean();

    console.log(`${index}. Member: ${customer?.name || "Unknown"} (${customer?.userId || membership?.referralCode || "No Code"})`);
    console.log(`   - Customer Mongo ID: ${data.recipientUserId}`);
    console.log(`   - Phone: ${customer?.phone || "N/A"}`);
    console.log(`   - Active Direct Referrals: ${data.activeDirectsCount}`);
    console.log(`   - Underpaid Events Count: ${data.events.length}`);
    console.log(`   - Total Underpaid Shortage to Credit: ₹${data.totalShortage}`);
    console.log(`   - Affected Event Details:`);

    for (const item of data.events) {
      const triggerCust = item.triggerUserId
        ? await Customer.findById(item.triggerUserId).select("name userId").lean()
        : null;
      console.log(`     * Event ID: ${item.eventId} | Date: ${new Date(item.createdAt).toISOString()}`);
      console.log(`       Pair Index: #${item.pairIndex} | Credited: ₹${item.actualCredited} | Expected Tier Rate: ₹${item.expectedRate} | Shortage: +₹${item.shortage}`);
      if (triggerCust) {
        console.log(`       Triggered By: ${triggerCust.name} (${triggerCust.userId})`);
      }
    }
    console.log("-----------------------------------------------------------------------------------------");
    index += 1;
  }

  await mongoose.disconnect();
}

auditUnderpaidPairIncome().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
