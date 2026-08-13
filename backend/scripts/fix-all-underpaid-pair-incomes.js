import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Setting from "../app/models/setting.js";
import { creditWallet } from "../app/services/finance/walletService.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import { MLM_MEMBERSHIP_STATUS, MLM_PLAN_TYPE } from "../app/constants/mlm.js";

const ACTIVE_BINARY_PLAN_TYPES = [MLM_PLAN_TYPE.A, MLM_PLAN_TYPE.B];

async function fixAllUnderpaidPairIncomes() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI missing in environment");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.\n");

  // 1. Ensure Setting.mlm planAPairBonusTiers is aligned
  const settingDoc = await Setting.findOne({});
  if (settingDoc && settingDoc.mlm) {
    let updated = false;
    const tiers = settingDoc.mlm.planAPairBonusTiers || [];
    for (const t of tiers) {
      if (t.pairIndex >= 3 && t.bonusAmount < 300) {
        t.bonusAmount = 300;
        updated = true;
      }
    }
    if (updated) {
      settingDoc.markModified("mlm");
      await settingDoc.save();
      console.log("Updated Setting.mlm planAPairBonusTiers in DB.");
    }
  }

  // 2. Fetch all BINARY_PAIR_MATCH events
  const pairEvents = await MlmCommissionEvent.find({
    bonusType: "BINARY_PAIR_MATCH",
  }).lean();

  let fixedEventsCount = 0;
  let totalRecreditedAmount = 0;
  const memberAdjustments = new Map();

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
      const difference = expectedRate - actualCredited;

      // Update event in DB
      await MlmCommissionEvent.updateOne(
        { _id: ev._id },
        {
          $set: {
            bonusAmount: expectedRate,
            cappedAmount: expectedRate,
            "meta.pairIncome": expectedRate,
            description: `Binary pair #${ev.meta?.pairIndex || "?"} team match (₹${expectedRate})`,
          },
        }
      );

      // Accumulate credit for recipient
      const key = String(recipientUserId);
      const prev = memberAdjustments.get(key) || { recipientUserId, pendingAdd: 0, earningsAdd: 0, totalAdd: 0 };
      
      if (ev.bucket === "pending") {
        prev.pendingAdd += difference;
      } else {
        prev.earningsAdd += difference;
      }
      prev.totalAdd += difference;
      memberAdjustments.set(key, prev);

      fixedEventsCount += 1;
      totalRecreditedAmount += difference;
    }
  }

  // 3. Update wallets via walletService & lifetime earnings
  for (const [key, adj] of memberAdjustments.entries()) {
    if (adj.earningsAdd > 0) {
      await creditWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: adj.recipientUserId,
        amount: adj.earningsAdd,
        bucket: "earnings",
      });
    }

    if (adj.pendingAdd > 0) {
      await creditWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: adj.recipientUserId,
        amount: adj.pendingAdd,
        bucket: "pending",
      });
    }

    await MlmMembership.updateOne(
      { userId: adj.recipientUserId },
      { $inc: { lifetimePlanAEarnings: adj.totalAdd } }
    );

    const cust = await Customer.findById(adj.recipientUserId).select("name userId").lean();
    console.log(`[FIXED] ${cust?.name || "Member"} (${cust?.userId || adj.recipientUserId}): +₹${adj.totalAdd} credited to wallet (Earnings: +₹${adj.earningsAdd}, Pending: +₹${adj.pendingAdd})`);
  }

  console.log("\n=========================================================================================");
  console.log(`REMEDIATION COMPLETE: Fixed ${fixedEventsCount} event(s) across ${memberAdjustments.size} member(s).`);
  console.log(`Total Re-credited to Wallets: ₹${totalRecreditedAmount}`);
  console.log("=========================================================================================\n");

  await mongoose.disconnect();
}

fixAllUnderpaidPairIncomes().catch((err) => {
  console.error("Fix error:", err);
  process.exit(1);
});
