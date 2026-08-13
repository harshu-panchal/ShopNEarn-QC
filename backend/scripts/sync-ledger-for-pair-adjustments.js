import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import Wallet from "../app/models/wallet.js";
import { createLedgerEntry } from "../app/services/finance/ledgerService.js";
import { LEDGER_DIRECTION, LEDGER_STATUS, OWNER_TYPE } from "../app/constants/finance.js";

// List of adjustments applied by fix-all-underpaid-pair-incomes.js
const ADJUSTMENTS = [
  { publicId: "SEUHTFTX5K", amount: 3500 },
  { publicId: "SE4C7NGSFB", amount: 2600 },
  { publicId: "SE21399191", amount: 1050 },
  { publicId: "SE12028664", amount: 500 },
  { publicId: "SE95106322", amount: 50 },
  { publicId: "SE31664406", amount: 300 },
];

async function syncLedgerForPairAdjustments() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI missing in environment");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.\n");

  for (const item of ADJUSTMENTS) {
    const cust = await Customer.findOne({
      $or: [{ userId: item.publicId }, { referralCode: item.publicId }],
    }).lean();

    if (!cust) {
      console.warn(`Customer ${item.publicId} not found, skipping ledger entry.`);
      continue;
    }

    const wallet = await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: cust._id,
    }).lean();

    const idempotencyKey = `pair-match-tier-adjustment-ledger-${cust._id}`;

    try {
      await createLedgerEntry({
        transactionId: `ADJ-PAIR-TIER-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        walletId: wallet?._id || null,
        actorType: OWNER_TYPE.CUSTOMER,
        actorId: cust._id,
        type: "MLM_BONUS_CREDIT",
        direction: LEDGER_DIRECTION.CREDIT,
        amount: item.amount,
        status: LEDGER_STATUS.COMPLETED,
        description: `Pair match bonus tier correction adjustment (+₹${item.amount})`,
        metadata: {
          reason: "Direct referral tier rate adjustment for binary pair match",
          adjustmentAmount: item.amount,
        },
        idempotencyKey,
      });

      console.log(`[LEDGER SYNCED] ${cust.name} (${cust.userId}): Created LedgerEntry for +₹${item.amount}`);
    } catch (err) {
      if (err.code === 11000 || err.message?.includes("duplicate")) {
        console.log(`[ALREADY SYNCED] ${cust.name} (${cust.userId}): Ledger entry already exists.`);
      } else {
        console.error(`[ERROR] ${cust.name} (${cust.userId}): ${err.message}`);
      }
    }
  }

  console.log("\n=========================================");
  console.log("SUCCESS! All Ledger entries synced for Wallet History.");
  console.log("=========================================\n");

  await mongoose.disconnect();
}

syncLedgerForPairAdjustments().catch((err) => {
  console.error("Ledger sync error:", err);
  process.exit(1);
});
