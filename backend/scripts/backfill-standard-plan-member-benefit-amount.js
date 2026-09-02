/**
 * backfill-standard-plan-member-benefit-amount.js
 *
 * The "Standard" joining plan was missing planCharge/benefitPercent in
 * production (fixed by backfill-joining-plan-benefit-fields.js), so
 * every member who joined under it before that fix got
 * `benefitBaseAmount: 0` permanently snapshotted on their own
 * MlmMembership. That zero then propagates outward: whenever one of
 * these members triggers a sponsor's binary-pair-match recompute, the
 * sponsor's pair income for that batch scales to ₹0.
 *
 * This backfills those already-active memberships' `benefitBaseAmount`
 * to match the plan's current (now-corrected) value — re-read live
 * from the plan rather than hardcoded, so this stays correct even if
 * the plan's rate changes again later.
 *
 * Idempotent — only touches memberships still at 0/null; re-running
 * after a partial apply or after the plan's rate changes further is
 * always safe.
 *
 * Usage:
 *   node backend/scripts/backfill-standard-plan-member-benefit-amount.js              # dry-run
 *   node backend/scripts/backfill-standard-plan-member-benefit-amount.js --apply      # write
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmJoiningPlan from "../app/models/mlmJoiningPlan.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();

  const affected = await MlmMembership.find({
    joiningPlanId: { $ne: null },
    $or: [{ benefitBaseAmount: 0 }, { benefitBaseAmount: null }],
  })
    .select("userId joiningPlanId benefitBaseAmount")
    .lean();

  console.log(
    APPLY
      ? `[backfill-standard-plan-member-benefit-amount] Applying to ${affected.length} membership(s)...`
      : `[backfill-standard-plan-member-benefit-amount] (dry-run) ${affected.length} membership(s) would be checked:`,
  );

  const planIds = [...new Set(affected.map((m) => String(m.joiningPlanId)))];
  const plans = await MlmJoiningPlan.find({ _id: { $in: planIds }, __includeDeleted: true }).lean();
  const planMap = new Map(plans.map((p) => [String(p._id), p]));

  const summary = { checked: affected.length, skippedPlanZero: 0, updated: 0 };

  for (const m of affected) {
    const plan = planMap.get(String(m.joiningPlanId));
    const planBenefit = Number(plan?.benefitBaseAmount) || 0;
    if (planBenefit <= 0) {
      // The plan itself is still (legitimately) zero — nothing to backfill.
      summary.skippedPlanZero += 1;
      continue;
    }

    console.log(
      `  ${APPLY ? "Updating" : "would update"} membership ${m.userId} (plan "${plan.name}") -> benefitBaseAmount: ${planBenefit}`,
    );
    if (APPLY) {
      await MlmMembership.updateOne(
        { _id: m._id },
        { $set: { benefitBaseAmount: planBenefit } },
      );
      summary.updated += 1;
    }
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[backfill-standard-plan-member-benefit-amount] FAILED:", error);
  process.exit(1);
});
