/**
 * backfill-customer-userids.js
 *
 * Customer-MLM-rebuild Phase 7 (PO-request) — assign a public-facing
 * User ID to every Customer row that doesn't already have one.
 *
 * New signups get a userId at row-create time inside
 * `otpAuthService.issueCustomerOtp`. This script is the one-shot
 * backfill for every customer that signed up BEFORE that wiring
 * shipped.
 *
 * Per the `idempotent-data-migration` skill, the script is:
 *   - Idempotent — re-running with `--apply` is a no-op once every
 *     customer has a non-empty `userId`.
 *   - Resumable — streams via `.cursor()`, so a crash mid-run can be
 *     restarted from the beginning without harm.
 *   - Observable — prints scanned / updated / skipped / collided
 *     counts and a final checksum that verifies the invariant
 *     "every Customer.userId is unique" still holds after the run.
 *
 * COLLISION HANDLING
 *   The userId index is `unique: sparse`. If two processes race to
 *   assign the same value (vanishingly rare given the 32^8 search
 *   space, but possible), the second writer hits E11000. We catch
 *   that, regenerate, and try again — up to MAX_RETRIES per row.
 *
 * Usage:
 *   node backend/scripts/backfill-customer-userids.js              # dry run
 *   node backend/scripts/backfill-customer-userids.js --apply
 *   node backend/scripts/backfill-customer-userids.js --apply --verbose
 *   node backend/scripts/backfill-customer-userids.js --checksum   # only re-verify
 */
import dotenv from "dotenv";
import dns from "dns";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import Customer from "../app/models/customer.js";
import {
  generateUniqueUserId,
  USER_ID_PATTERN,
} from "../app/utils/userIdGenerator.js";

dotenv.config();

// Mirrors `backend/index.js maybeForcePublicDnsResolvers` so this
// one-off script can resolve MongoDB Atlas SRV records on dev boxes
// whose local resolver lacks the right glue records. Safe no-op
// when MONGO_URI is a plain `mongodb://` host.
(function forcePublicDnsResolversForSrv() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || "";
  if (!mongoUri.startsWith("mongodb+srv://")) return;
  const servers = (process.env.PUBLIC_DNS_SERVERS || "8.8.8.8,8.8.4.4,1.1.1.1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length === 0) return;
  dns.setServers(servers);
})();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const CHECKSUM_ONLY = process.argv.includes("--checksum");
const MAX_RETRIES_PER_ROW = 5;

function tag(...args) {
  console.log("[backfill-customer-userids]", ...args);
}

function isMissingUserId(value) {
  if (value === null || value === undefined) return true;
  const str = String(value).trim();
  if (!str) return true;
  return false;
}

function isMalformedUserId(value) {
  if (isMissingUserId(value)) return false;
  return !USER_ID_PATTERN.test(String(value));
}

