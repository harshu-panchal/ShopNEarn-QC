/**
 * backfill-mlm-leg-direct-counts.js
 *
 * Backfills the new Plan A binary-pair-bonus denormalised counters on
 * every existing `MlmMembership` row:
 *
 *   - `leftLegDirectCount`   = count of THIS member's direct referrals
 *                              that live in the LEFT subtree of THIS
 *                              member's binary tree.
 *   - `rightLegDirectCount`  = same for the RIGHT subtree.
 *   - `pairsCompleted`       = min(left, right).
 *   - `lastPaidPairIndex`    = pairsCompleted (so historical members
 *                              do NOT retroactively get pair bonuses
 *                              they never qualified for under the
 *                              legacy direct-referral milestone rules).
 *
 * Algorithm — per membership `M` with userId `U`:
 *   1. Find every direct referral `D` such that `D.sponsorId === U`.
 *   2. For each `D`, walk up `binaryParentId` until we reach `U` (or
 *      run off the tree). The first child link from `U` that is on
 *      `D`'s upline path tells us which leg `D` lives in:
 *        - If `D` is reached via `U.binaryLeftChildId`'s subtree,
 *          `leftLegDirectCount += 1`.
 *        - Else if reached via `U.binaryRightChildId`'s subtree,
 *          `rightLegDirectCount += 1`.
 *        - Otherwise (orphan placement) leave both counters alone and
 *          report it as an inconsistency.
 *   3. Persist counters + `pairsCompleted` + `lastPaidPairIndex`.
 *   4. Checksum: directs counted (left + right + orphans) must equal
 *      the legacy `directReferralsCount` for the member.
 *
 * Per `idempotent-data-migration` skill:
 *   - Default is dry-run; `--apply` writes.
 *   - Re-running with `--apply` is a no-op when counters already match
 *     the recomputed values.
 *
 * Usage:
 *   node backend/scripts/backfill-mlm-leg-direct-counts.js          # dry-run
 *   node backend/scripts/backfill-mlm-leg-direct-counts.js --apply  # write
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MAX_WALK_DEPTH = 100; // safety cap; real trees never get this deep

function tag(...args) {
  console.log("[backfill-mlm-leg-direct-counts]", ...args);
}

/**
 * Walk up `direct.binaryParentId` until we hit `sponsorUserId` or the
 * tree root. Returns one of "L" / "R" / null.
 *
 * Implementation detail: the leg is determined by the FIRST step DOWN
 * from the sponsor that contains the direct's upline, which is the
 * same as the LAST step UP from the direct that lands ON the sponsor.
 */
async function determineLegUnderSponsor({ sponsorUserId, sponsorMembership, directMembership }) {
  if (!directMembership) return null;
  // Quick wins: direct is one of the sponsor's two immediate children.
  if (
    sponsorMembership.binaryLeftChildId &&
    String(sponsorMembership.binaryLeftChildId) === String(directMembership.userId)
  ) {
    return "L";
  }
  if (
    sponsorMembership.binaryRightChildId &&
    String(sponsorMembership.binaryRightChildId) === String(directMembership.userId)
  ) {
    return "R";
  }

  // Walk up from the direct, tracking the previous node so when we
  // reach the sponsor we know which child slot we came from.
  let prev = directMembership;
  let cursor = directMembership.binaryParentId
    ? await MlmMembership.findOne(
        { userId: directMembership.binaryParentId },
        { userId: 1, binaryParentId: 1, binaryLeftChildId: 1, binaryRightChildId: 1 },
      ).lean()
    : null;

  for (let i = 0; i < MAX_WALK_DEPTH && cursor; i += 1) {
    if (String(cursor.userId) === String(sponsorUserId)) {
      // `prev` is the direct's ancestor that is a direct child of the
      // sponsor — its slot identifies the leg.
      if (
        cursor.binaryLeftChildId &&
        String(cursor.binaryLeftChildId) === String(prev.userId)
      ) {
        return "L";
      }
      if (
        cursor.binaryRightChildId &&
        String(cursor.binaryRightChildId) === String(prev.userId)
      ) {
        return "R";
      }
      return null;
    }
    prev = cursor;
    cursor = cursor.binaryParentId
      ? await MlmMembership.findOne(
          { userId: cursor.binaryParentId },
          { userId: 1, binaryParentId: 1, binaryLeftChildId: 1, binaryRightChildId: 1 },
        ).lean()
      : null;
  }
  return null;
}

