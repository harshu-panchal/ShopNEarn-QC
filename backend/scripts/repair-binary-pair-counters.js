/**
 * repair-binary-pair-counters.js
 *
 * A zero-benefit trigger (see backfill-standard-plan-member-benefit-amount.js)
 * used to make `computeAndCreditBinaryTeamPairIncome` advance
 * `sponsor.pairsCompleted`/`lastPaidPairIndex` past pair-indices that
 * were never actually credited (fixed in mlmBinaryPairIncomeService.js —
 * that code path now bails out with no state mutation instead). This
 * repairs the damage already done: rolls each affected sponsor's
 * counters back to the true max pair-index that has a real
 * `BINARY_PAIR_MATCH` MlmCommissionEvent, so the corrected code can
 * re-evaluate and credit the recovered pairs on the next activation
 * (or via replay-recovered-binary-pairs.js).
 *
 * `binaryDailyPairTracker` is deliberately left untouched — it's
 * day-scoped and self-corrects on the next calendar day regardless.
 *
 * Safe to run even if some rows turn out already correct (no-op for
 * those) or if run more than once — it only ever rolls a counter DOWN
 * to match reality, never up, and `creditBonusToEarningsWallet`'s own
 * idempotency check makes any subsequent re-credit attempt for an
 * already-paid index a safe no-op regardless.
 *
 * Usage:
 *   node backend/scripts/repair-binary-pair-counters.js              # dry-run
 *   node backend/scripts/repair-binary-pair-counters.js --apply      # write
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

function maxCreditedPairIndex(events) {
  return events.reduce((max, e) => {
    const m = String(e.idempotencyKey || "").match(/-P(\d+)$/);
    const idx = m ? parseInt(m[1], 10) : 0;
    return Math.max(max, idx);
  }, 0);
}

async function main() {
  await connectDB();

  const sponsors = await MlmMembership.find({ pairsCompleted: { $gt: 0 } })
    .select("userId pairsCompleted lastPaidPairIndex")
    .lean();

  const affected = [];
  for (const s of sponsors) {
    const events = await MlmCommissionEvent.find({
      recipientId: s.userId,
      bonusType: "BINARY_PAIR_MATCH",
    })
      .select("idempotencyKey")
      .lean();
    const maxCredited = maxCreditedPairIndex(events);
    if (s.pairsCompleted > maxCredited) {
      affected.push({ userId: s.userId, pairsCompleted: s.pairsCompleted, maxCredited, gap: s.pairsCompleted - maxCredited });
    }
  }

  console.log(
    APPLY
      ? `[repair-binary-pair-counters] Applying to ${affected.length} sponsor(s), ${affected.reduce((s, a) => s + a.gap, 0)} total recovered pair-index(es)...`
      : `[repair-binary-pair-counters] (dry-run) ${affected.length} sponsor(s) would be repaired:`,
  );

  for (const a of affected) {
    console.log(
      `  ${APPLY ? "Repairing" : "would repair"} ${a.userId}: pairsCompleted ${a.pairsCompleted} -> ${a.maxCredited} (gap ${a.gap})`,
    );
    if (APPLY) {
      await MlmMembership.updateOne(
        { userId: a.userId },
        { $set: { pairsCompleted: a.maxCredited, lastPaidPairIndex: a.maxCredited } },
      );
    }
  }

  console.table({
    sponsorsAffected: affected.length,
    totalRecoveredPairs: affected.reduce((s, a) => s + a.gap, 0),
    applied: APPLY,
  });
  process.exit(0);
}

main().catch((error) => {
  console.error("[repair-binary-pair-counters] FAILED:", error);
  process.exit(1);
});
