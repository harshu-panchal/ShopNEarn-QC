/**
 * reconcile-earnings-wallet-drift.js
 *
 * Align the denormalized `wallet.earningsBalance` field to the ledger-backed
 * truth for members whose earnings wallet has drifted (e.g. residue left by the
 * history-only earnings regeneration). Writes an auditable, reversible
 * MLM_MANUAL_ADJUSTMENT ledger row for each correction.
 *
 * Target (canonical "expected earnings wallet"):
 *   target = creditedEarningsEvents(earnings|pending)
 *            − paidWithdrawalsGross
 *            − earningsSpentAtCheckout
 *
 * Safety:
 *   - DRY-RUN by default. Pass --apply to write.
 *   - SKIPS members with an in-flight (pending/approved) withdrawal.
 *   - SKIPS members with a non-zero pending bucket (held bonuses).
 *   - SKIPS if target would be negative.
 *   - Idempotent: an existing reconcile ledger row (same key) is a no-op.
 *   - Each correction runs in its own transaction.
 *
 * Usage:
 *   node scripts/reconcile-earnings-wallet-drift.js
 *   node scripts/reconcile-earnings-wallet-drift.js --verbose
 *   node scripts/reconcile-earnings-wallet-drift.js --apply
 *   node scripts/reconcile-earnings-wallet-drift.js --apply --verbose
 *   node scripts/reconcile-earnings-wallet-drift.js --only SE12169918,SE6A7787QN
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
  MLM_WITHDRAWAL_STATUS,
} from "../app/constants/mlm.js";
import {
  LEDGER_DIRECTION,
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import { creditWallet, debitWallet } from "../app/services/finance/walletService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const onlyIdx = process.argv.indexOf("--only");
const ONLY =
  onlyIdx >= 0 && process.argv[onlyIdx + 1]
    ? new Set(process.argv[onlyIdx + 1].split(",").map((s) => s.trim()))
    : null;

const TOL = 1; // ₹1
const MIGRATION_ID = "MLM-WALLET-RECONCILE-2026";

function r2(n) {
  return roundCurrency(Number(n) || 0);
}
function key(userId) {
  return `${MIGRATION_ID}-${String(userId)}`;
}

async function main() {
  await connectDB();
  console.log(
    APPLY ? "[reconcile] APPLY mode (writes enabled)" : "[reconcile] DRY-RUN (no writes)",
  );

  const members = await MlmMembership.find(
    {},
    { userId: 1, referralCode: 1, status: 1, lifetimePlanAEarnings: 1, lifetimePlanBEarnings: 1 },
  ).lean();

  const codeByUser = new Map(
    members.map((m) => [String(m.userId), m.referralCode || String(m.userId)]),
  );

  const [
    creditedEarnRows,
    paidWithdrawRows,
    inflightWithdrawRows,
    earningsSpentRows,
    wallets,
  ] = await Promise.all([
    MlmCommissionEvent.aggregate([
      {
        $match: {
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          walletBucket: { $in: ["earnings", "pending"] },
        },
      },
      { $group: { _id: "$recipientId", total: { $sum: "$cappedAmount" } } },
    ]),
    MlmWithdrawalRequest.aggregate([
      { $match: { status: MLM_WITHDRAWAL_STATUS.PAID } },
      { $group: { _id: "$userId", gross: { $sum: "$amount" } } },
    ]),
    MlmWithdrawalRequest.aggregate([
      {
        $match: {
          status: {
            $in: [MLM_WITHDRAWAL_STATUS.PENDING, MLM_WITHDRAWAL_STATUS.APPROVED],
          },
        },
      },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]),
    LedgerEntry.aggregate([
      {
        $match: {
          actorType: OWNER_TYPE.CUSTOMER,
          direction: LEDGER_DIRECTION.DEBIT,
          "metadata.bucketDrained": "earnings",
        },
      },
      { $group: { _id: "$actorId", total: { $sum: "$amount" } } },
    ]),
    Wallet.find({ ownerType: OWNER_TYPE.CUSTOMER }).lean(),
  ]);

  const mapNum = (rows, f = "total") =>
    new Map(rows.map((r) => [String(r._id), r2(r[f] || 0)]));
  const creditedByUser = mapNum(creditedEarnRows);
  const paidByUser = mapNum(paidWithdrawRows, "gross");
  const earningsSpentByUser = mapNum(earningsSpentRows);
  const inflightByUser = new Map(
    inflightWithdrawRows.map((r) => [String(r._id), Number(r.count) || 0]),
  );
  const walletByUser = new Map(
    wallets.map((w) => [
      String(w.ownerId),
      {
        _id: w._id,
        earnings: r2(w.earningsBalance),
        pending: r2(w.pendingBalance),
      },
    ]),
  );

  const toFix = [];
  const skipped = [];

  for (const m of members) {
    const uid = String(m.userId);
    const code = codeByUser.get(uid) || uid;
    if (ONLY && !ONLY.has(code)) continue;

    const wallet = walletByUser.get(uid) || { earnings: 0, pending: 0 };
    const grossEarned = creditedByUser.get(uid) || 0;
    const paidWithdrawn = paidByUser.get(uid) || 0;
    const earningsSpent = earningsSpentByUser.get(uid) || 0;
    const target = r2(grossEarned - paidWithdrawn - earningsSpent);
    const current = wallet.earnings;
    const delta = r2(target - current);

    const detail = {
      code,
      userId: uid,
      current,
      target,
      delta,
      grossEarned,
      paidWithdrawn,
      earningsSpent,
      pendingBucket: wallet.pending,
    };

    if (Math.abs(delta) <= TOL) continue; // already consistent

    if (inflightByUser.get(uid)) {
      skipped.push({ ...detail, reason: "in-flight withdrawal (pending/approved)" });
      continue;
    }
    if (wallet.pending > TOL) {
      skipped.push({ ...detail, reason: "non-zero pending bucket (held bonuses)" });
      continue;
    }
    if (target < -TOL) {
      skipped.push({ ...detail, reason: "computed target is negative" });
      continue;
    }
    toFix.push(detail);
  }

  toFix.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log(`\nMembers needing reconciliation: ${toFix.length}`);
  console.log(`Members skipped (need manual review): ${skipped.length}`);
  const totalUp = r2(toFix.filter((f) => f.delta > 0).reduce((s, f) => s + f.delta, 0));
  const totalDown = r2(toFix.filter((f) => f.delta < 0).reduce((s, f) => s + f.delta, 0));
  console.log(`Total credit-up: +${totalUp}   Total debit-down: ${totalDown}\n`);

  console.log("---- PLANNED ADJUSTMENTS ----");
  for (const f of toFix) {
    console.log(
      `${f.code.padEnd(12)} current=${String(f.current).padStart(7)} → target=${String(f.target).padStart(7)} | ${f.delta > 0 ? "CREDIT +" : "DEBIT "}${Math.abs(f.delta)} | earned=${f.grossEarned} paidWd=${f.paidWithdrawn} spent=${f.earningsSpent}`,
    );
  }
  if (skipped.length) {
    console.log("\n---- SKIPPED (manual review) ----");
    for (const s of skipped)
      console.log(`${s.code.padEnd(12)} delta=${s.delta} reason=${s.reason}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN only. Re-run with --apply to write these corrections.");
    await mongoose.connection.close();
    return;
  }

  console.log("\n[reconcile] Applying corrections...");
  let applied = 0;
  let alreadyDone = 0;
  let errors = 0;

  for (const f of toFix) {
    const idempotencyKey = key(f.userId);
    try {
      const existing = await LedgerEntry.findOne({ idempotencyKey }).lean();
      if (existing) {
        alreadyDone += 1;
        if (VERBOSE) console.log(`SKIP ${f.code} — reconcile ledger row already exists`);
        continue;
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const common = {
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: f.userId,
            amount: Math.abs(f.delta),
            bucket: "earnings",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            ledgerReference: idempotencyKey,
            ledgerDescription:
              "Earnings wallet reconciliation to ledger-backed history",
            idempotencyKey,
            correlationId: idempotencyKey,
            metadata: {
              bucket: "earnings",
              migrationId: MIGRATION_ID,
              reason: "wallet-vs-history drift correction",
              before: f.current,
              target: f.target,
              grossEarned: f.grossEarned,
              paidWithdrawn: f.paidWithdrawn,
              earningsSpent: f.earningsSpent,
            },
          };
          if (f.delta > 0) await creditWallet(common);
          else await debitWallet(common);
        });
        applied += 1;
        if (VERBOSE)
          console.log(`DONE ${f.code} ${f.delta > 0 ? "+" : ""}${f.delta} → ${f.target}`);
      } finally {
        session.endSession();
      }
    } catch (err) {
      errors += 1;
      console.log(`ERROR ${f.code}: ${err.message}`);
    }
  }

  console.log(
    `\n[reconcile] Applied=${applied} alreadyDone=${alreadyDone} errors=${errors}`,
  );
  await mongoose.connection.close();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[reconcile] FATAL:", err.message);
  process.exit(1);
});
