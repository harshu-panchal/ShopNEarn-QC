/**
 * seed-mlm-settings.js
 *
 * Idempotent seed for the `Setting.mlm` sub-document. Safe to run
 * multiple times — existing values are NEVER overwritten unless
 * `--force` is supplied. Defaults come from `constants/mlm.js`.
 *
 * Usage:
 *   node backend/scripts/seed-mlm-settings.js              # dry-run
 *   node backend/scripts/seed-mlm-settings.js --apply      # write
 *   node backend/scripts/seed-mlm-settings.js --apply --force  # overwrite
 *
 * Per `idempotent-data-migration` skill: dry-run by default, summary
 * at the end, reverse semantics documented inline.
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Setting from "../app/models/setting.js";
import { MLM_DEFAULTS } from "../app/constants/mlm.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

async function main() {
  await connectDB();

  const filter = { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] };
  const existing = await Setting.findOne(filter).lean();

  const summary = {
    settingExists: !!existing,
    mlmAlreadyPopulated: !!existing?.mlm?.enabled || !!existing?.mlm?.joiningPackagePrice,
    apply: APPLY,
    force: FORCE,
    writes: 0,
  };

  if (!existing) {
    if (APPLY) {
      await Setting.create({ tenantId: null, mlm: MLM_DEFAULTS });
      summary.writes += 1;
      console.log("[seed-mlm-settings] Created Setting document with mlm defaults.");
    } else {
      console.log("[seed-mlm-settings] (dry-run) Would create Setting + mlm defaults.");
    }
  } else if (!existing.mlm || !existing.mlm.joiningPackagePrice || FORCE) {
    if (APPLY) {
      const toSet = {};
      for (const [key, value] of Object.entries(MLM_DEFAULTS)) {
        toSet[`mlm.${key}`] = value;
      }
      await Setting.updateOne(filter, { $set: toSet });
      summary.writes += 1;
      console.log("[seed-mlm-settings] Updated Setting.mlm with defaults.");
    } else {
      console.log("[seed-mlm-settings] (dry-run) Would set Setting.mlm defaults.");
    }
  } else {
    console.log("[seed-mlm-settings] Setting.mlm already populated; no changes.");
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[seed-mlm-settings] FAILED:", error);
  process.exit(1);
});
