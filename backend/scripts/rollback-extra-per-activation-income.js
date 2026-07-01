/**
 * rollback-extra-per-activation-income.js
 *
 * Rolls back duplicate per-activation direct referral credits when the same
 * sponsor + activated direct has more than one credited row (e.g. live
 * MLM-DRPA-* plus regen MLM-EARN-REGEN-V3-DRPA-* for the same direct).
 *
 * Rule:
 *   - Keep the earliest canonical credit per (sponsor, activated direct).
 *   - Reverse later duplicate row(s) only.
 *
 * Usage:
 *   node scripts/rollback-extra-per-activation-income.js
 *   node scripts/rollback-extra-per-activation-income.js --apply
 *   node scripts/rollback-extra-per-activation-income.js --apply --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
} from "../app/constants/mlm.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import { debitWallet } from "../app/services/finance/walletService.js";
import {
  isPerActivationIncomeCommissionEvent,
  LEGACY_PER_ACTIVATION_DRA_KEY_RE,
  resolvePerActivationActivatedUserId,
} from "../app/services/mlm/mlmSignupBonusService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MIGRATION_ID = "MLM-PER-ACTIVATION-DEDUPE-2026";

function log(...args) {
  console.log("[rollback-extra-per-activation-income]", ...args);
}

function ts(event) {
  const d = event?.creditedAt || event?.createdAt || event?.updatedAt || new Date(0);
  return new Date(d).getTime();
}

function comparePerActivationEvents(a, b) {
  const aRegen = String(a.idempotencyKey || "").includes("REGEN");
  const bRegen = String(b.idempotencyKey || "").includes("REGEN");
  if (aRegen !== bRegen) return aRegen ? 1 : -1;

  const tsDiff = ts(a) - ts(b);
  if (tsDiff !== 0) return tsDiff;

  return String(a.idempotencyKey || "").localeCompare(
    String(b.idempotencyKey || ""),
  );
}

function makeRollbackIdempotencyKey(eventId) {
  return `${MIGRATION_ID}-${String(eventId)}`;
}

function resolveBucket(event) {
  const b = String(event?.walletBucket || "").toLowerCase();
  if (b === "pending" || b === "shopping" || b === "earnings") return b;
  return "earnings";
}

async function alreadyRolledBack(eventId, session) {
  const idempotencyKey = makeRollbackIdempotencyKey(eventId);
  const row = await MlmCommissionEvent.findOne(
    { "meta.rollback.idempotencyKey": idempotencyKey },
    null,
    { session },
  );
  return Boolean(row);
}

function groupPerActivationDuplicates(events) {
  const bySponsorDirect = new Map();

  for (const ev of events) {
    if (ev.status !== MLM_COMMISSION_EVENT_STATUS.CREDITED) continue;
    if (!isPerActivationIncomeCommissionEvent(ev)) continue;

    const sponsorId = String(ev.recipientId || "");
    const activatedId = resolvePerActivationActivatedUserId(ev);
    if (!sponsorId || !activatedId) continue;

    const key = `${sponsorId}:${activatedId}`;
    if (!bySponsorDirect.has(key)) bySponsorDirect.set(key, []);
    bySponsorDirect.get(key).push(ev);
  }

  const targets = [];
  for (const [key, rows] of bySponsorDirect.entries()) {
    if (rows.length <= 1) continue;
    const sorted = [...rows].sort(comparePerActivationEvents);
    targets.push({
      key,
      keep: sorted[0],
      extras: sorted.slice(1),
    });
  }

  return targets;
}

async function main() {
  await connectDB();

  const memberships = await MlmMembership.find({}, { userId: 1, referralCode: 1 }).lean();
  const codeByUserId = new Map(
    memberships.map((m) => [String(m.userId), m.referralCode || String(m.userId)]),
  );

  const credited = await MlmCommissionEvent.find(
    {
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      $or: [
        { bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION },
        {
          bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
          idempotencyKey: { $regex: LEGACY_PER_ACTIVATION_DRA_KEY_RE },
        },
      ],
    },
    {
      _id: 1,
      recipientId: 1,
      bonusType: 1,
      status: 1,
      walletBucket: 1,
      idempotencyKey: 1,
      cappedAmount: 1,
      bonusAmount: 1,
      sourceUserId: 1,
      creditedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      meta: 1,
      ledgerEntryId: 1,
    },
  ).lean();

  const duplicateGroups = groupPerActivationDuplicates(credited);
  const sponsorsTouched = new Set(
    duplicateGroups.map((g) => String(g.keep.recipientId)),
  );

  let totalExtraEvents = 0;
  let totalExtraAmount = 0;
  for (const group of duplicateGroups) {
    for (const extra of group.extras) {
      totalExtraEvents += 1;
      totalExtraAmount += roundCurrency(extra.cappedAmount || extra.bonusAmount || 0);
    }
  }

  log(
    `${APPLY ? "APPLY" : "DRY-RUN"} sponsors=${sponsorsTouched.size} duplicateGroups=${duplicateGroups.length} extraEvents=${totalExtraEvents} amount=₹${roundCurrency(totalExtraAmount)}`,
  );

  if (VERBOSE || !APPLY) {
    for (const group of duplicateGroups) {
      const sponsorCode = codeByUserId.get(String(group.keep.recipientId)) || group.keep.recipientId;
      const keepAmt = roundCurrency(group.keep.cappedAmount || group.keep.bonusAmount || 0);
      log(
        `KEEP ${sponsorCode} activated=${resolvePerActivationActivatedUserId(group.keep)} ${group.keep.bonusType} ₹${keepAmt} key=${group.keep.idempotencyKey}`,
      );
      for (const extra of group.extras) {
        const amt = roundCurrency(extra.cappedAmount || extra.bonusAmount || 0);
        log(`  ROLLBACK ${extra.bonusType} ₹${amt} key=${extra.idempotencyKey}`);
      }
    }
  }

  if (!APPLY || !duplicateGroups.length) {
    await mongoose.connection.close();
    return;
  }

  const totals = {
    duplicateGroups: duplicateGroups.length,
    rolledBackEvents: 0,
    skippedAlreadyRolledBack: 0,
    skippedNoAmount: 0,
    errors: 0,
    totalDebited: 0,
  };

  const extrasBySponsor = new Map();
  for (const group of duplicateGroups) {
    const sponsorId = String(group.keep.recipientId);
    if (!extrasBySponsor.has(sponsorId)) extrasBySponsor.set(sponsorId, []);
    extrasBySponsor.get(sponsorId).push(...group.extras);
  }

  for (const [sponsorId, extras] of extrasBySponsor.entries()) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const extra of extras) {
          const fresh = await MlmCommissionEvent.findOne(
            { _id: extra._id },
            null,
            { session },
          );
          if (!fresh || fresh.status !== MLM_COMMISSION_EVENT_STATUS.CREDITED) {
            continue;
          }

          if (await alreadyRolledBack(fresh._id, session)) {
            totals.skippedAlreadyRolledBack += 1;
            continue;
          }

          const amount = roundCurrency(fresh.cappedAmount || fresh.bonusAmount || 0);
          if (amount <= 0) {
            totals.skippedNoAmount += 1;
            continue;
          }

          const rollbackKey = makeRollbackIdempotencyKey(fresh._id);
          const bucket = resolveBucket(fresh);

          await debitWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: fresh.recipientId,
            amount,
            bucket,
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            ledgerReference: rollbackKey,
            ledgerDescription: "Rollback duplicate direct referral activation income",
            idempotencyKey: rollbackKey,
            correlationId: MIGRATION_ID,
            metadata: {
              migrationId: MIGRATION_ID,
              rollbackForEventId: String(fresh._id),
              originalBonusType: fresh.bonusType,
              originalIdempotencyKey: fresh.idempotencyKey,
              rollbackReason: "duplicate_per_activation_income",
            },
            syncUserWalletBalance: false,
          });

          fresh.status = MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK;
          fresh.clawbackAt = new Date();
          fresh.clawbackAmount = amount;
          fresh.meta = {
            ...(fresh.meta || {}),
            rollback: {
              migrationId: MIGRATION_ID,
              idempotencyKey: rollbackKey,
              reason: "duplicate_per_activation_income",
              rolledBackAt: new Date(),
            },
          };
          await fresh.save({ session });

          totals.rolledBackEvents += 1;
          totals.totalDebited += amount;
        }

        await syncCustomerMlmProjection(sponsorId, { session });
      });
    } catch (err) {
      totals.errors += 1;
      log(`ERROR ${codeByUserId.get(sponsorId) || sponsorId}: ${err.message}`);
    } finally {
      await session.endSession();
    }
  }

  totals.totalDebited = roundCurrency(totals.totalDebited);
  log("SUMMARY", JSON.stringify(totals, null, 2));
  await mongoose.connection.close();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[rollback-extra-per-activation-income] FATAL:", err);
  process.exit(1);
});
