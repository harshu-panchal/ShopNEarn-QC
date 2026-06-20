/**
 * backfill-mlm-binary-team-pair-counts.js
 *
 * Recomputes team-based binary pair counts for every MlmMembership using
 * the client PHP flow:
 *   - Active Plan A volume in left / right binary subtrees
 *   - First pair 2:1 or 1:2, remaining pairs 1:1
 *   - Stores eligible pairs + leg balances on each membership row
 *
 * Also aligns `pairsCompleted` / `lastPaidPairIndex` with the number of
 * already-credited `BINARY_PAIR_MATCH` commission events (never exceeds
 * eligible pairs). Does NOT create wallet credits — counters only.
 *
 * Usage:
 *   node backend/scripts/backfill-mlm-binary-team-pair-counts.js
 *   node backend/scripts/backfill-mlm-binary-team-pair-counts.js --apply
 *   node backend/scripts/backfill-mlm-binary-team-pair-counts.js --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import {
  computeBinaryTeamPairSnapshot,
  countPaidBinaryPairEvents,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

function tag(...args) {
  console.log("[backfill-mlm-binary-team-pair-counts]", ...args);
}

function snapshotEquals(current, next) {
  return (
    Number(current.leftLegTeamActiveCount || 0) === next.leftLegTeamActiveCount &&
    Number(current.rightLegTeamActiveCount || 0) === next.rightLegTeamActiveCount &&
    Number(current.binaryPairsEligible || 0) === next.binaryPairsEligible &&
    Number(current.binaryLeftBalance || 0) === next.binaryLeftBalance &&
    Number(current.binaryRightBalance || 0) === next.binaryRightBalance &&
    Number(current.pairsCompleted || 0) === next.pairsCompleted &&
    Number(current.lastPaidPairIndex || 0) === next.lastPaidPairIndex
  );
}

async function backfillOne(membership, totals) {
  const snapshot = await computeBinaryTeamPairSnapshot(membership);
  const pairsPaidEvents = await countPaidBinaryPairEvents(membership.userId);

  let pairsCompleted = Math.min(pairsPaidEvents, snapshot.binaryPairsEligible);
  if (pairsPaidEvents > snapshot.binaryPairsEligible) {
    totals.paidExceedsEligible += 1;
    if (VERBOSE) {
      tag(
        `WARN ${String(membership.userId)} paidEvents=${pairsPaidEvents} > eligible=${snapshot.binaryPairsEligible}`,
      );
    }
  }

  const update = {
    ...snapshot,
    pairsCompleted,
    lastPaidPairIndex: pairsCompleted,
    binaryPairSnapshotAt: new Date(),
  };

  if (snapshotEquals(membership, update)) {
    totals.unchanged += 1;
    return;
  }

  if (VERBOSE) {
    tag(
      `${String(membership.userId)} L=${snapshot.leftLegTeamActiveCount} R=${snapshot.rightLegTeamActiveCount} eligible=${snapshot.binaryPairsEligible} paid=${pairsCompleted} bal L=${snapshot.binaryLeftBalance} R=${snapshot.binaryRightBalance}`,
    );
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
  tag(APPLY ? "APPLY mode (writes enabled)" : "DRY-RUN (no writes)");

  const totals = {
    scanned: 0,
    updated: 0,
    wouldUpdate: 0,
    unchanged: 0,
    paidExceedsEligible: 0,
    errors: 0,
  };

  const cursor = MlmMembership.find(
    {},
    {
      userId: 1,
      binaryLeftChildId: 1,
      binaryRightChildId: 1,
      leftLegTeamActiveCount: 1,
      rightLegTeamActiveCount: 1,
      binaryPairsEligible: 1,
      binaryLeftBalance: 1,
      binaryRightBalance: 1,
      pairsCompleted: 1,
      lastPaidPairIndex: 1,
    },
  ).cursor();

  for await (const m of cursor) {
    totals.scanned += 1;
    try {
      await backfillOne(m, totals);
    } catch (err) {
      totals.errors += 1;
      tag(`ERROR ${String(m.userId)}: ${err.message}`);
    }
  }

  tag("Summary:", JSON.stringify(totals, null, 2));

  await mongoose.connection.close();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  tag("Fatal:", err.message);
  process.exit(1);
});
