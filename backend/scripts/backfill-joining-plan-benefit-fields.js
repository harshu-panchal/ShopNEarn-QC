/**
 * backfill-joining-plan-benefit-fields.js
 *
 * Rollout safety for the joining-plan "Benefit Percentage" feature:
 * every `MlmJoiningPlan` row created before this feature shipped is
 * missing `planCharge`/`benefitPercent`/`benefitBaseAmount`. Backfills
 * those rows with `planCharge: 2500, benefitPercent: 8` — reproducing
 * exactly the pre-existing global ₹200 sponsor/referral/pair-matching
 * bonus base, so this is a zero-behavior-change backfill.
 *
 * Idempotent — only touches rows where `planCharge` is missing, so
 * it's always safe to re-run (a second run finds nothing to do).
 *
 * Usage:
 *   node backend/scripts/backfill-joining-plan-benefit-fields.js              # dry-run
 *   node backend/scripts/backfill-joining-plan-benefit-fields.js --apply      # write
 *
 * Per `idempotent-data-migration` skill: dry-run by default, summary
 * at the end.
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmJoiningPlan from "../app/models/mlmJoiningPlan.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const PLAN_CHARGE = 2500;
const BENEFIT_PERCENT = 8;

async function main() {
  await connectDB();

  const rows = await MlmJoiningPlan.find({
    __includeDeleted: true,
    planCharge: { $exists: false },
  }).lean();

  const summary = { apply: APPLY, rowsFound: rows.length, updated: 0 };

  if (rows.length === 0) {
    console.log("[backfill-joining-plan-benefit-fields] No rows missing planCharge; nothing to do.");
    console.table(summary);
    process.exit(0);
  }

  for (const row of rows) {
    console.log(
      `[backfill-joining-plan-benefit-fields] ${APPLY ? "Updating" : "(dry-run) Would update"} plan "${row.name}" (${row._id}) -> planCharge: ${PLAN_CHARGE}, benefitPercent: ${BENEFIT_PERCENT}`,
    );
    if (APPLY) {
      const doc = await MlmJoiningPlan.findOne({ _id: row._id, __includeDeleted: true });
      doc.planCharge = PLAN_CHARGE;
      doc.benefitPercent = BENEFIT_PERCENT;
      await doc.save();
      summary.updated += 1;
    }
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[backfill-joining-plan-benefit-fields] FAILED:", error);
  process.exit(1);
});
