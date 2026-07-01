/**
 * Align MLM earnings wallets + lifetime counters + daily cap tracker with
 * credited commission events (source of truth after rollback/backfill fixes).
 *
 *   node scripts/repair-mlm-earnings-wallet-alignment.js
 *   node scripts/repair-mlm-earnings-wallet-alignment.js --apply
 *   node scripts/repair-mlm-earnings-wallet-alignment.js --apply --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import MlmWithdrawalRequest from "../app/models/mlmWithdrawalRequest.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import {
  MLM_COMMISSION_EVENT_STATUS,
  MLM_PLAN_TYPE,
  MLM_WITHDRAWAL_STATUS,
} from "../app/constants/mlm.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import { creditWallet, debitWallet } from "../app/services/finance/walletService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";
import {
  computeBinaryTeamPairSnapshot,
  countPaidBinaryPairEvents,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const TOLERANCE = 1;
const MIGRATION_ID = "MLM-EARNINGS-WALLET-ALIGN-2026";

function log(...args) {
  console.log("[repair-mlm-earnings-wallet-alignment]", ...args);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayIstDateString(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function istDayStartUtc(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 330 * 60 * 1000);
}

async function sumCreditedByPlan(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const rows = await MlmCommissionEvent.aggregate([
    {
      $match: {
        recipientId: uid,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        walletBucket: { $in: ["earnings", "pending"] },
      },
    },
    {
      $group: {
        _id: "$planType",
        total: { $sum: "$cappedAmount" },
      },
    },
  ]);
  let planA = 0;
  let planB = 0;
  let total = 0;
  for (const row of rows) {
    const amt = round2(row.total);
    total += amt;
    if (row._id === MLM_PLAN_TYPE.B) planB += amt;
    else planA += amt;
  }
  return { planA: round2(planA), planB: round2(planB), total: round2(total) };
}

async function sumTodayCredited(userId, dateStr) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const start = istDayStartUtc(dateStr);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const [row] = await MlmCommissionEvent.aggregate([
    {
      $match: {
        recipientId: uid,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        walletBucket: { $in: ["earnings", "pending"] },
        $or: [
          { creditedAt: { $gte: start, $lt: end } },
          { creditedAt: { $exists: false }, createdAt: { $gte: start, $lt: end } },
        ],
      },
    },
    { $group: { _id: null, total: { $sum: "$cappedAmount" } } },
  ]);
  return round2(row?.total || 0);
}

async function sumActiveWithdrawals(userId) {
  const [row] = await MlmWithdrawalRequest.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(String(userId)),
        status: {
          $in: [
            MLM_WITHDRAWAL_STATUS.PENDING,
            MLM_WITHDRAWAL_STATUS.APPROVED,
            MLM_WITHDRAWAL_STATUS.PAID,
          ],
        },
      },
    },
    { $group: { _id: null, gross: { $sum: "$amount" } } },
  ]);
  return round2(row?.gross || 0);
}

async function alignPairCounters(membership, session) {
  const paidEvents = await countPaidBinaryPairEvents(membership.userId, { session });
  const snapshot = await computeBinaryTeamPairSnapshot(membership, { session });
  const pairsCompleted = Math.min(paidEvents, snapshot.binaryPairsEligible);
  const current = Number(membership.pairsCompleted) || 0;
  if (current === pairsCompleted) {
    return { changed: false, pairsCompleted };
  }
  if (APPLY) {
    await MlmMembership.updateOne(
      { _id: membership._id },
      {
        $set: {
          ...snapshot,
          pairsCompleted,
          lastPaidPairIndex: pairsCompleted,
          binaryPairSnapshotAt: new Date(),
        },
      },
      { session },
    );
  }
  return { changed: true, pairsCompleted, previous: current, paidEvents };
}

async function repairMember(membership, summary) {
  const userId = membership.userId;
  const code = membership.referralCode || String(userId);
  const credited = await sumCreditedByPlan(userId);
  const withdrawn = await sumActiveWithdrawals(userId);
  const expectedWallet = round2(Math.max(credited.total - withdrawn, 0));

  const wallet = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
  }).lean();
  const currentWallet = round2(wallet?.earningsBalance);
  const walletGap = round2(expectedWallet - currentWallet);

  const storedA = round2(membership.lifetimePlanAEarnings);
  const storedB = round2(membership.lifetimePlanBEarnings);
  const lifetimeGapA = round2(credited.planA - storedA);
  const lifetimeGapB = round2(credited.planB - storedB);

  const today = todayIstDateString();
  const tracker = membership.dailyCapTracker || {};
  const trackerUsed = round2(tracker.usedAmount);
  const todayCredited = await sumTodayCredited(userId, today);
  const capStale =
    trackerUsed > round2(credited.total + TOLERANCE)
    || (
      tracker.date === today
      && trackerUsed > round2(todayCredited + TOLERANCE)
    );

  const needsWalletFix = Math.abs(walletGap) > TOLERANCE;
  const needsLifetimeFix =
    Math.abs(lifetimeGapA) > TOLERANCE || Math.abs(lifetimeGapB) > TOLERANCE;
  const needsCapFix = capStale;

  if (!needsWalletFix && !needsLifetimeFix && !needsCapFix) {
    return null;
  }

  const row = {
    referralCode: code,
    credited: credited.total,
    withdrawn,
    expectedWallet,
    currentWallet,
    walletGap,
    lifetimePlanA: `${storedA}→${credited.planA}`,
    dailyCap: capStale ? `${trackerUsed}→${todayCredited}` : "ok",
    actions: [],
  };

  if (!APPLY) {
    if (needsWalletFix) {
      row.actions.push(
        walletGap > 0
          ? `would_credit ₹${walletGap}`
          : `would_debit ₹${Math.abs(walletGap)}`,
      );
      summary.walletWouldFix += 1;
    }
    if (needsLifetimeFix) {
      row.actions.push("would_sync_lifetime");
      summary.lifetimeWouldFix += 1;
    }
    if (needsCapFix) {
      row.actions.push(`would_reset_daily_cap`);
      summary.capWouldFix += 1;
    }
    const pairPreview = await alignPairCounters(membership, null);
    if (pairPreview.changed) {
      row.actions.push(
        `would_set_pairs ${pairPreview.previous}→${pairPreview.pairsCompleted}`,
      );
    }
    summary.targets.push(row);
    if (VERBOSE) log(JSON.stringify(row));
    return row;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (needsWalletFix && walletGap > TOLERANCE) {
        const idempotencyKey = `${MIGRATION_ID}-CREDIT-${String(userId)}`;
        const exists = await LedgerEntry.findOne({ idempotencyKey }, null, { session });
        if (!exists) {
          await creditWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: userId,
            amount: walletGap,
            bucket: "earnings",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            ledgerReference: idempotencyKey,
            ledgerDescription:
              "Align earnings wallet with credited MLM commission events",
            idempotencyKey,
            correlationId: idempotencyKey,
            metadata: {
              migrationId: MIGRATION_ID,
              credited: credited.total,
              withdrawn,
              previousWallet: currentWallet,
            },
            syncUserWalletBalance: false,
          });
          row.actions.push(`credited ₹${walletGap}`);
          summary.walletCredited += 1;
        } else {
          row.actions.push("wallet_credit_already_applied");
        }
      } else if (needsWalletFix && walletGap < -TOLERANCE) {
        const idempotencyKey = `${MIGRATION_ID}-DEBIT-${String(userId)}`;
        const exists = await LedgerEntry.findOne({ idempotencyKey }, null, { session });
        if (!exists) {
          await debitWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: userId,
            amount: Math.abs(walletGap),
            bucket: "earnings",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            ledgerReference: idempotencyKey,
            ledgerDescription:
              "Align earnings wallet down to credited MLM commission events",
            idempotencyKey,
            correlationId: idempotencyKey,
            metadata: {
              migrationId: MIGRATION_ID,
              credited: credited.total,
              withdrawn,
              previousWallet: currentWallet,
            },
            syncUserWalletBalance: false,
          });
          row.actions.push(`debited ₹${Math.abs(walletGap)}`);
          summary.walletDebited += 1;
        } else {
          row.actions.push("wallet_debit_already_applied");
        }
      }

      const membershipUpdates = {};
      if (needsLifetimeFix) {
        membershipUpdates.lifetimePlanAEarnings = credited.planA;
        membershipUpdates.lifetimePlanBEarnings = credited.planB;
        row.actions.push("synced_lifetime");
        summary.lifetimeFixed += 1;
      }
      if (needsCapFix) {
        membershipUpdates.dailyCapTracker = {
          date: today,
          usedAmount: todayCredited,
        };
        row.actions.push(`reset_daily_cap`);
        summary.capFixed += 1;
      }

      if (Object.keys(membershipUpdates).length > 0) {
        await MlmMembership.updateOne(
          { _id: membership._id },
          { $set: membershipUpdates },
          { session },
        );
      }

      const live = await MlmMembership.findById(membership._id).session(session);
      const pairResult = await alignPairCounters(live, session);
      if (pairResult.changed) {
        row.actions.push(
          `pairs ${pairResult.previous}→${pairResult.pairsCompleted}`,
        );
        summary.pairCountersFixed += 1;
      }

      await syncCustomerMlmProjection(userId, { session });
    });
  } finally {
    await session.endSession();
  }

  summary.targets.push(row);
  if (VERBOSE) log(JSON.stringify(row));
  return row;
}

async function main() {
  await connectDB();
  log(APPLY ? "APPLY" : "DRY-RUN");

  const members = await MlmMembership.find(
    {},
    {
      userId: 1,
      referralCode: 1,
      lifetimePlanAEarnings: 1,
      lifetimePlanBEarnings: 1,
      dailyCapTracker: 1,
      pairsCompleted: 1,
    },
  ).lean();

  const summary = {
    membersScanned: members.length,
    walletWouldFix: 0,
    walletCredited: 0,
    walletDebited: 0,
    lifetimeWouldFix: 0,
    lifetimeFixed: 0,
    capWouldFix: 0,
    capFixed: 0,
    pairCountersFixed: 0,
    targets: [],
  };

  for (const membership of members) {
    await repairMember(membership, summary);
  }

  summary.affected = summary.targets.length;
  delete summary.targets;
  log("Summary:", JSON.stringify(summary, null, 2));
  if (!APPLY) log("Re-run with --apply to persist.");

  await mongoose.connection.close();
}

main().catch((err) => {
  log("Fatal:", err.message);
  console.error(err);
  process.exit(1);
});