async function rerollOnce(row, totals) {
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_ROW; attempt += 1) {
    const candidate = await generateUniqueUserId(Customer);
    try {
      const result = await Customer.updateOne(
        { _id: row._id },
        { $set: { userId: candidate } },
      );
      if (result.matchedCount === 0) return "concurrent";
      return candidate;
    } catch (err) {
      if (err && err.code === 11000) {
        totals.collisionsResolved += 1;
        if (VERBOSE) {
          tag(`E11000 on ${candidate} for ${row._id}; retrying (attempt ${attempt})`);
        }
        continue;
      }
      throw err;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Section 1: assign userIds to rows that don't have one OR carry a
// malformed value from an earlier broken generator pass.
// ---------------------------------------------------------------------
async function backfillMissingUserIds() {
  tag("Section 1: assign userIds to Customer rows that lack one or are malformed");

  const totals = {
    scanned: 0,
    alreadySet: 0,
    wouldUpdate: 0,
    wouldReroll: 0,
    updated: 0,
    rerolled: 0,
    collisionsResolved: 0,
    permanentFailures: 0,
  };

  // Scan EVERY row — we need to look at the actual value to decide
  // missing-vs-malformed-vs-good. The collection is tiny in the
  // realistic use-case (a few hundred customers max during the
  // backfill window) so a full scan is fine.
  const cursor = Customer.find({}, { _id: 1, userId: 1, phone: 1 }).cursor();

  for await (const row of cursor) {
    totals.scanned += 1;

    const missing = isMissingUserId(row.userId);
    const malformed = !missing && isMalformedUserId(row.userId);

    if (!missing && !malformed) {
      totals.alreadySet += 1;
      continue;
    }

    if (!APPLY) {
      if (malformed) {
        totals.wouldReroll += 1;
        if (VERBOSE) {
          tag(`would reroll malformed userId "${row.userId}" on customer ${row._id} (phone ${row.phone})`);
        }
      } else {
        totals.wouldUpdate += 1;
        if (VERBOSE) {
          tag(`would assign userId to customer ${row._id} (phone ${row.phone})`);
        }
      }
      continue;
    }

    const assigned = await rerollOnce(row, totals);
    if (assigned && assigned !== "concurrent") {
      if (malformed) totals.rerolled += 1;
      else totals.updated += 1;
      if (VERBOSE) {
        tag(`customer ${row._id} (phone ${row.phone}) -> ${assigned}`);
      }
    } else if (assigned === "concurrent") {
      totals.alreadySet += 1;
    } else {
      totals.permanentFailures += 1;
      tag(`PERMANENT FAILURE: customer ${row._id} (phone ${row.phone}) — gave up after ${MAX_RETRIES_PER_ROW} collisions`);
    }
  }

  tag("Section 1 summary:", JSON.stringify(totals));
  return totals;
}

// ---------------------------------------------------------------------
// Section 2: checksum — verify the invariant after the run.
//   1. Every Customer.userId is non-empty (only when APPLY=true).
//   2. Every Customer.userId matches the canonical format.
//   3. There are no duplicate userIds.
// ---------------------------------------------------------------------
async function checksum() {
  tag("Section 2: checksum");
  const totals = {
    totalCustomers: 0,
    withUserId: 0,
    missingUserId: 0,
    invalidFormat: 0,
    duplicates: 0,
  };

  totals.totalCustomers = await Customer.countDocuments({});
  totals.withUserId = await Customer.countDocuments({
    userId: { $exists: true, $nin: [null, ""] },
  });
  totals.missingUserId = totals.totalCustomers - totals.withUserId;

  // Format check — scan only rows that have a userId.
  const formatCursor = Customer.find(
    { userId: { $exists: true, $nin: [null, ""] } },
    { _id: 1, userId: 1 },
  ).cursor();
  for await (const row of formatCursor) {
    if (!USER_ID_PATTERN.test(String(row.userId))) {
      totals.invalidFormat += 1;
      if (VERBOSE) {
        tag(`customer ${row._id} has malformed userId "${row.userId}"`);
      }
    }
  }

  // Duplicate check via aggregation.
  const dupes = await Customer.aggregate([
    { $match: { userId: { $exists: true, $nin: [null, ""] } } },
    { $group: { _id: "$userId", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  totals.duplicates = dupes.length;
  if (dupes.length > 0) {
    tag("DUPLICATE USER IDs DETECTED — fix manually:");
    for (const dup of dupes) {
      tag(`  ${dup._id} appears ${dup.count} times on rows: ${dup.ids.join(", ")}`);
    }
  }

  tag("Section 2 summary:", JSON.stringify(totals));
  return totals;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  await connectDB();
  if (CHECKSUM_ONLY) {
    tag("CHECKSUM ONLY mode (no writes)");
  } else {
    tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");
  }

  const summary = {};
  if (!CHECKSUM_ONLY) {
    summary.assignment = await backfillMissingUserIds();
  }
  summary.checksum = await checksum();

  tag("=== Overall summary ===");
  tag(JSON.stringify(summary, null, 2));

  if (!APPLY && !CHECKSUM_ONLY) {
    tag("This was a DRY-RUN. Re-run with --apply to commit changes.");
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch(async (err) => {
  tag("FATAL", err?.stack || err?.message || err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
