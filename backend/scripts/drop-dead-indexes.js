/**
 * Phase 3 P3-1 — drop dead indexes that the legacy `databaseIndexManager`
 * created against fields that don't exist (or against an entirely fake
 * `withdrawals` collection).
 *
 * SAFE TO RUN: This script ONLY drops named indexes whose key fields
 * don't exist on the schema. It does not touch a single document.
 *
 * Idempotent: re-runs are no-ops once the indexes are gone.
 *
 * USAGE:
 *   node backend/scripts/drop-dead-indexes.js
 *
 * Optionally set MONGODB_URI / MONGO_URI in your environment (or .env)
 * before running.
 *
 * Rollback: not needed — the dropped indexes pointed at non-existent
 * fields, so no query ever used them. If you really need them back,
 * checking out the pre-P3-2 `databaseIndexManager.js` and re-running
 * `createAllIndexes()` recreates them.
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";

dotenv.config();

const DROP_LIST = [
  // transactions: fields are `user` + `userModel`, not `userId`.
  { coll: "transactions", name: "idx_user_created_type" },
  { coll: "transactions", name: "idx_user_status_created" },

  // notifications: field is `isRead`, not `read`.
  { coll: "notifications", name: "idx_recipient_read_created" },

  // ledgerentries: fields are `actorType` + `actorId`, not `ownerType` + `ownerId`.
  { coll: "ledgerentries", name: "idx_ownerType_ownerId_created" },

  // withdrawals indexes (the collection itself is dropped below if empty).
  { coll: "withdrawals", name: "idx_status_created" },
  { coll: "withdrawals", name: "idx_user_userModel_created" },
];

async function main() {
  await connectDB();
  const db = mongoose.connection.db;

  const results = {
    dropped: [],
    skipped: [],
    failed: [],
  };

  for (const { coll, name } of DROP_LIST) {
    try {
      const collExists = await db
        .listCollections({ name: coll }, { nameOnly: true })
        .hasNext();
      if (!collExists) {
        results.skipped.push(`${coll}.${name} (collection missing)`);
        continue;
      }

      const indexes = await db.collection(coll).indexes();
      if (!indexes.some((i) => i.name === name)) {
        results.skipped.push(`${coll}.${name} (already gone)`);
        continue;
      }

      await db.collection(coll).dropIndex(name);
      results.dropped.push(`${coll}.${name}`);
      console.log(`Dropped index ${coll}.${name}`);
    } catch (error) {
      results.failed.push({ coll, name, error: error.message });
      console.error(`Failed to drop ${coll}.${name}: ${error.message}`);
    }
  }

  // Drop the empty `withdrawals` collection entirely — Withdrawal rows
  // actually live in `transactions` with `type:"Withdrawal"`.
  try {
    const exists = await db
      .listCollections({ name: "withdrawals" }, { nameOnly: true })
      .hasNext();
    if (exists) {
      const count = await db
        .collection("withdrawals")
        .estimatedDocumentCount();
      if (count === 0) {
        await db.collection("withdrawals").drop();
        console.log("Dropped empty `withdrawals` collection");
        results.dropped.push("withdrawals (collection)");
      } else {
        console.error(
          `withdrawals has ${count} documents — manual review required, skipping collection drop`,
        );
        results.skipped.push(`withdrawals (collection has ${count} docs)`);
      }
    } else {
      results.skipped.push("withdrawals (collection never existed)");
    }
  } catch (error) {
    if (error.codeName !== "NamespaceNotFound") {
      console.error(
        `Failed to drop withdrawals collection: ${error.message}`,
      );
      results.failed.push({
        coll: "withdrawals",
        name: "(collection)",
        error: error.message,
      });
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Dropped (${results.dropped.length}):`);
  results.dropped.forEach((x) => console.log(`  - ${x}`));
  console.log(`Skipped (${results.skipped.length}):`);
  results.skipped.forEach((x) => console.log(`  - ${x}`));
  if (results.failed.length > 0) {
    console.log(`Failed (${results.failed.length}):`);
    results.failed.forEach((x) =>
      console.log(`  - ${x.coll}.${x.name}: ${x.error}`),
    );
  }

  await mongoose.disconnect();
  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
