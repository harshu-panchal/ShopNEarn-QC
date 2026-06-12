import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import { creditWallet } from "../app/services/finance/walletService.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../app/constants/finance.js";

async function run() {
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/shopandearn");
    console.log("Connected to MongoDB.");

    // Find all ACTIVE Plan A members
    const members = await MlmMembership.find({
      planType: "A",
      status: "active",
    }).lean();

    console.log(`Found ${members.length} active Plan A members.`);

    for (const member of members) {
      const customerId = member.userId;

      // Check if they already received the 5000 shopping credit for joining/activation.
      // We look for either the native flow (MLM_JOINING_PACKAGE_SHOPPING_CREDIT) or
      // our manual script's footprint.
      const existingCredit = await LedgerEntry.findOne({
        actorId: customerId,
        $or: [
          { type: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT },
          { description: "Plan A Activation Bonus" },
        ],
      }).lean();

      if (existingCredit) {
        skipCount++;
        continue;
      }

      // Start a session to ensure atomic wallet increment + ledger entry
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await creditWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: customerId,
            amount: 5000,
            bucket: "shopping",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            ledgerReference: `SCRIPT-PLANA-ACTIVATION-${String(customerId)}`,
            ledgerDescription: "Plan A Activation Bonus",
            idempotencyKey: `SCRIPT-PLANA-ACTIVATION-${String(customerId)}`,
            correlationId: `SCRIPT-${randomUUID()}`,
            syncUserWalletBalance: true, // IMPORTANT: force immediate user record sync if needed
          });
        });
        successCount++;
        if (successCount % 10 === 0) {
          console.log(`Credited ${successCount} members so far...`);
        }
      } catch (err) {
        errorCount++;
        console.error(`Failed to credit user ${customerId}:`, err.message);
      } finally {
        await session.endSession();
      }
    }

    console.log("\n--- Script Completed ---");
    console.log(`Successfully credited: ${successCount}`);
    console.log(`Skipped (already paid): ${skipCount}`);
    console.log(`Errors: ${errorCount}`);
  } catch (err) {
    console.error("Fatal Script Error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
