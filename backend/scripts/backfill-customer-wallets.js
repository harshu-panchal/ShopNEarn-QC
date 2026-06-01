/**
 * Phase 4 P4-4 — backfill `Wallet({ownerType:"CUSTOMER"})` rows for every
 * legacy user that has a non-zero `User.walletBalance`.
 *
 * SAFE TO RUN: idempotent. Never deletes or mutates existing wallets;
 * only creates new ones for users without a wallet row. Mismatches are
 * reported for human review — the script does NOT auto-reconcile them.
 *
 * USAGE:
 *   node backend/scripts/backfill-customer-wallets.js
 *
 * Optional env:
 *   BACKFILL_INCLUDE_ZERO=true   Also create wallets for users whose
 *                                walletBalance is 0 (helpful if you want
 *                                a Wallet row for every customer).
 *
 * Rollback: drop any wallet with `meta.migratedFromUserField: true`.
 *   db.wallets.deleteMany({ "meta.migratedFromUserField": true })
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import User from "../app/models/customer.js";
import Wallet from "../app/models/wallet.js";
import {
  CURRENCY,
  OWNER_TYPE,
  WALLET_STATUS,
} from "../app/constants/finance.js";

dotenv.config();

async function main() {
  await connectDB();

  const includeZero =
    String(process.env.BACKFILL_INCLUDE_ZERO || "false").toLowerCase() === "true";
  const filter = includeZero ? {} : { walletBalance: { $gt: 0 } };

  const stats = {
    processed: 0,
    created: 0,
    alreadyExisted: 0,
    mismatched: 0,
    mismatches: [],
  };

  const cursor = User.find(filter).cursor();
  for await (const user of cursor) {
    stats.processed += 1;

    const existing = await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: user._id,
    }).lean();

    if (existing) {
      stats.alreadyExisted += 1;
      const userBal = Number(user.walletBalance || 0);
      const walletBal = Number(existing.availableBalance || 0);
      if (Math.abs(userBal - walletBal) > 0.01) {
        stats.mismatched += 1;
        stats.mismatches.push({
          userId: String(user._id),
          userBalance: userBal,
          walletBalance: walletBal,
          drift: Number((userBal - walletBal).toFixed(2)),
        });
      }
      continue;
    }

    await Wallet.create({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: user._id,
      currency: CURRENCY,
      availableBalance: Number(user.walletBalance || 0),
      pendingBalance: 0,
      cashInHand: 0,
      totalCredited: Number(user.walletBalance || 0),
      totalDebited: 0,
      status: WALLET_STATUS.ACTIVE,
      meta: { migratedFromUserField: true, migratedAt: new Date() },
    });
    stats.created += 1;

    if (stats.processed % 100 === 0) {
      console.log(
        `progress: processed=${stats.processed} created=${stats.created}`,
      );
    }
  }

  console.log("\n=== Backfill Summary ===");
  console.log(`Processed       : ${stats.processed}`);
  console.log(`Wallets created : ${stats.created}`);
  console.log(`Already existed : ${stats.alreadyExisted}`);
  console.log(`Mismatched      : ${stats.mismatched}`);

  if (stats.mismatched > 0) {
    console.log(
      "\nThe following users have drift between User.walletBalance and Wallet.availableBalance:",
    );
    stats.mismatches.slice(0, 50).forEach((row) => {
      console.log(
        `  user=${row.userId}  user.walletBalance=${row.userBalance}  wallet.availableBalance=${row.walletBalance}  drift=${row.drift}`,
      );
    });
    if (stats.mismatches.length > 50) {
      console.log(
        `  ... and ${stats.mismatches.length - 50} more (re-run with output redirected to a file to see all)`,
      );
    }
    console.log(
      "\nThese require manual investigation — DO NOT auto-reconcile.",
    );
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
