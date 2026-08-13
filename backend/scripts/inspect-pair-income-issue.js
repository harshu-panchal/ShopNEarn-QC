import "dotenv/config";
import mongoose from "mongoose";
import Setting from "../app/models/setting.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";

async function inspectPairIncomeIssue() {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.\n");

    // 1. Inspect Setting.mlm
    const settingDoc = await Setting.findOne({}).lean();
    console.log("=== SETTING.MLM CONFIG ===");
    console.log("binaryPairIncomeTiers:", settingDoc?.mlm?.binaryPairIncomeTiers);
    console.log("planAPairBonusTiers:", settingDoc?.mlm?.planAPairBonusTiers);
    console.log("planAPairBonusFixedAfterPair:", settingDoc?.mlm?.planAPairBonusFixedAfterPair);
    console.log("planAPairBonusFixedAmount:", settingDoc?.mlm?.planAPairBonusFixedAmount);

    // 2. Find Jay Bharatbhai (SE20509912)
    const jayUser = await Customer.findOne({
      $or: [{ userId: "SE20509912" }, { name: /jay bharatbhai/i }],
    }).lean();

    console.log("\n=== JAY BHARATBHAI ===");
    console.log("Customer:", jayUser);

    if (jayUser) {
      // Find who received the pair bonus triggered by Jay Bharatbhai
      const events = await MlmCommissionEvent.find({
        sourceUserId: jayUser._id,
      })
        .sort({ createdAt: -1 })
        .lean();

      console.log(`Found ${events.length} commission events triggered by Jay Bharatbhai:`);
      for (const ev of events) {
        const recipient = await Customer.findById(ev.recipientId).select("name userId").lean();
        console.log("- Event ID:", ev._id);
        console.log("  Recipient:", recipient?.name, `(${recipient?.userId})`);
        console.log("  Bonus Type:", ev.bonusType);
        console.log("  Bonus Amount:", ev.bonusAmount, "Capped Amount:", ev.cappedAmount);
        console.log("  Description:", ev.description);
        console.log("  Meta:", JSON.stringify(ev.meta, null, 2));
      }
    }

    // Also find all recent BINARY_PAIR_MATCH events with pairIndex: 4 or 6 active directs
    const recentPairEvents = await MlmCommissionEvent.find({
      bonusType: "BINARY_PAIR_MATCH",
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log("\n=== RECENT PAIR MATCH EVENTS ===");
    for (const ev of recentPairEvents) {
      const recipient = await Customer.findById(ev.recipientId).select("name userId").lean();
      const trigger = await Customer.findById(ev.sourceUserId).select("name userId").lean();
      console.log(`[${ev._id}] Recipient: ${recipient?.name} (${recipient?.userId}) | Trigger: ${trigger?.name} (${trigger?.userId}) | Amount: ₹${ev.bonusAmount} (Capped: ₹${ev.cappedAmount})`);
      console.log(`  Desc: "${ev.description}"`);
      console.log(`  Meta: pairIndex=${ev.meta?.pairIndex}, directCount=${ev.meta?.directCount}, pairIncome=${ev.meta?.pairIncome}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error inspecting:", error);
    process.exit(1);
  }
}

inspectPairIncomeIssue();
