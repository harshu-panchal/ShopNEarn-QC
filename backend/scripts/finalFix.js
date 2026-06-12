import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../app/constants/finance.js";
import { createLedgerEntry } from "../app/services/finance/ledgerService.js";
import { randomUUID } from "crypto";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const members = await MlmMembership.find({ planType: "A", status: "active" }).lean();
    
    let fixedBalances = 0;
    
    for (const member of members) {
      const customerId = member.userId;

      // 1. Ensure Wallet shoppingBalance is at least 5000 (if they haven't spent anything)
      // Actually, to be safe, we will just ensure that they have a LedgerEntry for 5000.
      const hasLedger = await LedgerEntry.findOne({
        actorId: customerId,
        description: "Plan A Activation Bonus"
      }).lean();

      if (!hasLedger) {
        // Fix the user who is missing it!
        const session = await mongoose.startSession();
        await session.withTransaction(async () => {
          const wallet = await Wallet.findOne({ ownerId: customerId }).session(session);
          
          wallet.shoppingBalance += 5000;
          wallet.totalCredited += 5000;
          await wallet.save({ session });

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
        await session.endSession();
        fixedBalances++;
        console.log(`Fixed missing bonus for user: ${customerId}`);
      }
    }
    
    console.log(`Fixed missing bonuses for ${fixedBalances} users.`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
