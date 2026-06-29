/**
 * Restore earnings wallet for 6 members affected by recalc debits while
 * commission events (and lifetime counters) still show credited amounts.
 *
 *   node scripts/repair-recalc-earnings-wallet-drift.js
 *   node scripts/repair-recalc-earnings-wallet-drift.js --apply
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
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import { creditWallet } from "../app/services/finance/walletService.js";
import {
  computeBinaryTeamPairSnapshot,
  countPaidBinaryPairEvents,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
dotenv.config();

const APPLY = process.argv.includes("--apply");
const MIGRATION_ID = "MLM-RECALC-WALLET-RESTORE-2026";

const TARGET_CODES = [
  "SE90994515",
  "SE41171865",
  "SE17902084",
  "SEQ8H8W36Y",
  "SE12063631",
  "SE54146233",
];

function tag(...args) {
  console.log("[repair-recalc-wallet]", ...args);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function sumCreditedEarnings(userId) {
  const rows = await MlmCommissionEvent.aggregate([
    {
      $match: {
        recipientId: new mongoose.Types.ObjectId(userId),
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        walletBucket: { $in: ["earnings", "pending"] },
      },
    },
    { $group: { _id: null, total: { $sum: "$cappedAmount" } } },
  ]);
  return round2(rows[0]?.total || 0);
}

async function sumActiveWithdrawals(userId) {
  const rows = await MlmWithdrawalRequest.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
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
  return round2(rows[0]?.gross || 0);
}

async function alignPairCounters(membership, session) {
  const paidEvents = await countPaidBinaryPairEvents(membership.userId, { session });
  const snapshot = await computeBinaryTeamPairSnapshot(membership, { session });
  const pairsCompleted = Math.min(paidEvents, snapshot.binaryPairsEligible);

  const current = Number(membership.pairsCompleted) || 0;
  if (current === pairsCompleted) return { changed: false, pairsCompleted };

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

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY" : "DRY-RUN", "targets:", TARGET_CODES.join(", "));

  const summary = {
    walletCredits: 0,
    walletSkipped: 0,
    pairCountersFixed: 0,
    rows: [],
  };

  for (const code of TARGET_CODES) {
    const membership = await MlmMembership.findOne({ referralCode: code });
    if (!membership) {
      tag("SKIP not found:", code);
      continue;
    }

    const userId = membership.userId;
    const credited = await sumCreditedEarnings(userId);
    const withdrawn = await sumActiveWithdrawals(userId);
    const expectedWallet = round2(Math.max(credited - withdrawn, 0));
    const wallet = await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
    }).lean();
    const currentWallet = round2(wallet?.earningsBalance);
    const gap = round2(expectedWallet - currentWallet);

    const row = {
      referralCode: code,
      credited,
      withdrawn,
      expectedWallet,
      currentWallet,
      gap,
      walletAction: "none",
      pairAction: "unchanged",
    };

    if (gap > 0.01) {
      const idempotencyKey = `${MIGRATION_ID}-${String(userId)}`;
      const exists = await LedgerEntry.findOne({ idempotencyKey }).lean();

      if (exists) {
        row.walletAction = "already_applied";
        summary.walletSkipped += 1;
      } else if (APPLY) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await creditWallet({
              ownerType: OWNER_TYPE.CUSTOMER,
              ownerId: userId,
              amount: gap,
              bucket: "earnings",
              session,
              ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
              ledgerReference: idempotencyKey,
              ledgerDescription:
                "Restore earnings wallet after recalc debit (align with credited commission events)",
              idempotencyKey,
              correlationId: idempotencyKey,
              metadata: {
                fixScript: "repair-recalc-earnings-wallet-drift",
                credited,
                withdrawn,
                previousWallet: currentWallet,
              },
              syncUserWalletBalance: false,
            });

            const pairResult = await alignPairCounters(membership, session);
            if (pairResult.changed) {
              row.pairAction = `pairs ${pairResult.previous} → ${pairResult.pairsCompleted} (events ${pairResult.paidEvents})`;
              summary.pairCountersFixed += 1;
            }
          });
        } finally {
          await session.endSession();
        }
        row.walletAction = `credited ₹${gap}`;
        summary.walletCredits += 1;
      } else {
        row.walletAction = `would_credit ₹${gap}`;
        summary.walletCredits += 1;
        const pairPreview = await alignPairCounters(membership, null);
        if (pairPreview.changed) {
          row.pairAction = `would_set_pairs ${pairPreview.previous} → ${pairPreview.pairsCompleted}`;
        }
      }
    } else if (credited < withdrawn) {
      row.walletAction = "over_withdrawn_no_wallet_credit";
      summary.walletSkipped += 1;
      tag(
        `NOTE ${code}: credited ₹${credited} < withdrawn ₹${withdrawn}; wallet stays ₹${currentWallet}`,
      );
    } else {
      row.walletAction = "already_aligned";
      summary.walletSkipped += 1;
    }

    if (gap <= 0.01 && APPLY) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const live = await MlmMembership.findById(membership._id).session(session);
          const pairResult = await alignPairCounters(live, session);
          if (pairResult.changed) {
            row.pairAction = `pairs ${pairResult.previous} → ${pairResult.pairsCompleted}`;
            summary.pairCountersFixed += 1;
          }
        });
      } finally {
        await session.endSession();
      }
    } else if (gap <= 0.01 && !APPLY) {
      const pairPreview = await alignPairCounters(membership, null);
      if (pairPreview.changed) {
        row.pairAction = `would_set_pairs ${pairPreview.previous} → ${pairPreview.pairsCompleted}`;
      }
    }

    summary.rows.push(row);
    tag(JSON.stringify(row));
  }

  tag("Summary:", JSON.stringify(summary, null, 2));
  if (!APPLY) tag("Re-run with --apply to persist.");

  await mongoose.connection.close();
}

main().catch((err) => {
  tag("Fatal:", err.message);
  console.error(err);
  process.exit(1);
});
