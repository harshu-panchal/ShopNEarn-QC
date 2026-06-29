/**
 * rollback-extra-first-pair-income.js
 *
 * Enforces one-time first-pair payout for historical data by rolling back
 * only the extra credited event when a member has BOTH:
 *   - binary pair match #1 (BINARY_PAIR_MATCH), and
 *   - first direct pair income (DIRECT_REFERRAL_ACTIVATION).
 *
 * Rule:
 *   - Keep the earliest credited first-pair event per member.
 *   - Reverse later first-pair event(s) only.
 *
 * Usage:
 *   node scripts/rollback-extra-first-pair-income.js
 *   node scripts/rollback-extra-first-pair-income.js --apply
 *   node scripts/rollback-extra-first-pair-income.js --apply --verbose
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
  isBinaryPairMatchIndexCommissionEvent,
  isDirectReferralFirstPairCommissionEvent,
} from "../app/services/mlm/mlmFirstPairIncomeGuard.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MIGRATION_ID = "MLM-FIRST-PAIR-DEDUPE-2026";

function log(...args) {
  console.log("[rollback-extra-first-pair-income]", ...args);
}

function ts(event) {
  const d = event?.creditedAt || event?.createdAt || event?.updatedAt || new Date(0);
  return new Date(d).getTime();
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

function classifyFirstPairEvents(events) {
  const firstPairRows = [];
  for (const ev of events) {
    if (ev.status !== MLM_COMMISSION_EVENT_STATUS.CREDITED) continue;
    if (
      isDirectReferralFirstPairCommissionEvent(ev)
      || isBinaryPairMatchIndexCommissionEvent(ev, 1)
    ) {
      firstPairRows.push(ev);
    }
  }
  return firstPairRows.sort((a, b) => ts(a) - ts(b));
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
      bonusType: {
        $in: [
          MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
          MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        ],
      },
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
      creditedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      meta: 1,
      ledgerEntryId: 1,
    },
  ).lean();

  const byUser = new Map();
  for (const ev of credited) {
    const uid = String(ev.recipientId || "");
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(ev);
  }

  const targets = [];
  for (const [uid, events] of byUser.entries()) {
    const firstPairEvents = classifyFirstPairEvents(events);
    if (firstPairEvents.length <= 1) continue;

    const keep = firstPairEvents[0];
    const extras = firstPairEvents.slice(1);
    targets.push({
      userId: uid,
      referralCode: codeByUserId.get(uid) || uid,
      keep,
      extras,
    });
  }

  let totalExtraEvents = 0;
  let totalExtraAmount = 0;
  for (const t of targets) {
    for (const e of t.extras) {
      totalExtraEvents += 1;
      totalExtraAmount += roundCurrency(e.cappedAmount || e.bonusAmount || 0);
    }
  }

  log(
    `${APPLY ? "APPLY" : "DRY-RUN"} targets=${targets.length} extraEvents=${totalExtraEvents} amount=₹${roundCurrency(totalExtraAmount)}`,
  );

  if (VERBOSE || !APPLY) {
    for (const t of targets) {
      const keepAmt = roundCurrency(t.keep.cappedAmount || t.keep.bonusAmount || 0);
      log(
        `KEEP ${t.referralCode} ${t.keep.bonusType} ₹${keepAmt} key=${t.keep.idempotencyKey}`,
      );
      for (const e of t.extras) {
        const amt = roundCurrency(e.cappedAmount || e.bonusAmount || 0);
        log(`  ROLLBACK ${e.bonusType} ₹${amt} key=${e.idempotencyKey}`);
      }
    }
  }

  if (!APPLY || !targets.length) {
    await mongoose.connection.close();
    return;
  }

  const totals = {
    membersScanned: targets.length,
    rolledBackEvents: 0,
    skippedAlreadyRolledBack: 0,
    skippedNoAmount: 0,
    errors: 0,
    totalDebited: 0,
  };

  for (const t of targets) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const extra of t.extras) {
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
            ledgerDescription: "Rollback duplicate first-pair MLM income",
            idempotencyKey: rollbackKey,
            correlationId: MIGRATION_ID,
            metadata: {
              migrationId: MIGRATION_ID,
              rollbackForEventId: String(fresh._id),
              originalBonusType: fresh.bonusType,
              originalIdempotencyKey: fresh.idempotencyKey,
              rollbackReason: "duplicate_first_pair_income",
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
              reason: "duplicate_first_pair_income",
              rolledBackAt: new Date(),
            },
          };
          await fresh.save({ session });

          totals.rolledBackEvents += 1;
          totals.totalDebited += amount;
          await syncCustomerMlmProjection(fresh.recipientId, { session });
        }
      });
    } catch (err) {
      totals.errors += 1;
      log(`ERROR ${t.referralCode}: ${err.message}`);
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
  console.error("[rollback-extra-first-pair-income] FATAL:", err);
  process.exit(1);
});

