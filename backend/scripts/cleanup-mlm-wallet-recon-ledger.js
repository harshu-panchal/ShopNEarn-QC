/**
 * cleanup-mlm-wallet-recon-ledger.js
 *
 * Removes orphan reconciliation ledger rows from fix-mlm-wallet-mismatches.js
 * where the wallet balance is already correct but the recon DEBIT/CREDIT
 * ledger row skews the audit trail.
 *
 *   node scripts/cleanup-mlm-wallet-recon-ledger.js --apply
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import Wallet from "../app/models/wallet.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function sumShoppingCredits(userId) {
  const rows = await LedgerEntry.find({
    actorId: userId,
    actorType: OWNER_TYPE.CUSTOMER,
    direction: "CREDIT",
    type: {
      $in: [
        "MLM_SIGNUP_BONUS_SELF",
        "MLM_SIGNUP_BONUS_SPONSOR",
        "MLM_JOINING_PACKAGE_SHOPPING_CREDIT",
        "MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT",
      ],
    },
  }).lean();
  const manual = await LedgerEntry.find({
    actorId: userId,
    actorType: OWNER_TYPE.CUSTOMER,
    direction: "CREDIT",
    type: "MLM_MANUAL_ADJUSTMENT",
    description: /plan\s*a|activation|joining/i,
  }).lean();
  return roundCurrency(
    [...rows, ...manual].reduce((s, r) => s + (r.amount || 0), 0),
  );
}

async function main() {
  await connectDB();
  const totals = { reconDebitsRemoved: 0, reconCreditsRemoved: 0, walletAdjusted: 0 };

  const reconDebits = await LedgerEntry.find({
    idempotencyKey: { $regex: /^MLM-WALLET-FIX-RECON-DEBIT-/ },
  });

  for (const row of reconDebits) {
    const userId = row.actorId;
    const wallet = await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
    });
    const bonusCredits = await sumShoppingCredits(userId);
    console.log(
      `DEBIT orphan ${userId}: ledger debit ₹${row.amount}, wallet ₹${wallet?.shoppingBalance}, bonusCredits ₹${bonusCredits}`,
    );
    if (APPLY) {
      await LedgerEntry.deleteOne({ _id: row._id });
      totals.reconDebitsRemoved += 1;
    }
  }

  const reconCredits = await LedgerEntry.find({
    idempotencyKey: { $regex: /^MLM-WALLET-FIX-RECON-CREDIT-/ },
  });

  for (const row of reconCredits) {
    const userId = row.actorId;
    const wallet = await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
    });
    if (!wallet) continue;
    console.log(
      `CREDIT orphan ${userId}: ledger credit ₹${row.amount}, wallet ₹${wallet.shoppingBalance}`,
    );
    if (APPLY) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await LedgerEntry.deleteOne({ _id: row._id }).session(session);
          wallet.shoppingBalance = roundCurrency(
            Math.max(0, (wallet.shoppingBalance || 0) - (row.amount || 0)),
          );
          await wallet.save({ session });
        });
      } finally {
        await session.endSession();
      }
      totals.reconCreditsRemoved += 1;
      totals.walletAdjusted += 1;
    }
  }

  console.log("Summary:", totals, APPLY ? "(applied)" : "(dry-run)");
  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
