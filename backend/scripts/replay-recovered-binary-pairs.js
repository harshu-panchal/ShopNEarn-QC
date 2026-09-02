/**
 * replay-recovered-binary-pairs.js
 *
 * After repair-binary-pair-counters.js rolls a sponsor's `pairsCompleted`
 * back to the true credited count, the recovered pair-indices won't
 * actually get paid until some future activation naturally triggers a
 * recompute for that sponsor — which could be a long wait. This forces
 * it now, calling the exact same `computeAndCreditBinaryTeamPairIncome`
 * function real activations use (no parallel/duplicate logic) for each
 * affected sponsor, so the recovered pairs get credited today.
 *
 * `triggerUserId` for the replay is any of the sponsor's own active,
 * non-zero-benefit direct referrals — after
 * backfill-standard-plan-member-benefit-amount.js, essentially every
 * active member qualifies. Real team volumes (leftActive/rightActive)
 * already reflect actual history, so the function computes exactly the
 * recovered gap — no more, no less; each credit is idempotent per
 * pair-index (`MLM-BPM-<sponsor>-P<n>`), so a partial or repeated run
 * is always safe.
 *
 * MUST be run AFTER repair-binary-pair-counters.js --apply and
 * backfill-standard-plan-member-benefit-amount.js --apply, and after
 * the mlmBinaryPairIncomeService.js code fix is deployed.
 *
 * Usage:
 *   node backend/scripts/replay-recovered-binary-pairs.js              # dry-run
 *   node backend/scripts/replay-recovered-binary-pairs.js --apply      # write
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import {
  computeAndCreditBinaryTeamPairIncome,
  countLegActivePlanAVolumes,
  calculateBinaryPairs,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

// Exact set repaired by repair-binary-pair-counters.js — kept explicit
// (rather than re-derived) so this replay never accidentally drifts
// beyond the plan's approved scope, even if unrelated members' real
// eligible-pair counts have also moved since the repair ran.
const REPAIRED_SPONSOR_IDS = [
  "6a2280b34931c0271e9eb53d",
  "6a2a8b8f3452e722c988603c",
  "6a2a8c983452e722c988620a",
  "6a2a946a3452e722c9886b09",
  "6a2a96723452e722c9886dac",
  "6a2abcfa096a1573c50baa5f",
  "6a2be3d217d60299ddb9e9e7",
  "6a31622809873d769b43f564",
  "6a326a275d90c62d6f7fab55",
  "6a326b7b5d90c62d6f7fad7a",
  "6a33a5115d90c62d6f8079bf",
  "6a33c0835d90c62d6f808c35",
  "6a3b9b61ea19e348531ff6a4",
  "6a44ee62d7437e536db3a954",
  "6a527eab243134fa63ce5b70",
  "6a527f16243134fa63ce5c9b",
  "6a5e675fa029e7d84e92ae71",
  "6a691f4e0fa0fd258b07770a",
  "6a6b63b2e273284cb2b9b227",
  "6a71ea489f7445328efb05a6",
  "6a7eb965945ef6a1706d38d8",
  "6a88232c07eabe4f89be70ea",
];

/**
 * Who needs replaying is "real team volume supports more pairs than
 * pairsCompleted" — NOT "pairsCompleted > max credited event", which
 * is what repair-binary-pair-counters.js just fixed (so that check
 * would now show zero everywhere, uselessly). Fixing the counter
 * doesn't change actual team volume, so the recovered gap should still
 * show up here.
 */
async function main() {
  await connectDB();

  const sponsors = await MlmMembership.find({
    userId: { $in: REPAIRED_SPONSOR_IDS },
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
  }).lean();

  const affected = [];
  for (const s of sponsors) {
    const { leftActive, rightActive } = await countLegActivePlanAVolumes(s);
    const { pairs: totalEligible } = calculateBinaryPairs(leftActive, rightActive);
    const gap = totalEligible - (Number(s.pairsCompleted) || 0);
    if (gap > 0) {
      affected.push({ userId: s.userId, gap });
    }
  }

  console.log(
    APPLY
      ? `[replay-recovered-binary-pairs] Applying — ${affected.length} of ${REPAIRED_SPONSOR_IDS.length} repaired sponsor(s) have real team volume supporting recovered pairs:`
      : `[replay-recovered-binary-pairs] (dry-run) ${affected.length} of ${REPAIRED_SPONSOR_IDS.length} repaired sponsor(s) have real team volume supporting recovered pairs:`,
  );

  const summary = { sponsorsProcessed: 0, sponsorsNoTrigger: 0, eventsCredited: 0, totalAmount: 0 };

  for (const a of affected) {
    const trigger = await MlmMembership.findOne({
      sponsorId: a.userId,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      benefitBaseAmount: { $gt: 0 },
    })
      .select("userId")
      .lean();

    if (!trigger) {
      console.log(`  SKIP ${a.userId}: no active direct referral with a non-zero benefitBaseAmount to use as trigger.`);
      summary.sponsorsNoTrigger += 1;
      continue;
    }

    console.log(`  ${APPLY ? "Replaying" : "would replay"} ${a.userId} (gap ${a.gap}) using trigger ${trigger.userId}`);
    if (!APPLY) continue;

    const session = await mongoose.startSession();
    try {
      let events = [];
      await session.withTransaction(async () => {
        events = await computeAndCreditBinaryTeamPairIncome({
          sponsorUserId: a.userId,
          triggerUserId: trigger.userId,
          session,
          correlationId: "REPLAY-RECOVERED-BINARY-PAIRS",
        });
      });
      summary.sponsorsProcessed += 1;
      summary.eventsCredited += events.length;
      summary.totalAmount += events.reduce((s, e) => s + (Number(e.bonusAmount) || 0), 0);
      console.log(`    credited ${events.length} pair(s), ₹${events.reduce((s, e) => s + (Number(e.bonusAmount) || 0), 0)}`);
    } catch (error) {
      console.error(`    FAILED for ${a.userId}:`, error.message);
    } finally {
      await session.endSession();
    }
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[replay-recovered-binary-pairs] FAILED:", error);
  process.exit(1);
});
