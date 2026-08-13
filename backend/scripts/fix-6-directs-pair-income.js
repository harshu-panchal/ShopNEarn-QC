import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Setting from "../app/models/setting.js";
import { creditWallet } from "../app/services/finance/walletService.js";
import { OWNER_TYPE } from "../app/constants/finance.js";

const JAY_PUBLIC_ID = "SE20509912";

async function fix6DirectsPairIncome() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI missing in environment");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.\n");

  // 1. Ensure Setting.mlm planAPairBonusTiers has pairIndex 4 set to 300
  const settingDoc = await Setting.findOne({});
  if (settingDoc && settingDoc.mlm) {
    let updatedSetting = false;
    let tiers = settingDoc.mlm.planAPairBonusTiers || [];
    
    const pair4 = tiers.find(t => t.pairIndex === 4);
    if (pair4 && pair4.bonusAmount < 300) {
      pair4.bonusAmount = 300;
      updatedSetting = true;
    }
    const pair3 = tiers.find(t => t.pairIndex === 3);
    if (pair3 && pair3.bonusAmount < 300) {
      pair3.bonusAmount = 300;
      updatedSetting = true;
    }
    
    if (updatedSetting) {
      settingDoc.markModified("mlm");
      await settingDoc.save();
      console.log("Updated Setting.mlm planAPairBonusTiers in DB.");
    }
  }

  // 2. Find Jay Bharatbhai customer
  const jayUser = await Customer.findOne({
    $or: [{ userId: JAY_PUBLIC_ID }, { name: /jay bharatbhai/i }],
  }).lean();

  if (!jayUser) {
    console.error(`Customer ${JAY_PUBLIC_ID} not found.`);
    process.exit(1);
  }

  console.log(`Found trigger customer: ${jayUser.name} (${jayUser.userId}) [ID: ${jayUser._id}]`);

  // 3. Find BINARY_PAIR_MATCH event triggered by Jay Bharatbhai
  const pairEvent = await MlmCommissionEvent.findOne({
    sourceUserId: jayUser._id,
    bonusType: "BINARY_PAIR_MATCH",
  });

  const targetEvent = pairEvent || await MlmCommissionEvent.findOne({
    bonusType: "BINARY_PAIR_MATCH",
    bonusAmount: 250,
    "meta.pairIndex": 4,
  }).sort({ createdAt: -1 });

  if (!targetEvent) {
    console.error("Could not find BINARY_PAIR_MATCH event for pair #4!");
    process.exit(1);
  }

  const recipientUser = await Customer.findById(targetEvent.recipientId).lean();
  const recipientMembership = await MlmMembership.findOne({ userId: targetEvent.recipientId });

  console.log("\n=== EVENT RECIPIENT ===");
  console.log(`Recipient Name: ${recipientUser?.name}`);
  console.log(`Recipient Public ID: ${recipientUser?.userId}`);
  console.log(`Event ID: ${targetEvent._id}`);
  console.log(`Current Bonus Amount: ₹${targetEvent.bonusAmount}`);
  console.log(`Current Description: "${targetEvent.description}"`);

  const oldAmount = targetEvent.bonusAmount;
  const newAmount = 300; // Correct rate for 5-6 active directs / pair #4
  const difference = newAmount - oldAmount;

  if (difference <= 0) {
    console.log(`Event already has ₹${oldAmount}. No fix required.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\nAdjusting event amount from ₹${oldAmount} to ₹${newAmount} (Difference: +₹${difference})...`);

  // Apply fix in DB
  targetEvent.bonusAmount = newAmount;
  targetEvent.cappedAmount = newAmount;
  if (targetEvent.meta) {
    targetEvent.meta.pairIncome = newAmount;
  }
  targetEvent.description = `Binary pair #${targetEvent.meta?.pairIndex || 4} team match (₹${newAmount})`;
  await targetEvent.save();

  // Credit difference to recipient's wallet via walletService
  const bucket = targetEvent.bucket === "pending" ? "pending" : "earnings";
  await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: targetEvent.recipientId,
    amount: difference,
    bucket,
  });

  // Update lifetime earnings on MlmMembership
  if (recipientMembership) {
    recipientMembership.lifetimePlanAEarnings = (recipientMembership.lifetimePlanAEarnings || 0) + difference;
    await recipientMembership.save();
  }

  console.log("\n=========================================");
  console.log("SUCCESS! DB Fixed:");
  console.log(`Recipient: ${recipientUser?.name} (${recipientUser?.userId})`);
  console.log(`Pair Match Bonus Updated: ₹${oldAmount} → ₹${newAmount}`);
  console.log(`Credited Difference: +₹${difference} to ${bucket} wallet`);
  console.log("=========================================\n");

  await mongoose.disconnect();
}

fix6DirectsPairIncome().catch(err => {
  console.error("Error running fix:", err);
  process.exit(1);
});
