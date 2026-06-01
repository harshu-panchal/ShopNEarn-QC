/**
 * Phase 4 P4-5 — backfill `LedgerEntry` rows from every historical
 * `Transaction` row. After this script runs, the `LedgerEntry` collection
 * carries the full audit trail of money movements and the legacy
 * `Transaction` collection becomes a read-only mirror that can be safely
 * dropped in Phase 7.
 *
 * SAFE TO RUN: idempotent. Each LedgerEntry is keyed on a deterministic
 *   `transactionId = "LEGACY-TX-<txId>"`. Re-runs skip rows that already
 *   exist. NEVER deletes or mutates `Transaction` rows.
 *
 * USAGE:
 *   node backend/scripts/backfill-ledger-from-transactions.js
 *
 * Optional env:
 *   BACKFILL_BATCH_SIZE=500    Progress log interval (default 500).
 *   BACKFILL_DRY_RUN=true      Report what would happen; insert nothing.
 *
 * Rollback: drop any LedgerEntry where the transactionId starts with
 *   "LEGACY-TX-":
 *     db.ledgerentries.deleteMany({ transactionId: /^LEGACY-TX-/ })
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import Transaction from "../app/models/transaction.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import {
  CURRENCY,
  LEDGER_DIRECTION,
  LEDGER_STATUS,
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";

dotenv.config();

const TYPE_MAP = {
  "Order Payment": {
    type: LEDGER_TRANSACTION_TYPE.ORDER_ONLINE_PAYMENT_CAPTURED,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  "Delivery Earning": {
    type: LEDGER_TRANSACTION_TYPE.RIDER_PAYOUT_PROCESSED,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  Withdrawal: {
    type: LEDGER_TRANSACTION_TYPE.WITHDRAWAL,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  Refund: {
    type: LEDGER_TRANSACTION_TYPE.REFUND,
    direction: LEDGER_DIRECTION.CREDIT, // sign-flipped below if tx.amount < 0
  },
  Incentive: {
    type: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  Bonus: {
    type: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,
    direction: LEDGER_DIRECTION.CREDIT,
  },
  "Cash Collection": {
    type: LEDGER_TRANSACTION_TYPE.ORDER_COD_COLLECTED,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  "Cash Settlement": {
    type: LEDGER_TRANSACTION_TYPE.COD_REMITTED,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  "Wallet Payment": {
    type: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
    direction: LEDGER_DIRECTION.DEBIT,
  },
  "Wallet Refund": {
    type: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
    direction: LEDGER_DIRECTION.CREDIT,
  },
};

const ACTOR_MAP = {
  User: OWNER_TYPE.CUSTOMER,
  Seller: OWNER_TYPE.SELLER,
  Delivery: OWNER_TYPE.DELIVERY_PARTNER,
  Admin: OWNER_TYPE.ADMIN,
};

function mapStatus(legacyStatus) {
  switch (legacyStatus) {
    case "Settled":
      return LEDGER_STATUS.COMPLETED;
    case "Failed":
      return LEDGER_STATUS.FAILED;
    case "Pending":
    case "Processing":
    default:
      return LEDGER_STATUS.PENDING;
  }
}

async function main() {
  await connectDB();

  const batchSize = parseInt(
    process.env.BACKFILL_BATCH_SIZE || "500",
    10,
  );
  const dryRun =
    String(process.env.BACKFILL_DRY_RUN || "false").toLowerCase() === "true";

  if (dryRun) console.log("[DRY RUN] No documents will be inserted.");

  const stats = {
    processed: 0,
    created: 0,
    skipped: 0,
    unmapped: 0,
    unmappedSamples: [],
  };

  const cursor = Transaction.find({}).sort({ createdAt: 1 }).cursor();

  for await (const tx of cursor) {
    stats.processed += 1;

    const mapping = TYPE_MAP[tx.type];
    const actorType = ACTOR_MAP[tx.userModel];

    if (!mapping || !actorType) {
      stats.unmapped += 1;
      if (stats.unmappedSamples.length < 10) {
        stats.unmappedSamples.push({
          _id: String(tx._id),
          type: tx.type,
          userModel: tx.userModel,
        });
      }
      continue;
    }

    const transactionId = `LEGACY-TX-${tx._id}`;
    const existing = await LedgerEntry.findOne(
      { transactionId },
      { _id: 1 },
    ).lean();
    if (existing) {
      stats.skipped += 1;
      continue;
    }

    // Refund-with-negative-amount means actor was debited.
    let direction = mapping.direction;
    if (tx.type === "Refund" && Number(tx.amount) < 0) {
      direction = LEDGER_DIRECTION.DEBIT;
    }

    const payload = {
      transactionId,
      orderId: tx.order || null,
      walletId: null,
      actorType,
      actorId: tx.user || null,
      type: mapping.type,
      direction,
      amount: Math.abs(Number(tx.amount) || 0),
      currency: CURRENCY,
      status: mapStatus(tx.status),
      paymentMode: null,
      metadata: {
        ...(tx.meta || {}),
        migratedFromTransaction: true,
        originalTxId: String(tx._id),
        originalType: tx.type,
      },
      description: tx.type,
      reference: tx.reference || "",
    };

    if (!dryRun) {
      await LedgerEntry.create(payload);
    }
    stats.created += 1;

    if (stats.processed % batchSize === 0) {
      console.log(
        `progress: processed=${stats.processed} created=${stats.created} skipped=${stats.skipped} unmapped=${stats.unmapped}`,
      );
    }
  }

  console.log("\n=== Backfill Summary ===");
  console.log(`Processed   : ${stats.processed}`);
  console.log(`Created     : ${stats.created}${dryRun ? " (dry run — not inserted)" : ""}`);
  console.log(`Skipped     : ${stats.skipped} (already in ledger)`);
  console.log(`Unmapped    : ${stats.unmapped}`);

  if (stats.unmapped > 0) {
    console.log("\nSample unmapped rows (first 10):");
    stats.unmappedSamples.forEach((s) =>
      console.log(`  _id=${s._id} type=${s.type} userModel=${s.userModel}`),
    );
    console.log(
      "Add entries to TYPE_MAP / ACTOR_MAP if these are real categories.",
    );
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
