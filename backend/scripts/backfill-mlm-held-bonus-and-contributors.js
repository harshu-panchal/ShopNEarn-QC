/**
 * backfill-mlm-held-bonus-and-contributors.js
 *
 * Customer-MLM-rebuild Phase 11 — idempotent migration that
 * brings every historical `MlmMembership` and `MlmCommissionEvent`
 * row up to the new Phase 1 schema:
 *
 *   1. `MlmMembership.heldPairBonusForSponsor`
 *      Set to 0 on every membership that doesn't already have a
 *      numeric value. The Mongoose default takes care of new rows,
 *      but legacy rows that pre-date the field need an explicit
 *      backfill so admin code can rely on `Number(field)` without
 *      coercing `undefined` to `NaN`. Re-running with `--apply` is
 *      a no-op once every row has a number.
 *
 *   2. `MlmCommissionEvent.meta.leftContributorUserId` /
 *      `.meta.rightContributorUserId`
 *      Best-effort backfill for historical `BINARY_PAIR_MATCH`
 *      events created before Phase 5 surfaced contributor info on
 *      the Matching Report. We CANNOT time-travel, so the heuristic
 *      is: order the recipient's directs on each leg by joinedAt
 *      ASC, then the pair at index `N` is satisfied by the Nth left
 *      direct and the Nth right direct. The script reports these
 *      "best-effort" matches so an operator can spot-check before
 *      committing. Events that already carry both contributor IDs
 *      are left untouched (idempotency).
 *
 * Per the `idempotent-data-migration` skill, the script is:
 *   - Idempotent: re-running with `--apply` does not double-write.
 *   - Resumable: streams via `.cursor()`, so a crash mid-run can be
 *     restarted from the start without harm.
 *   - Observable: prints a JSON summary with scanned / updated /
 *     unchanged / would-update counts, plus per-section warnings.
 *
 * Usage:
 *   node backend/scripts/backfill-mlm-held-bonus-and-contributors.js
 *   node backend/scripts/backfill-mlm-held-bonus-and-contributors.js --apply
 *   node backend/scripts/backfill-mlm-held-bonus-and-contributors.js --apply --verbose
 *   node backend/scripts/backfill-mlm-held-bonus-and-contributors.js --section=held
 *   node backend/scripts/backfill-mlm-held-bonus-and-contributors.js --section=contributors
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const sectionArg = process.argv.find((a) => a.startsWith("--section="));
const SECTION = sectionArg ? sectionArg.slice("--section=".length) : "all";

function tag(...args) {
  console.log("[backfill-mlm-held-bonus-and-contributors]", ...args);
}

// ---------------------------------------------------------------------
// Section 1: backfill MlmMembership.heldPairBonusForSponsor to 0.
// ---------------------------------------------------------------------
async function backfillHeldPairBonusForSponsor() {
  tag("Section 1: heldPairBonusForSponsor backfill");

  const totals = { scanned: 0, updated: 0, wouldUpdate: 0, unchanged: 0 };

  // Find rows where the field is missing or non-numeric. `$type: 1` is
  // double (number), `$type: 16/18` are 32/64-bit ints. Anything else
  // is treated as "needs backfill".
  const query = {
    $or: [
      { heldPairBonusForSponsor: { $exists: false } },
      { heldPairBonusForSponsor: null },
      { heldPairBonusForSponsor: { $not: { $type: "number" } } },
    ],
  };

  const cursor = MlmMembership.find(query, { _id: 1, userId: 1, heldPairBonusForSponsor: 1 })
    .cursor();

  for await (const row of cursor) {
    totals.scanned += 1;
    const current = row.heldPairBonusForSponsor;
    if (typeof current === "number" && Number.isFinite(current)) {
      totals.unchanged += 1;
      continue;
    }
    if (VERBOSE) {
      tag(`would set heldPairBonusForSponsor=0 on membership ${row._id} (user ${row.userId})`);
    }
    if (!APPLY) {
      totals.wouldUpdate += 1;
      continue;
    }
    await MlmMembership.updateOne(
      { _id: row._id },
      { $set: { heldPairBonusForSponsor: 0 } },
    );
    totals.updated += 1;
  }

  tag("Section 1 summary:", JSON.stringify(totals));
  return totals;
}

// ---------------------------------------------------------------------
// Section 2: backfill BINARY_PAIR_MATCH contributor IDs.
// ---------------------------------------------------------------------

// Cache of recipient directs to avoid querying the same upline tree
// hundreds of times when a single sponsor has many pair-match events.
const directsCache = new Map();

async function getDirectsByLeg(recipientUserId) {
  const key = String(recipientUserId);
  if (directsCache.has(key)) return directsCache.get(key);

  const directs = await MlmMembership.find(
    { sponsorId: recipientUserId },
    { userId: 1, binaryPosition: 1, joinedAt: 1, createdAt: 1 },
  )
    .sort({ joinedAt: 1, createdAt: 1 })
    .lean();

  const left = directs.filter((d) => d.binaryPosition === "L");
  const right = directs.filter((d) => d.binaryPosition === "R");
  const result = { left, right };
  directsCache.set(key, result);
  return result;
}

async function backfillContributorIds() {
  tag("Section 2: BINARY_PAIR_MATCH contributor ID backfill (best-effort)");

  const totals = {
    scanned: 0,
    alreadyFilled: 0,
    wouldUpdateBoth: 0,
    wouldUpdatePartial: 0,
    updatedBoth: 0,
    updatedPartial: 0,
    unresolved: 0,
  };

  const query = {
    bonusType: "BINARY_PAIR_MATCH",
    $or: [
      { "meta.leftContributorUserId": { $in: [null, undefined] } },
      { "meta.rightContributorUserId": { $in: [null, undefined] } },
      { "meta.leftContributorUserId": { $exists: false } },
      { "meta.rightContributorUserId": { $exists: false } },
    ],
  };

  const cursor = MlmCommissionEvent.find(query, {
    _id: 1,
    recipientId: 1,
    meta: 1,
  }).cursor();

  for await (const ev of cursor) {
    totals.scanned += 1;

    const existingLeft = ev.meta?.leftContributorUserId || null;
    const existingRight = ev.meta?.rightContributorUserId || null;
    if (existingLeft && existingRight) {
      totals.alreadyFilled += 1;
      continue;
    }

    const pairIndex = Number(ev.meta?.pairIndex || 0);
    if (!pairIndex || pairIndex < 1) {
      totals.unresolved += 1;
      if (VERBOSE) tag(`event ${ev._id} has no pairIndex; skipping`);
      continue;
    }

    const { left, right } = await getDirectsByLeg(ev.recipientId);

    // 1-based: the Nth pair is satisfied by the Nth left + Nth right.
    const nthIndex = pairIndex - 1;
    const leftCandidate = left[nthIndex] || null;
    const rightCandidate = right[nthIndex] || null;

    const update = {};
    if (!existingLeft && leftCandidate) {
      update["meta.leftContributorUserId"] = String(leftCandidate.userId);
    }
    if (!existingRight && rightCandidate) {
      update["meta.rightContributorUserId"] = String(rightCandidate.userId);
    }

    if (Object.keys(update).length === 0) {
      totals.unresolved += 1;
      if (VERBOSE) {
        tag(
          `event ${ev._id} pair#${pairIndex} recipient=${ev.recipientId} — no candidates found`,
        );
      }
      continue;
    }

    const isBoth =
      update["meta.leftContributorUserId"] &&
      update["meta.rightContributorUserId"];

    if (!APPLY) {
      if (isBoth) totals.wouldUpdateBoth += 1;
      else totals.wouldUpdatePartial += 1;
      if (VERBOSE) {
        tag(`would update event ${ev._id} pair#${pairIndex}:`, update);
      }
      continue;
    }

    await MlmCommissionEvent.updateOne({ _id: ev._id }, { $set: update });
    if (isBoth) totals.updatedBoth += 1;
    else totals.updatedPartial += 1;
  }

  tag("Section 2 summary:", JSON.stringify(totals));
  return totals;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");
  tag(`section=${SECTION}`);

  const summary = {};

  if (SECTION === "all" || SECTION === "held") {
    summary.heldPairBonusForSponsor = await backfillHeldPairBonusForSponsor();
  }
  if (SECTION === "all" || SECTION === "contributors") {
    summary.contributorIds = await backfillContributorIds();
  }

  tag("=== Overall summary ===");
  tag(JSON.stringify(summary, null, 2));

  if (!APPLY) {
    tag("This was a DRY-RUN. Re-run with --apply to commit changes.");
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  tag("FATAL", err?.stack || err?.message || err);
  process.exit(1);
});
