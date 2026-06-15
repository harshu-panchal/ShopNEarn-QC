import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import { createLedgerEntry } from "../app/services/finance/ledgerService.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../app/constants/finance.js";

async function run() {
  let fixedCount = 0;
  let skipCount = 0;

  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    const members = await MlmMembership.find({
      planType: "A",
      status: "active",
    }).lean();

    for (const member of members) {
      const customerId = member.userId;

      const existingLedger = await LedgerEntry.findOne({
        actorId: customerId,
        idempotencyKey: `SCRIPT-PLANA-ACTIVATION-${String(customerId)}`
      }).lean();

      if (existingLedger) {
        skipCount++;
        continue; // Already fixed
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const wallet = await Wallet.findOne({ ownerId: customerId }).session(session);
          
          if (!wallet) return; // Should not happen

          // We know the previous script ran twice silently and added 10,000 total.
          // We want to subtract 5,000 to fix the balance.
          wallet.shoppingBalance -= 5000;
          wallet.totalCredited -= 5000;
          await wallet.save({ session });

          // Now create the missing LedgerEntry for the 5000 that they ARE supposed to keep.
          // The balanceBefore was what they had before the 5000 was added.
          await createLedgerEntry({
            walletId: wallet._id,
            actorType: OWNER_TYPE.CUSTOMER,
            actorId: customerId,
            type: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            direction: "CREDIT",
            amount: 5000,
            status: "COMPLETED",
            description: "Plan A Activation Bonus",
            reference: `SCRIPT-PLANA-ACTIVATION-${String(customerId)}`,
            balanceBefore: wallet.shoppingBalance - 5000,
            balanceAfter: wallet.shoppingBalance,
            idempotencyKey: `SCRIPT-PLANA-ACTIVATION-${String(customerId)}`,
            correlationId: `RECOVERY-SCRIPT-${randomUUID()}`
          }, { session });
        });
        
        fixedCount++;
        if (fixedCount % 10 === 0) {
            console.log(`Fixed ${fixedCount} accounts...`);
        }
      } catch (err) {
        console.error(`Failed to fix user ${customerId}:`, err);
      } finally {
        await session.endSession();
      }
    }

    console.log(`\nFixed: ${fixedCount}, Skipped: ${skipCount}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
