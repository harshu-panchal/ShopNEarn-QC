import mongoose from "mongoose";
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve("./.env") });

import User from "./app/models/customer.js";
import MlmMembership from "./app/models/mlmMembership.js";
import MlmCommissionEvent from "./app/models/mlmCommissionEvent.js";
import { debitWallet } from "./app/services/finance/walletService.js";
import { OWNER_TYPE } from "./app/constants/finance.js";

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    const mongoUri = process.env.MONGODB_URL || process.env.MONGO_URI;
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected.");

    const referralCode = "SEJC7RDHX5";

    const user = await User.findOne({
      $or: [{ userId: referralCode }, { "mlm.referralCode": referralCode }],
    });

    if (!user) {
      console.error(`User with ID/Referral ${referralCode} not found.`);
      process.exit(1);
    }
    console.log(`Found user: ${user.name} (${user._id})`);

    const membership = await MlmMembership.findOne({ userId: user._id });
    if (!membership) {
      console.error("No MLM membership found for user.");
      process.exit(1);
    }

    const events = await MlmCommissionEvent.find({
      recipientUserId: user._id,
      bonusType: "BINARY_PAIR_MATCH",
    }).sort({ "meta.pairIndex": 1 });

    if (events.length === 0) {
      console.log("No BINARY_PAIR_MATCH events found for this user.");
      process.exit(0);
    }

    let actualPaid = 0;
    let expectedPaid = 0;

    console.log(`\nAnalyzing ${events.length} pair match events...`);
    for (const event of events) {
      const pairIndex = event.meta?.pairIndex;
      if (!pairIndex) continue;

      let expected = 0;
      if (pairIndex <= 2) expected = 250;
      else if (pairIndex <= 4) expected = 300;
      else expected = 400; // pair 5+

      actualPaid += event.bonusAmount;
      expectedPaid += expected;

      console.log(`Pair #${pairIndex}: Paid = ₹${event.bonusAmount}, Expected = ₹${expected}`);

      // Fix the event document in DB to reflect the correct amount
      if (event.bonusAmount !== expected) {
         event.bonusAmount = expected;
         event.meta.pairIncome = expected;
         await event.save();
      }
    }

    console.log(`\nTotal Actual Paid: ₹${actualPaid}`);
    console.log(`Total Expected: ₹${expectedPaid}`);

    const difference = actualPaid - expectedPaid;

    if (difference <= 0) {
      console.log("User was not overpaid. No wallet adjustment needed.");
      process.exit(0);
    }

    console.log(`\nUser was overpaid by ₹${difference}. Deducting from wallet...`);

    try {
      await debitWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: user._id,
        amount: difference,
        bucket: "earnings",
        ledgerType: "MLM_MANUAL_ADJUSTMENT",
        ledgerDescription: "Reversal of overpaid pair match bonus (Pair Index logic fix)",
      });
      console.log(`Successfully debited ₹${difference} from 'earnings' wallet bucket.`);
    } catch (err) {
      console.error("Failed to debit 'earnings' bucket:", err.message);
      console.log("Attempting to debit 'available' bucket instead...");
      await debitWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: user._id,
        amount: difference,
        bucket: "available",
        ledgerType: "MLM_MANUAL_ADJUSTMENT",
        ledgerDescription: "Reversal of overpaid pair match bonus (Pair Index logic fix)",
      });
      console.log(`Successfully debited ₹${difference} from 'available' wallet bucket.`);
    }

    // Adjust lifetime earnings
    console.log("Adjusting lifetime Plan A earnings...");
    membership.lifetimePlanAEarnings = Math.max(0, (membership.lifetimePlanAEarnings || 0) - difference);
    await membership.save();

    user.mlm.lifetimePlanAEarnings = Math.max(0, (user.mlm.lifetimePlanAEarnings || 0) - difference);
    await user.save();

    console.log("\nDone! Member's wallet and earnings have been corrected.");
    process.exit(0);

  } catch (err) {
    console.error("Error running script:", err);
    process.exit(1);
  }
}

run();