async function backfillOne(membership, totals) {
  const sponsorUserId = membership.userId;
  const directs = await MlmMembership.find(
    { sponsorId: sponsorUserId },
    { userId: 1, sponsorId: 1, binaryParentId: 1 },
  ).lean();

  if (directs.length === 0) {
    // Nothing to count. Still ensure counters are zeroed if they exist.
    if (
      Number(membership.leftLegDirectCount) === 0 &&
      Number(membership.rightLegDirectCount) === 0 &&
      Number(membership.pairsCompleted) === 0 &&
      Number(membership.lastPaidPairIndex) === 0
    ) {
      totals.unchanged += 1;
      return;
    }
  }

  let left = 0;
  let right = 0;
  let orphans = 0;

  for (const direct of directs) {
    const leg = await determineLegUnderSponsor({
      sponsorUserId,
      sponsorMembership: membership,
      directMembership: direct,
    });
    if (leg === "L") left += 1;
    else if (leg === "R") right += 1;
    else orphans += 1;
  }

  const pairsCompleted = Math.min(left, right);
  const expectedDirects = directs.length;
  const observedDirects = left + right + orphans;
  const checksumOk = observedDirects === expectedDirects;
  const directCountMatches =
    expectedDirects === Number(membership.directReferralsCount || 0);

  const update = {
    leftLegDirectCount: left,
    rightLegDirectCount: right,
    pairsCompleted,
    // Lock historical members to their current pair count so they
    // don't get retroactive pair bonuses for matches that happened
    // before this feature shipped.
    lastPaidPairIndex: pairsCompleted,
  };

  const same =
    Number(membership.leftLegDirectCount || 0) === left &&
    Number(membership.rightLegDirectCount || 0) === right &&
    Number(membership.pairsCompleted || 0) === pairsCompleted &&
    Number(membership.lastPaidPairIndex || 0) === pairsCompleted;

  if (orphans > 0) totals.withOrphans += 1;
  if (!checksumOk) totals.checksumFailures += 1;
  if (!directCountMatches) totals.directCountMismatches += 1;

  if (VERBOSE) {
    tag(
      `${String(sponsorUserId)} L=${left} R=${right} orphans=${orphans} pairs=${pairsCompleted} (was L=${membership.leftLegDirectCount || 0} R=${membership.rightLegDirectCount || 0})`,
    );
  }

  if (same) {
    totals.unchanged += 1;
    return;
  }

  if (!APPLY) {
    totals.wouldUpdate += 1;
    return;
  }

  await MlmMembership.updateOne({ _id: membership._id }, { $set: update });
  totals.updated += 1;
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");

  const totals = {
    scanned: 0,
    updated: 0,
    wouldUpdate: 0,
    unchanged: 0,
    withOrphans: 0,
    checksumFailures: 0,
    directCountMismatches: 0,
  };

  // Process in deterministic order. Stream-style cursor avoids loading
  // every membership into memory at once.
  const cursor = MlmMembership.find(
    {},
    {
      userId: 1,
      directReferralsCount: 1,
      binaryLeftChildId: 1,
      binaryRightChildId: 1,
      leftLegDirectCount: 1,
      rightLegDirectCount: 1,
      pairsCompleted: 1,
      lastPaidPairIndex: 1,
    },
  ).cursor();

  for await (const m of cursor) {
    totals.scanned += 1;
    try {
      await backfillOne(m, totals);
    } catch (err) {
      tag(`ERROR while processing ${String(m.userId)}: ${err.message}`);
    }
  }

  tag("Summary:", JSON.stringify(totals, null, 2));

  if (totals.checksumFailures > 0) {
    tag(
      `WARNING: ${totals.checksumFailures} memberships had directs that could not be traced to a leg under the sponsor — manual review needed.`,
    );
  }
  if (totals.directCountMismatches > 0) {
    tag(
      `WARNING: ${totals.directCountMismatches} memberships have a directReferralsCount that disagrees with the actual MlmMembership rows.`,
    );
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  tag("FATAL", err?.stack || err?.message || err);
  process.exit(1);
});
