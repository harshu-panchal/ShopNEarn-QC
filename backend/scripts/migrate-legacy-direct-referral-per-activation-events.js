/**
 * Reclassify legacy per-direct referral credits that were stored as
 * DIRECT_REFERRAL_ACTIVATION with idempotency MLM-DRA-{sponsor}-{user}.
 *
 *   node scripts/migrate-legacy-direct-referral-per-activation-events.js
 *   node scripts/migrate-legacy-direct-referral-per-activation-events.js --apply
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
} from "../app/constants/mlm.js";
import {
  directReferralPerActivationIdempotencyKey,
  isLegacyPerActivationDirectReferralCredit,
  parseLegacyPerActivationDraKey,
} from "../app/services/mlm/mlmSignupBonusService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

function tag(...args) {
  console.log("[migrate-legacy-drpa]", ...args);
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY" : "DRY-RUN");

  const candidates = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    idempotencyKey: { $regex: /^MLM-DRA-[0-9a-f]{24}-[0-9a-f]{24}$/i },
  });

  const totals = { scanned: candidates.length, migrated: 0, skipped: 0 };

  for (const event of candidates) {
    if (
      !isLegacyPerActivationDirectReferralCredit({
        bonusType: event.bonusType,
        idempotencyKey: event.idempotencyKey,
      })
    ) {
      totals.skipped += 1;
      continue;
    }

    const parsed = parseLegacyPerActivationDraKey(event.idempotencyKey);
    if (!parsed) {
      totals.skipped += 1;
      continue;
    }

    const newKey = directReferralPerActivationIdempotencyKey(
      parsed.sponsorUserId,
      parsed.activatedUserId,
    );

    const canonical = await MlmCommissionEvent.findOne({
      idempotencyKey: newKey,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    }).lean();

    if (canonical && String(canonical._id) !== String(event._id)) {
      tag("SKIP duplicate canonical exists", event.idempotencyKey, "→", newKey);
      totals.skipped += 1;
      continue;
    }

    tag(
      `MIGRATE ${event.idempotencyKey} → ${newKey} (recipient ${String(event.recipientId)})`,
    );

    if (APPLY) {
      const legacyKey = event.idempotencyKey;
      event.bonusType = MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION;
      event.idempotencyKey = newKey;
      event.meta = {
        ...(event.meta || {}),
        migratedFromLegacyDraKey: legacyKey,
        incomeType: event.meta?.incomeType || "PER_ACTIVATION",
      };
      await event.save();
      totals.migrated += 1;
    } else {
      totals.migrated += 1;
    }
  }

  tag("Summary:", totals);
  if (!APPLY) tag("Re-run with --apply to persist.");

  await mongoose.connection.close();
}

main().catch((err) => {
  tag("Fatal:", err.message);
  process.exit(1);
});
