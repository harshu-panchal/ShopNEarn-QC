/**
 * recalc-mlm-earnings-wallet.js
 *
 * One-time migration: zero each MLM member's earnings + pending wallet
 * buckets, void prior matching commission events, and re-credit binary
 * team pair income per the client PHP flow:
 *   - Team left/right active Plan A volumes
 *   - First pair 2:1 / 1:2, then 1:1
 *   - ₹/pair + daily pair cap from Setting.mlm.binaryPairIncomeTiers
 *   - pairsToPay = min(binaryPairsEligible, dailyPairCap)
 *
 * Shopping wallet is NOT touched. Does NOT recredit repurchase / mentor.
 *
 * Usage:
 *   node backend/scripts/recalc-mlm-earnings-wallet.js
 *   node backend/scripts/recalc-mlm-earnings-wallet.js --apply
 *   node backend/scripts/recalc-mlm-earnings-wallet.js --apply --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import MlmWithdrawalRequest from "../app/models/mlmWithdrawalRequest.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import Wallet from "../app/models/wallet.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
  MLM_WITHDRAWAL_STATUS,
} from "../app/constants/mlm.js";
import {
  computeBinaryTeamPairSnapshot,
  countActivePlanADirects,
  resolvePairIncomeConfig,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import {
  creditWallet,
  debitWallet,
  getOrCreateWallet,
} from "../app/services/finance/walletService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MIGRATION_ID = "MLM-EARN-RECALC-2026";
const RESET_KEY = (userId) => `${MIGRATION_ID}-RESET-${String(userId)}`;
const PAIR_KEY = (userId, pairIndex) =>
  `${MIGRATION_ID}-PAIR-${String(userId)}-P${pairIndex}`;

const VOID_BONUS_TYPES = [
  MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
  MLM_BONUS_TYPE.DIRECT_REFERRAL_MILESTONE,
];

function log(...args) {
  console.log("[recalc-mlm-earnings-wallet]", ...args);
}

async function ledgerExists(idempotencyKey, session) {
  const row = await LedgerEntry.findOne({ idempotencyKey: String(idempotencyKey) }).session(
    session || null,
  );
  return Boolean(row);
}

async function hasPendingWithdrawal(userId, session) {
  const row = await MlmWithdrawalRequest.findOne({
    userId,
    status: {
      $in: [MLM_WITHDRAWAL_STATUS.PENDING, MLM_WITHDRAWAL_STATUS.APPROVED],
    },
  }).session(session || null);
  return Boolean(row);
}

async function zeroBucketIfNeeded({
  userId,
  bucket,
  wallet,
  session,
  correlationId,
}) {
  const field = `${bucket}Balance`;
  const amount = roundCurrency(wallet[field] || 0);
  if (amount <= 0) return 0;

  const idempotencyKey = `${RESET_KEY(userId)}-${bucket.toUpperCase()}`;
  if (await ledgerExists(idempotencyKey, session)) {
    return 0;
  }

  await debitWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
    amount,
    bucket,
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
    ledgerReference: idempotencyKey,
    ledgerDescription: `Earnings recalc: zero ${bucket} before binary pair re-credit`,
    idempotencyKey,
    correlationId,
    metadata: { migrationId: MIGRATION_ID, bucket },
    syncUserWalletBalance: false,
  });

  return amount;
}

async function voidPriorMatchingEvents(userId, session) {
  const result = await MlmCommissionEvent.updateMany(
    {
      recipientId: userId,
      bonusType: { $in: VOID_BONUS_TYPES },
      status: {
        $in: [
          MLM_COMMISSION_EVENT_STATUS.CREDITED,
          MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_DOWNLINE_ACTIVATION,
          MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER,
        ],
      },
      "meta.recalcVoided": { $ne: true },
    },
    {
      $set: {
        status: MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
        "meta.recalcVoided": true,
        "meta.recalcMigrationId": MIGRATION_ID,
      },
    },
    session ? { session } : {},
  );
  return result.modifiedCount || 0;
}

async function recalcOne(membership, cfg, totals, session) {
  const userId = membership.userId;

  if (membership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) {
    totals.skippedInactive += 1;
    return;
  }

  if (await hasPendingWithdrawal(userId, session)) {
    totals.skippedPendingWithdrawal += 1;
    if (VERBOSE) log(`SKIP pending withdrawal ${String(userId)}`);
    return;
  }

  if (membership.meta?.earningsRecalcMigrationId === MIGRATION_ID) {
    totals.alreadyDone += 1;
    return;
  }

  if (await ledgerExists(`${RESET_KEY(userId)}-EARNINGS`, session)) {
    totals.alreadyDone += 1;
    return;
  }

  const hasRecalcPair = await LedgerEntry.findOne({
    idempotencyKey: { $regex: `^${MIGRATION_ID}-PAIR-${String(userId)}-P` },
  }).session(session || null);
  if (hasRecalcPair) {
    totals.alreadyDone += 1;
    return;
  }

  const wallet = await getOrCreateWallet(OWNER_TYPE.CUSTOMER, userId, { session });
  const correlationId = `${MIGRATION_ID}-${String(userId)}`;

  const snapshot = await computeBinaryTeamPairSnapshot(membership, { session });
  const directCount = await countActivePlanADirects(userId, { session });
  const isTopup = Boolean(membership.binaryTopupMember);
  const { pairIncome, dailyPairCap } = resolvePairIncomeConfig(cfg, directCount, isTopup);

  const pairsToPay =
    pairIncome > 0 && dailyPairCap > 0
      ? Math.min(snapshot.binaryPairsEligible, dailyPairCap)
      : 0;
  const totalIncome = roundCurrency(pairsToPay * pairIncome);

  const beforeEarnings = roundCurrency(wallet.earningsBalance || 0);
  const beforePending = roundCurrency(wallet.pendingBalance || 0);

  if (!APPLY) {
    totals.wouldProcess += 1;
    totals.wouldZeroEarnings += beforeEarnings;
    totals.wouldZeroPending += beforePending;
    totals.wouldCreditPairs += pairsToPay;
    totals.wouldCreditAmount += totalIncome;
    if (VERBOSE) {
      log(
        `WOULD ${String(userId)} zero E=${beforeEarnings} P=${beforePending} → ${pairsToPay} pairs × ₹${pairIncome} = ₹${totalIncome} (L=${snapshot.leftLegTeamActiveCount} R=${snapshot.rightLegTeamActiveCount})`,
      );
    }
    return;
  }

  const debitedEarnings = await zeroBucketIfNeeded({
    userId,
    bucket: "earnings",
    wallet: await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
    }).session(session),
    session,
    correlationId,
  });

  const debitedPending = await zeroBucketIfNeeded({
    userId,
    bucket: "pending",
    wallet: await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
    }).session(session),
    session,
    correlationId,
  });

  const voidedEvents = await voidPriorMatchingEvents(userId, session);

  let creditedPairs = 0;
  let creditedAmount = 0;

  for (let p = 1; p <= pairsToPay; p += 1) {
    const idempotencyKey = PAIR_KEY(userId, p);
    if (await ledgerExists(idempotencyKey, session)) {
      creditedPairs += 1;
      creditedAmount = roundCurrency(creditedAmount + pairIncome);
      continue;
    }

    const creditResult = await creditWallet({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
      amount: pairIncome,
      bucket: "earnings",
      session,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH,
      ledgerReference: idempotencyKey,
      ledgerDescription: `Binary pair #${p} team match (earnings recalc)`,
      idempotencyKey,
      correlationId,
      metadata: {
        migrationId: MIGRATION_ID,
        pairIndex: p,
        leftActive: snapshot.leftLegTeamActiveCount,
        rightActive: snapshot.rightLegTeamActiveCount,
        directCount,
        pairIncome,
      },
      syncUserWalletBalance: false,
    });

    await MlmCommissionEvent.create(
      [
        {
          recipientId: userId,
          recipientMembershipId: membership._id,
          sourceUserId: null,
          bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
          planType: MLM_PLAN_TYPE.A,
          baseAmount: pairIncome,
          bonusAmount: pairIncome,
          cappedAmount: pairIncome,
          rolloverAmount: 0,
          walletBucket: "earnings",
          ledgerEntryId: creditResult?.ledgerEntry?._id || null,
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          idempotencyKey,
          correlationId,
          description: `Binary pair #${p} team match (earnings recalc)`,
          meta: {
            migrationId: MIGRATION_ID,
            pairIndex: p,
            ...snapshot,
            directCount,
            pairIncome,
          },
        },
      ],
      { session },
    );

    creditedPairs += 1;
    creditedAmount = roundCurrency(creditedAmount + pairIncome);
  }

  await MlmMembership.updateOne(
    { _id: membership._id },
    {
      $set: {
        pairsCompleted: pairsToPay,
        lastPaidPairIndex: pairsToPay,
        leftLegTeamActiveCount: snapshot.leftLegTeamActiveCount,
        rightLegTeamActiveCount: snapshot.rightLegTeamActiveCount,
        binaryPairsEligible: snapshot.binaryPairsEligible,
        binaryLeftBalance: snapshot.binaryLeftBalance,
        binaryRightBalance: snapshot.binaryRightBalance,
        binaryPairSnapshotAt: new Date(),
        lifetimePlanAEarnings: creditedAmount,
        binaryDailyPairTracker: { date: null, pairsPaid: 0 },
        heldPairBonusForSponsor: 0,
        "meta.earningsRecalcMigrationId": MIGRATION_ID,
        "meta.earningsRecalcAt": new Date(),
      },
    },
    { session },
  );

  totals.processed += 1;
  totals.zeroedEarnings += debitedEarnings;
  totals.zeroedPending += debitedPending;
  totals.voidedEvents += voidedEvents;
  totals.creditedPairs += creditedPairs;
  totals.creditedAmount += creditedAmount;

  if (VERBOSE) {
    log(
      `DONE ${String(userId)} zeroed E=₹${debitedEarnings} P=₹${debitedPending} voided=${voidedEvents} credited ${creditedPairs}×₹${pairIncome}=₹${creditedAmount}`,
    );
  }
}

async function main() {
  await connectDB();
  log(APPLY ? "APPLY mode (writes enabled)" : "DRY-RUN (no writes)");

  const cfg = await getMlmConfig();
  const totals = {
    scanned: 0,
    processed: 0,
    wouldProcess: 0,
    skippedInactive: 0,
    skippedPendingWithdrawal: 0,
    alreadyDone: 0,
    errors: 0,
    zeroedEarnings: 0,
    zeroedPending: 0,
    wouldZeroEarnings: 0,
    wouldZeroPending: 0,
    voidedEvents: 0,
    creditedPairs: 0,
    creditedAmount: 0,
    wouldCreditPairs: 0,
    wouldCreditAmount: 0,
  };

  const cursor = MlmMembership.find(
    {},
    {
      userId: 1,
      status: 1,
      binaryTopupMember: 1,
      binaryLeftChildId: 1,
      binaryRightChildId: 1,
      meta: 1,
    },
  ).cursor();

  for await (const membership of cursor) {
    totals.scanned += 1;
    try {
      if (APPLY) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await recalcOne(membership, cfg, totals, session);
          });
        } finally {
          session.endSession();
        }
      } else {
        await recalcOne(membership, cfg, totals, null);
      }
    } catch (err) {
      totals.errors += 1;
      log(`ERROR ${String(membership.userId)}: ${err.message}`);
    }
  }

  log("Summary:", JSON.stringify(totals, null, 2));
  await mongoose.connection.close();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  log("Fatal:", err.message);
  process.exit(1);
});
