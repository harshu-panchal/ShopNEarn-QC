/**
 * Consolidate the two member-facing identifiers — `MlmMembership.referralCode`
 * (random 8-char code minted at signup) and `Customer.userId` (e.g. "SE12345678")
 * — into ONE. After this migration every `MlmMembership.referralCode` mirrors
 * the linked `Customer.userId`, and the pre-migration value is shifted into
 * `MlmMembership.legacyReferralCode` so anyone still sharing the old code
 * (WhatsApp/cards/QRs) can still resolve a sponsor via the soft-transition
 * lookup in `getMembershipByReferralCode`.
 *
 * Per the `idempotent-data-migration` skill the script is:
 *   - Idempotent — re-running with --commit is a no-op once every membership
 *     has `referralCode === customer.userId`.
 *   - Resumable — operates one membership at a time so a crash mid-run can
 *     be restarted from the beginning without harm.
 *   - Observable — prints scanned / migrated / skipped / collision counts
 *     and runs a post-migration invariant check.
 *
 * SAFETY GUARDS (script refuses to commit when any of these fail):
 *   1. Every active Customer row MUST have a `userId`. If any are missing,
 *      run `backfill-customer-userids.js --apply` first.
 *   2. Every new referralCode (= userId) MUST be unique in MlmMembership.
 *      (Already enforced by the unique index; we'd hit E11000 on write.)
 *   3. The pre-migration referralCode being shifted into `legacyReferralCode`
 *      MUST not collide with another row's existing legacyReferralCode.
 *
 * Usage:
 *   node scripts/migrateReferralCodesToUserIds.js              # dry-run
 *   node scripts/migrateReferralCodesToUserIds.js --commit     # persist
 *   node scripts/migrateReferralCodesToUserIds.js --verbose    # extra logs
 *
 * Strictly does NOT touch:
 *   - Customer.userId — already canonical; nothing to change.
 *   - sponsorId / sponsorChain / wallet / commission events — these are
 *     keyed by `_id` ObjectId, not by code, so they're unaffected.
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import Customer from "../app/models/customer.js";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const VERBOSE = args.includes("--verbose");

function log(msg) {
  console.log(msg);
}
function vlog(msg) {
  if (VERBOSE) console.log(msg);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });

  // -------- Pre-flight 1: every customer needs a userId --------
  const customersMissingUserId = await Customer.countDocuments({
    userId: { $in: [null, ""] },
    __includeDeleted: true,
  });
  if (customersMissingUserId > 0) {
    console.error(
      `\n❌ ${customersMissingUserId} customer(s) are missing 'userId'. ` +
        `Run \`node scripts/backfill-customer-userids.js --apply\` first, then re-run this migration.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  log("✓ Pre-flight 1: every customer has a userId.");

  // -------- Scan EVERY membership (including soft-deleted) --------
  // Soft-deleted rows must also be migrated: if one is ever restored,
  // its stale legacy referralCode would otherwise re-emerge alongside
  // a live row that now uses the same identifier space, corrupting the
  // canonical "referralCode === Customer.userId" invariant.
  // `__includeDeleted: true` opts out of the model's pre('find') hook.
  const memberships = await MlmMembership.find(
    { __includeDeleted: true },
    { _id: 1, userId: 1, referralCode: 1, legacyReferralCode: 1 },
  ).lean();
  log(`\nScanned ${memberships.length} memberships (incl. soft-deleted).`);

  // Pull the linked Customer.userId for each in one bulk query.
  const customerIds = memberships.map((m) => m.userId);
  const customers = await Customer.find(
    { _id: { $in: customerIds }, __includeDeleted: true },
    { _id: 1, userId: 1, name: 1 },
  ).lean();
  const customerByObjectId = new Map(customers.map((c) => [String(c._id), c]));

  // -------- Categorise --------
  const buckets = {
    alreadyConsolidated: [], // referralCode already === userId; no-op
    toMigrate: [],            // referralCode !== userId; needs rewrite
    missingCustomer: [],      // membership points at a non-existent Customer
    customerMissingUserId: [], // shouldn't happen after pre-flight 1 but defended
    legacyCollision: [],      // pre-migration code is already someone else's legacyReferralCode
  };

  // Build a map of existing legacyReferralCodes so we can detect
  // would-be collisions BEFORE the write (cheaper than catching E11000).
  // Includes soft-deleted rows because the unique sparse index is
  // global — a soft-deleted row's legacy code still occupies the slot.
  const existingLegacy = await MlmMembership.find(
    { legacyReferralCode: { $ne: null }, __includeDeleted: true },
    { _id: 1, legacyReferralCode: 1 },
  ).lean();
  const legacyHolderByCode = new Map(
    existingLegacy.map((m) => [String(m.legacyReferralCode).toUpperCase(), String(m._id)]),
  );

  for (const m of memberships) {
    const cust = customerByObjectId.get(String(m.userId));
    if (!cust) {
      buckets.missingCustomer.push(m);
      continue;
    }
    if (!cust.userId) {
      buckets.customerMissingUserId.push(m);
      continue;
    }
    const targetCode = String(cust.userId).toUpperCase();
    const currentCode = String(m.referralCode || "").toUpperCase();
    if (currentCode === targetCode) {
      buckets.alreadyConsolidated.push(m);
      continue;
    }
    // Would-be collision: the pre-migration code we're about to shift
    // into THIS row's legacyReferralCode is already somebody else's
    // legacyReferralCode. Block the script before we commit a write
    // that the unique sparse index would reject anyway.
    if (
      currentCode &&
      legacyHolderByCode.has(currentCode) &&
      legacyHolderByCode.get(currentCode) !== String(m._id)
    ) {
      buckets.legacyCollision.push({ membership: m, conflictingId: legacyHolderByCode.get(currentCode) });
      continue;
    }
    buckets.toMigrate.push({ membership: m, customer: cust, targetCode });
  }

  log(`\nCategorisation:`);
  log(`  already-consolidated : ${buckets.alreadyConsolidated.length}`);
  log(`  to migrate           : ${buckets.toMigrate.length}`);
  log(`  missing customer     : ${buckets.missingCustomer.length}`);
  log(`  customer no userId   : ${buckets.customerMissingUserId.length}`);
  log(`  legacy collision     : ${buckets.legacyCollision.length}`);

  if (buckets.missingCustomer.length > 0) {
    console.error(
      `\n❌ ${buckets.missingCustomer.length} membership(s) reference a Customer that doesn't exist. ` +
        `Investigate and clean up before re-running.`,
    );
    for (const m of buckets.missingCustomer.slice(0, 5)) {
      console.error(`   - membershipId=${m._id} userId=${m.userId} referralCode=${m.referralCode}`);
    }
    await mongoose.disconnect();
    process.exit(1);
  }
  if (buckets.customerMissingUserId.length > 0) {
    console.error(
      `\n❌ ${buckets.customerMissingUserId.length} membership(s) have a Customer with no userId. ` +
        `Backfill should have caught this; investigate.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  if (buckets.legacyCollision.length > 0) {
    console.error(
      `\n❌ ${buckets.legacyCollision.length} membership(s) would create a legacyReferralCode collision. ` +
        `Manual reconciliation required.`,
    );
    for (const c of buckets.legacyCollision.slice(0, 5)) {
      console.error(
        `   - membershipId=${c.membership._id} would shift "${c.membership.referralCode}" into legacy, ` +
          `but that code is already on membershipId=${c.conflictingId}`,
      );
    }
    await mongoose.disconnect();
    process.exit(1);
  }

  if (buckets.toMigrate.length === 0) {
    log("\n✅ Nothing to migrate. Every membership already has referralCode === customer.userId.");
    await mongoose.disconnect();
    return;
  }

  // -------- Preview --------
  log("\nPreview (first 10):");
  for (const item of buckets.toMigrate.slice(0, 10)) {
    log(
      `  ${item.customer.name || "(no name)"} : "${item.membership.referralCode}" -> "${item.targetCode}"`,
    );
  }
  if (buckets.toMigrate.length > 10) {
    log(`  ... and ${buckets.toMigrate.length - 10} more.`);
  }

  if (!COMMIT) {
    log(
      "\n*** DRY-RUN — pass --commit to persist the changes above. No writes performed. ***",
    );
    await mongoose.disconnect();
    return;
  }

  // -------- Apply --------
  let migrated = 0;
  let failed = 0;
  log("\nMigrating...");

  for (const item of buckets.toMigrate) {
    const { membership: m, customer: c, targetCode } = item;
    const oldCode = m.referralCode || null;
    try {
      // Per-row updateOne keeps each row's commit independent — a
      // failure on one membership doesn't roll back the others. The
      // unique indexes on both fields enforce the invariants at the
      // storage layer regardless of what we set in JS.
      //
      // We go through the raw collection driver because the
      // pre('find') soft-delete hook ONLY fires for find* operations,
      // not for updateOne — so passing `__includeDeleted: true` to
      // updateOne would be treated as a literal filter and match
      // zero rows. The native driver bypasses Mongoose middleware
      // entirely, which is what we want for an offline migration.
      const setFields = { referralCode: targetCode };
      if (oldCode && oldCode !== targetCode) {
        setFields.legacyReferralCode = oldCode;
      }
      await MlmMembership.collection.updateOne(
        { _id: m._id },
        { $set: setFields },
      );
      // Keep the Customer.mlm.referralCode projection in sync.
      await Customer.collection.updateOne(
        { _id: m.userId },
        { $set: { "mlm.referralCode": targetCode } },
      );
      migrated += 1;
      vlog(`  ✓ ${c.name || c._id}: ${oldCode} -> ${targetCode}`);
    } catch (err) {
      failed += 1;
      console.error(
        `  ✗ membershipId=${m._id} userId=${m.userId} ` +
          `target="${targetCode}" old="${oldCode}" error=${err.message}`,
      );
    }
  }

  // -------- Post-migration invariant check --------
  const stillInconsistent = await MlmMembership.aggregate([
    {
      $lookup: {
        from: Customer.collection.name,
        localField: "userId",
        foreignField: "_id",
        as: "customer",
      },
    },
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    {
      $match: {
        $expr: {
          $ne: [
            { $toUpper: "$referralCode" },
            { $toUpper: { $ifNull: ["$customer.userId", ""] } },
          ],
        },
      },
    },
    { $count: "n" },
  ]);
  const drift = stillInconsistent[0]?.n || 0;

  log(`\n--- SUMMARY ---`);
  log(`  Migrated      : ${migrated}`);
  log(`  Failed        : ${failed}`);
  log(`  Drift remains : ${drift}  (post-migration invariant check)`);
  if (failed === 0 && drift === 0) {
    log(`\n🎉 COMMITTED. Every MlmMembership.referralCode now mirrors Customer.userId.`);
  } else {
    console.error(
      `\n⚠️  ${failed} write failure(s) and/or ${drift} row(s) still drifting. ` +
        `Re-run the script after investigating; idempotent.`,
    );
    process.exitCode = 1;
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
