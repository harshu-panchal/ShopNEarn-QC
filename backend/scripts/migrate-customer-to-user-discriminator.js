/**
 * Phase 5 P5-3 — rewrite legacy discriminator values to their canonical
 * equivalents across every polymorphic collection:
 *
 *   - notifications.recipientModel    : "Customer" -> "User"
 *   - mediametadatas.uploadedByModel  : "Customer" -> "User"
 *   - tickets.userType                : "Customer" -> "User", "Rider" -> "Delivery"
 *   - otpsessions.userType            : "Customer" -> "User"
 *
 * Also backfills `Payout.beneficiaryModel` from `payoutType` so the new
 * `refPath` polymorphism (P5-4) can populate beneficiary documents.
 *
 * SAFE TO RUN: idempotent. Each pass only touches rows that still carry
 * the legacy value; re-runs match 0 rows once the migration completes.
 * NEVER deletes documents.
 *
 * USAGE:
 *   node backend/scripts/migrate-customer-to-user-discriminator.js
 *
 * Optional env:
 *   MIGRATION_DRY_RUN=true   Report what WOULD change without writing.
 *
 * Rollback: not recommended — once the canonical values are in place
 *   the codebase reads them. To roll back, re-run with reverse mappings.
 *   See audit plan §5.4 for the reverse-migration snippet.
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";

dotenv.config();

const OPERATIONS = [
  {
    collection: "notifications",
    filter: { recipientModel: "Customer" },
    update: { $set: { recipientModel: "User" } },
    label: "notifications.recipientModel Customer -> User",
  },
  {
    collection: "mediametadatas",
    filter: { uploadedByModel: "Customer" },
    update: { $set: { uploadedByModel: "User" } },
    label: "mediametadatas.uploadedByModel Customer -> User",
  },
  {
    collection: "tickets",
    filter: { userType: "Customer" },
    update: { $set: { userType: "User" } },
    label: "tickets.userType Customer -> User",
  },
  {
    collection: "tickets",
    filter: { userType: "Rider" },
    update: { $set: { userType: "Delivery" } },
    label: "tickets.userType Rider -> Delivery",
  },
  {
    collection: "otpsessions",
    filter: { userType: "Customer" },
    update: { $set: { userType: "User" } },
    label: "otpsessions.userType Customer -> User",
  },
];

const PAYOUT_BACKFILLS = [
  {
    filter: { payoutType: "SELLER", beneficiaryModel: { $exists: false } },
    update: { $set: { beneficiaryModel: "Seller" } },
    label: "payouts SELLER -> beneficiaryModel=Seller",
  },
  {
    filter: {
      payoutType: "DELIVERY_PARTNER",
      beneficiaryModel: { $exists: false },
    },
    update: { $set: { beneficiaryModel: "Delivery" } },
    label: "payouts DELIVERY_PARTNER -> beneficiaryModel=Delivery",
  },
];

async function main() {
  await connectDB();
  const dryRun =
    String(process.env.MIGRATION_DRY_RUN || "false").toLowerCase() === "true";
  if (dryRun) console.log("[DRY RUN] No documents will be modified.");

  const db = mongoose.connection.db;
  const summary = { ops: [], totalMatched: 0, totalModified: 0 };

  async function runOp(coll, filter, update, label) {
    const target = db.collection(coll);
    if (dryRun) {
      const matched = await target.countDocuments(filter);
      console.log(`${label}: would match ${matched}`);
      summary.ops.push({ label, matched, modified: 0, dryRun: true });
      summary.totalMatched += matched;
      return;
    }
    const result = await target.updateMany(filter, update);
    console.log(
      `${label}: matched=${result.matchedCount} modified=${result.modifiedCount}`,
    );
    summary.ops.push({
      label,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
    summary.totalMatched += result.matchedCount;
    summary.totalModified += result.modifiedCount;
  }

  console.log("\n--- Discriminator rewrites ---");
  for (const op of OPERATIONS) {
    try {
      await runOp(op.collection, op.filter, op.update, op.label);
    } catch (error) {
      console.error(`FAILED ${op.label}: ${error.message}`);
    }
  }

  console.log("\n--- Payout beneficiaryModel backfill ---");
  for (const op of PAYOUT_BACKFILLS) {
    try {
      await runOp("payouts", op.filter, op.update, op.label);
    } catch (error) {
      console.error(`FAILED ${op.label}: ${error.message}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total matched : ${summary.totalMatched}`);
  console.log(`Total modified: ${summary.totalModified}`);

  // Post-migration validation: confirm zero rows remain with the
  // legacy values in any of the migrated collections.
  console.log("\n--- Post-migration validation ---");
  const checks = [
    { coll: "notifications", filter: { recipientModel: "Customer" } },
    { coll: "mediametadatas", filter: { uploadedByModel: "Customer" } },
    { coll: "tickets", filter: { userType: { $in: ["Customer", "Rider"] } } },
    { coll: "otpsessions", filter: { userType: "Customer" } },
  ];
  let drift = 0;
  for (const c of checks) {
    const remaining = await db.collection(c.coll).countDocuments(c.filter);
    console.log(
      `${c.coll} ${JSON.stringify(c.filter)} : ${remaining} row(s) remaining`,
    );
    drift += remaining;
  }
  if (drift > 0 && !dryRun) {
    console.warn(
      `\nWARNING: ${drift} legacy rows still exist after migration. Re-run the script or investigate manually.`,
    );
  } else if (drift === 0) {
    console.log("\nAll discriminator values are now canonical.");
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
