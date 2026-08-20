/**
 * seed-default-joining-plan.js
 *
 * Rollout safety for the multi-plan joining feature: seeds exactly one
 * `MlmJoiningPlan` row from the current live `Setting.mlm.joiningPackage*`
 * config, so existing behavior (one fixed-price package) is preserved
 * immediately after deploy — before admin adds any more packages via the
 * new Admin > MLM > Joining Plans page.
 *
 * Idempotent — skips entirely if ANY `MlmJoiningPlan` document already
 * exists (soft-deleted or not), so it's always safe to re-run.
 *
 * Usage:
 *   node backend/scripts/seed-default-joining-plan.js              # dry-run
 *   node backend/scripts/seed-default-joining-plan.js --apply      # write
 *
 * Per `idempotent-data-migration` skill: dry-run by default, summary
 * at the end.
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Setting from "../app/models/setting.js";
import MlmJoiningPlan from "../app/models/mlmJoiningPlan.js";
import { MLM_DEFAULTS } from "../app/constants/mlm.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();

  const anyPlan = await MlmJoiningPlan.findOne({ __includeDeleted: true }).lean();
  const summary = { existingPlanFound: !!anyPlan, apply: APPLY, created: false };

  if (anyPlan) {
    console.log(
      "[seed-default-joining-plan] An MlmJoiningPlan already exists; nothing to do.",
    );
    console.table(summary);
    process.exit(0);
  }

  const setting = await Setting.findOne(
    { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] },
    { mlm: 1 },
  ).lean();
  const cfg = { ...MLM_DEFAULTS, ...(setting?.mlm || {}) };

  const doc = {
    name: "Standard",
    description: "",
    price: Number(cfg.joiningPackagePrice) || 0,
    shoppingWalletCredit: Number(cfg.joiningPackageShoppingWalletCredit) || 0,
    // Reproduces the existing global ₹200 sponsor/referral/pair-matching
    // bonus base (2500 * 8% = 200) — zero behavior change on first seed.
    planCharge: 2500,
    benefitPercent: 8,
    sortOrder: 0,
    active: true,
  };

  if (APPLY) {
    const created = await MlmJoiningPlan.create(doc);
    summary.created = true;
    console.log("[seed-default-joining-plan] Created plan:", created.toObject());
  } else {
    console.log("[seed-default-joining-plan] (dry-run) Would create plan:", doc);
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[seed-default-joining-plan] FAILED:", error);
  process.exit(1);
});
