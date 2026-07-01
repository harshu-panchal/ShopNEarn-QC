/**
 * regenerate-mlm-earnings-all-members.js
 *
 * Rebuild MLM earnings + wallet history for every member from current tree/rules.
 * By default wallet balances are NOT changed — only ledger rows and commission
 * events are purged and recreated (history-only mode).
 *
 *   1. Delete earnings/pending wallet ledger rows + commission events
 *   2. Regenerate clean history (per-activation, first pair, binary pairs)
 *   3. Wallet earnings/pending balances stay unchanged
 *
 * Pass `--reset-balances` to also zero wallets, re-credit balances, and apply
 * paid-withdrawal offsets (destructive; not recommended for production cleanup).
 *
 * Shopping wallet, signup bonuses, and withdrawal ledger rows are NOT touched.
 *
 * Usage:
 *   node scripts/regenerate-mlm-earnings-all-members.js
 *   node scripts/regenerate-mlm-earnings-all-members.js --apply
 *   node scripts/regenerate-mlm-earnings-all-members.js --apply --verbose
 *   node scripts/regenerate-mlm-earnings-all-members.js --apply --reset-balances
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
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
  MLM_WITHDRAWAL_STATUS,
} from "../app/constants/mlm.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import {
  computeBinaryTeamPairSnapshot,
  countActivePlanADirects,
  resolvePairIncomeConfig,
  resolveFirstDirectPairIncomeAmount,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { getActiveDirectReferralLegPairCounts } from "../app/services/mlm/mlmSignupBonusService.js";
import {
  getDirectReferralActivationConfig,
  getMlmConfig,
  resolvePlanABonusWalletBucket,
} from "../app/services/mlm/mlmConfigService.js";
import { creditBonusToEarningsWallet } from "../app/services/mlm/mlmBonusEngineService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";
import {
  debitWallet,
  getOrCreateWallet,
} from "../app/services/finance/walletService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const RESET_BALANCES = process.argv.includes("--reset-balances");
const HISTORY_ONLY = !RESET_BALANCES;
const MIGRATION_ID = "MLM-EARN-REGEN-V4-2026";
const TOLERANCE = 1;

const EARNINGS_LEDGER_TYPES = [
  LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH,
  LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_ACTIVATION,
  LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_PER_ACTIVATION,
  LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_MILESTONE,
  LEDGER_TRANSACTION_TYPE.MLM_REPURCHASE_BONUS,
  LEDGER_TRANSACTION_TYPE.MLM_MENTOR_ROYALTY,
  LEDGER_TRANSACTION_TYPE.MLM_BONUS_CLAWBACK_ON_RETURN,
  LEDGER_TRANSACTION_TYPE.MLM_BONUS_CAPPED_ROLLOVER,
  LEDGER_TRANSACTION_TYPE.MLM_BONUS_RELEASED,
  LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH_HELD_PENDING,
  LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH_RELEASED_ON_DOWNLINE_ACTIVATION,
];

const MIGRATION_MANUAL_ADJUSTMENT_CLAUSES = [
  { "metadata.bucket": { $in: ["earnings", "pending"] } },
  { "metadata.migrationId": { $exists: true } },
  { idempotencyKey: { $regex: /^MLM-EARN-/ } },
  { idempotencyKey: { $regex: /^MLM-DRA-/ } },
  { idempotencyKey: { $regex: /^MLM-FIRST-PAIR/ } },
  { idempotencyKey: { $regex: /^MLM-PER-ACTIVATION/ } },
  { idempotencyKey: { $regex: /^MLM-EARNINGS-WALLET-ALIGN/ } },
  { idempotencyKey: { $regex: /^MLM-WALLET-FIX/ } },
  { idempotencyKey: { $regex: /-BPM-/ } },
  { idempotencyKey: { $regex: /-DRPA-/ } },
  { idempotencyKey: { $regex: /-WITHDRAW-OFFSET-/ } },
  {
    description: {
      $regex: /Rollback duplicate direct referral|Align earnings wallet|Earnings regeneration:/i,
    },
  },
];

function earningsLedgerPurgeFilter(userId) {
  return {
    actorType: OWNER_TYPE.CUSTOMER,
    actorId: userId,
    $or: [
      { type: { $in: EARNINGS_LEDGER_TYPES } },
      {
        type: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
        $or: MIGRATION_MANUAL_ADJUSTMENT_CLAUSES,
      },
    ],
  };
}

function log(...args) {
  console.log("[regenerate-mlm-earnings]", ...args);
}

async function countPurgeTargets(userId) {
  const [ledgerRows, commissionRows] = await Promise.all([
    LedgerEntry.countDocuments(earningsLedgerPurgeFilter(userId)),
    MlmCommissionEvent.countDocuments({
      recipientId: userId,
      walletBucket: { $in: ["earnings", "pending"] },
    }),
  ]);
  return { ledgerRows, commissionRows };
}

async function purgeEarningsLedgerHistory(userId, session) {
  const result = await LedgerEntry.deleteMany(
    earningsLedgerPurgeFilter(userId),
    { session },
  );
  return result.deletedCount || 0;
}

async function purgeEarningsCommissionEvents(userId, session) {
  const result = await MlmCommissionEvent.deleteMany(
    {
      recipientId: userId,
      walletBucket: { $in: ["earnings", "pending"] },
    },
    { session },
  );
  return result.deletedCount || 0;
}

async function resetWalletEarningsBuckets(userId, session) {
  const wallet = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
  }).session(session);
  if (!wallet) return { earnings: 0, pending: 0 };

  const earnings = roundCurrency(wallet.earningsBalance || 0);
  const pending = roundCurrency(wallet.pendingBalance || 0);
  if (earnings > 0 || pending > 0) {
    wallet.earningsBalance = 0;
    wallet.pendingBalance = 0;
    await wallet.save({ session });
  }
  return { earnings, pending };
}

function pairKey(userId, pairIndex) {
  return `${MIGRATION_ID}-BPM-${String(userId)}-P${pairIndex}`;
}

function perActivationKey(sponsorUserId, activatedUserId) {
  return `${MIGRATION_ID}-DRPA-${String(sponsorUserId)}-${String(activatedUserId)}`;
}

function firstDirectPairKey(userId) {
  return `${MIGRATION_ID}-DRA-FIRST-${String(userId)}`;
}

async function estimatePairCredits({
  membership,
  cfg,
  draCfg,
  session,
}) {
  const userId = membership.userId;
  const snapshot = await computeBinaryTeamPairSnapshot(membership, { session });
  const pairsToPay = snapshot.binaryPairsEligible || 0;
  const directCount = await countActivePlanADirects(userId, { session });
  const isTopup = Boolean(membership.binaryTopupMember);
  const { pairIncome } = resolvePairIncomeConfig(cfg, directCount, isTopup);

  const legPairs = await getActiveDirectReferralLegPairCounts(membership, { session });
  const firstDirectEligible =
    draCfg.firstPair.enabled
    && legPairs.pairs >= 1;
  const firstPairAmount = firstDirectEligible
    ? roundCurrency(
      resolveFirstDirectPairIncomeAmount(
        cfg,
        directCount,
        isTopup,
        draCfg.firstPair.amount,
      ),
    )
    : 0;

  const teamPairCount = firstDirectEligible
    ? Math.max(pairsToPay - 1, 0)
    : pairsToPay;
  const pairTotal = roundCurrency(teamPairCount * pairIncome + firstPairAmount);

  return {
    snapshot,
    pairsToPay,
    directCount,
    pairIncome,
    firstDirectEligible,
    firstPairAmount,
    teamPairCount,
    pairTotal,
  };
}

async function regenerateFirstDirectPairCredit({
  membership,
  cfg,
  draCfg,
  session,
  correlationId,
  totals,
  regenOptions,
}) {
  if (!draCfg.firstPair.enabled) {
    return { credited: 0, creditedFirstDirect: false };
  }

  const userId = membership.userId;
  const legPairs = await getActiveDirectReferralLegPairCounts(membership, { session });
  if (legPairs.pairs < 1) {
    return { credited: 0, creditedFirstDirect: false };
  }

  const directCount = await countActivePlanADirects(userId, { session });
  const amount = roundCurrency(
    resolveFirstDirectPairIncomeAmount(
      cfg,
      directCount,
      Boolean(membership.binaryTopupMember),
      draCfg.firstPair.amount,
    ),
  );
  if (amount <= 0) {
    return { credited: 0, creditedFirstDirect: false };
  }

  const idempotencyKey = firstDirectPairKey(userId);
  const event = await creditBonusToEarningsWallet({
    recipientUserId: userId,
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    planType: MLM_PLAN_TYPE.A,
    bonusAmount: amount,
    sourceUserId: null,
    bucket: "earnings",
    description: "Direct referral first-pair activation income",
    meta: {
      incomeType: "FIRST_DIRECT_PAIR",
      pairIndex: 1,
      leftDirectCount: legPairs.left,
      rightDirectCount: legPairs.right,
      directCount,
      pairIncome: amount,
      regenMigrationId: MIGRATION_ID,
    },
    idempotencyKey,
    correlationId,
    session,
    skipDailyCap: true,
    ...regenOptions,
  });
  const paid = roundCurrency(event?.cappedAmount || amount);
  totals.firstPairEvents += 1;
  return { credited: paid, creditedFirstDirect: true };
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

async function sumPaidWithdrawals(userId, session) {
  const rows = await MlmWithdrawalRequest.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(String(userId)),
        status: MLM_WITHDRAWAL_STATUS.PAID,
      },
    },
    { $group: { _id: null, gross: { $sum: "$amount" } } },
  ]).session(session || null);
  return roundCurrency(rows[0]?.gross || 0);
}

async function regeneratePerActivationCredits({
  sponsorMembership,
  draCfg,
  session,
  correlationId,
  totals,
  regenOptions,
}) {
  if (!draCfg.enabled || !draCfg.perActivation.enabled || draCfg.perActivation.amount <= 0) {
    return 0;
  }
  if (
    sponsorMembership.status === MLM_MEMBERSHIP_STATUS.SUSPENDED
    || sponsorMembership.status === MLM_MEMBERSHIP_STATUS.TERMINATED
  ) {
    return 0;
  }

  const directs = await MlmMembership.find({
    sponsorId: sponsorMembership.userId,
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
  })
    .sort({ planAJoinedAt: 1, createdAt: 1 })
    .session(session)
    .lean();

  let credited = 0;
  const amount = roundCurrency(draCfg.perActivation.amount);

  for (const direct of directs) {
    const idempotencyKey = perActivationKey(sponsorMembership.userId, direct.userId);
    const event = await creditBonusToEarningsWallet({
      recipientUserId: sponsorMembership.userId,
      bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
      planType: MLM_PLAN_TYPE.A,
      bonusAmount: amount,
      sourceUserId: direct.userId,
      bucket: "earnings",
      description: "Direct referral Plan A activation income",
      meta: {
        incomeType: "PER_ACTIVATION",
        activatedUserId: String(direct.userId),
        sponsorUserId: String(sponsorMembership.userId),
        regenMigrationId: MIGRATION_ID,
      },
      idempotencyKey,
      correlationId,
      session,
      skipDailyCap: true,
      ...regenOptions,
    });
    const paid = roundCurrency(event?.cappedAmount || amount);
    credited = roundCurrency(credited + paid);
    totals.perActivationEvents += 1;
  }

  return credited;
}

async function regenerateBinaryPairCredits({
  membership,
  cfg,
  session,
  correlationId,
  totals,
  skipPairIndexOne = false,
  regenOptions,
}) {
  const userId = membership.userId;
  const snapshot = await computeBinaryTeamPairSnapshot(membership, { session });
  const directCount = await countActivePlanADirects(userId, { session });
  const isTopup = Boolean(membership.binaryTopupMember);
  const { pairIncome } = resolvePairIncomeConfig(cfg, directCount, isTopup);
  const pairsToPay = snapshot.binaryPairsEligible || 0;

  if (pairIncome <= 0 || pairsToPay <= 0) {
    return { credited: 0, pairsToPay: 0, snapshot, pairIncome, teamPairsPaid: 0 };
  }

  const bonusBucket = await resolvePlanABonusWalletBucket();
  let credited = 0;
  let teamPairsPaid = 0;
  const startIndex = skipPairIndexOne ? 2 : 1;

  for (let p = startIndex; p <= pairsToPay; p += 1) {
    const idempotencyKey = pairKey(userId, p);
    const event = await creditBonusToEarningsWallet({
      recipientUserId: userId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      planType: MLM_PLAN_TYPE.A,
      bonusAmount: pairIncome,
      sourceUserId: null,
      bucket: bonusBucket,
      description: `Binary pair #${p} team match`,
      meta: {
        pairIndex: p,
        matchingMode: "team",
        regenMigrationId: MIGRATION_ID,
        directCount,
        pairIncome,
        ...snapshot,
      },
      idempotencyKey,
      correlationId,
      session,
      skipDailyCap: true,
      ...regenOptions,
    });
    const paid = roundCurrency(event?.cappedAmount || pairIncome);
    credited = roundCurrency(credited + paid);
    teamPairsPaid += 1;
    totals.pairEvents += 1;
  }

  return { credited, pairsToPay, snapshot, pairIncome, teamPairsPaid };
}

async function applyPaidWithdrawalOffset({
  userId,
  creditedTotal,
  session,
  correlationId,
}) {
  const paidWithdrawn = await sumPaidWithdrawals(userId, session);
  if (paidWithdrawn <= 0) {
    return { paidWithdrawn, debited: 0, expectedWallet: creditedTotal };
  }

  const expectedWallet = roundCurrency(Math.max(creditedTotal - paidWithdrawn, 0));
  const wallet = await getOrCreateWallet(OWNER_TYPE.CUSTOMER, userId, { session });
  const current = roundCurrency(wallet.earningsBalance || 0);
  const excess = roundCurrency(current - expectedWallet);

  if (excess <= TOLERANCE) {
    return { paidWithdrawn, debited: 0, expectedWallet };
  }

  const idempotencyKey = `${MIGRATION_ID}-WITHDRAW-OFFSET-${String(userId)}`;
  if (await ledgerExists(idempotencyKey, session)) {
    return { paidWithdrawn, debited: 0, expectedWallet };
  }

  await debitWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
    amount: excess,
    bucket: "earnings",
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
    ledgerReference: idempotencyKey,
    ledgerDescription: "Earnings regeneration: restore paid-withdrawal offset",
    idempotencyKey,
    correlationId,
    metadata: {
      bucket: "earnings",
      migrationId: MIGRATION_ID,
      paidWithdrawn,
      creditedTotal,
      expectedWallet,
    },
    syncUserWalletBalance: false,
  });

  return { paidWithdrawn, debited: excess, expectedWallet };
}

async function sumCreditedEarnings(userId, session) {
  const rows = await MlmCommissionEvent.aggregate([
    {
      $match: {
        recipientId: new mongoose.Types.ObjectId(String(userId)),
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        walletBucket: { $in: ["earnings", "pending"] },
      },
    },
    { $group: { _id: null, total: { $sum: "$cappedAmount" } } },
  ]).session(session);
  return roundCurrency(rows[0]?.total || 0);
}

async function regenerateMember(membership, cfg, draCfg, totals, session) {
  const userId = membership.userId;
  const code = membership.referralCode || String(userId);
  const correlationId = `${MIGRATION_ID}-${String(userId)}`;

  if (await hasPendingWithdrawal(userId, session)) {
    totals.skippedPendingWithdrawal += 1;
    if (VERBOSE) log(`SKIP ${code} — pending withdrawal`);
    return;
  }

  const purgeTargets = await countPurgeTargets(userId);
  const walletBefore = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
  }).session(session);
  const beforeEarnings = roundCurrency(walletBefore?.earningsBalance || 0);
  const beforePending = roundCurrency(walletBefore?.pendingBalance || 0);

  let snapshot = null;
  let pairsToPay = 0;
  let wouldCredit = 0;

  if (membership.status === MLM_MEMBERSHIP_STATUS.ACTIVE) {
    const estimate = await estimatePairCredits({
      membership,
      cfg,
      draCfg,
      session,
    });
    snapshot = estimate.snapshot;
    pairsToPay = estimate.pairsToPay;

    const activeDirects = await MlmMembership.countDocuments({
      sponsorId: userId,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      planType: MLM_PLAN_TYPE.A,
    }).session(session);

    const perActivationTotal =
      draCfg.perActivation.enabled
        ? roundCurrency(activeDirects * (draCfg.perActivation.amount || 0))
        : 0;
    wouldCredit = roundCurrency(perActivationTotal + estimate.pairTotal);
  }

  if (!APPLY) {
    totals.wouldProcess += 1;
    totals.wouldPurgeLedger += purgeTargets.ledgerRows;
    totals.wouldPurgeEvents += purgeTargets.commissionRows;
    if (RESET_BALANCES) {
      totals.wouldZeroEarnings += beforeEarnings;
      totals.wouldZeroPending += beforePending;
    }
    totals.wouldCredit += wouldCredit;
    if (VERBOSE) {
      log(
        `WOULD ${code} mode=${HISTORY_ONLY ? "history-only" : "reset-balances"} purgeLedger=${purgeTargets.ledgerRows} purgeEvents=${purgeTargets.commissionRows} wallet E=${beforeEarnings} P=${beforePending} → history ₹${wouldCredit} (${pairsToPay} pairs)`,
      );
    }
    return;
  }

  const purgedLedger = await purgeEarningsLedgerHistory(userId, session);
  const purgedEvents = await purgeEarningsCommissionEvents(userId, session);
  let zeroedEarnings = 0;
  let zeroedPending = 0;
  if (RESET_BALANCES) {
    const reset = await resetWalletEarningsBuckets(userId, session);
    zeroedEarnings = reset.earnings;
    zeroedPending = reset.pending;
  }

  const membershipReset = {
    pairsCompleted: 0,
    lastPaidPairIndex: 0,
    heldPairBonusForSponsor: 0,
    binaryDailyPairTracker: { date: null, pairsPaid: 0 },
    dailyCapTracker: { date: null, usedAmount: 0 },
    "meta.earningsRegenMigrationId": MIGRATION_ID,
    "meta.earningsRegenAt": new Date(),
    "meta.earningsRegenMode": HISTORY_ONLY ? "history-only" : "reset-balances",
  };
  if (RESET_BALANCES) {
    membershipReset.lifetimePlanAEarnings = 0;
  }

  await MlmMembership.updateOne(
    { _id: membership._id },
    { $set: membershipReset },
    { session },
  );

  let creditedTotal = 0;
  const localTotals = { perActivationEvents: 0, pairEvents: 0, firstPairEvents: 0 };
  const regenOptions = HISTORY_ONLY
    ? { historyOnly: true, ledgerRunningBalances: { earnings: 0, pending: 0 } }
    : {};

  if (membership.status === MLM_MEMBERSHIP_STATUS.ACTIVE) {
    const freshMembership = await MlmMembership.findById(membership._id).session(session);

    creditedTotal = roundCurrency(
      creditedTotal
      + (await regeneratePerActivationCredits({
        sponsorMembership: freshMembership,
        draCfg,
        session,
        correlationId,
        totals: localTotals,
        regenOptions,
      })),
    );

    const firstPairResult = await regenerateFirstDirectPairCredit({
      membership: freshMembership,
      cfg,
      draCfg,
      session,
      correlationId,
      totals: localTotals,
      regenOptions,
    });
    creditedTotal = roundCurrency(creditedTotal + firstPairResult.credited);

    const pairResult = await regenerateBinaryPairCredits({
      membership: freshMembership,
      cfg,
      session,
      correlationId,
      totals: localTotals,
      skipPairIndexOne: firstPairResult.creditedFirstDirect,
      regenOptions,
    });
    creditedTotal = roundCurrency(creditedTotal + pairResult.credited);
    snapshot = pairResult.snapshot;
    pairsToPay = pairResult.pairsToPay;

    const pairsCompleted = firstPairResult.creditedFirstDirect
      ? Math.max(pairsToPay, 1)
      : pairsToPay;

    await MlmMembership.updateOne(
      { _id: membership._id },
      {
        $set: {
          pairsCompleted,
          lastPaidPairIndex: pairsCompleted,
          leftLegTeamActiveCount: snapshot.leftLegTeamActiveCount,
          rightLegTeamActiveCount: snapshot.rightLegTeamActiveCount,
          binaryPairsEligible: snapshot.binaryPairsEligible,
          binaryLeftBalance: snapshot.binaryLeftBalance,
          binaryRightBalance: snapshot.binaryRightBalance,
          binaryPairSnapshotAt: new Date(),
        },
      },
      { session },
    );
  }

  let withdrawAdjust = {
    paidWithdrawn: 0,
    debited: 0,
    expectedWallet: creditedTotal,
  };
  if (RESET_BALANCES) {
    withdrawAdjust = await applyPaidWithdrawalOffset({
      userId,
      creditedTotal,
      session,
      correlationId,
    });
  } else {
    const paidWithdrawn = await sumPaidWithdrawals(userId, session);
    withdrawAdjust = {
      paidWithdrawn,
      debited: 0,
      expectedWallet: roundCurrency(Math.max(creditedTotal - paidWithdrawn, 0)),
    };
    const walletAfter = await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
    }).session(session);
    const afterEarnings = roundCurrency(walletAfter?.earningsBalance || 0);
    const afterPending = roundCurrency(walletAfter?.pendingBalance || 0);
    if (
      Math.abs(afterEarnings - beforeEarnings) > TOLERANCE
      || Math.abs(afterPending - beforePending) > TOLERANCE
    ) {
      throw new Error(
        `Wallet balance changed in history-only mode (before E=${beforeEarnings} P=${beforePending}, after E=${afterEarnings} P=${afterPending})`,
      );
    }
    const historyDrift = roundCurrency(
      afterEarnings + afterPending - withdrawAdjust.expectedWallet,
    );
    if (Math.abs(historyDrift) > TOLERANCE) {
      totals.historyDrift += 1;
      if (VERBOSE) {
        log(
          `WARN ${code} history gross=₹${creditedTotal} paidWithdrawn=₹${paidWithdrawn} expectedWallet=₹${withdrawAdjust.expectedWallet} actualWallet=₹${afterEarnings + afterPending}`,
        );
      }
    }
  }

  if (withdrawAdjust.paidWithdrawn > creditedTotal + TOLERANCE) {
    totals.overWithdrawn += 1;
    if (VERBOSE) {
      log(
        `WARN ${code} over-withdrawn paid=₹${withdrawAdjust.paidWithdrawn} credited=₹${creditedTotal}`,
      );
    }
  }

  const lifetimeFromEvents = await sumCreditedEarnings(userId, session);
  await MlmMembership.updateOne(
    { _id: membership._id },
    { $set: { lifetimePlanAEarnings: lifetimeFromEvents } },
    { session },
  );
  await syncCustomerMlmProjection(userId, { session });

  totals.processed += 1;
  totals.purgedLedger += purgedLedger;
  totals.purgedEvents += purgedEvents;
  totals.zeroedEarnings += zeroedEarnings;
  totals.zeroedPending += zeroedPending;
  totals.creditedAmount += creditedTotal;
  totals.perActivationEvents += localTotals.perActivationEvents;
  totals.pairEvents += localTotals.pairEvents;
  totals.firstPairEvents += localTotals.firstPairEvents;

  if (VERBOSE) {
    log(
      `DONE ${code} mode=${HISTORY_ONLY ? "history-only" : "reset-balances"} purgedLedger=${purgedLedger} purgedEvents=${purgedEvents} history=₹${creditedTotal} wallet E=${beforeEarnings} P=${beforePending}`,
    );
  }
}

async function main() {
  await connectDB();
  log(
    APPLY ? "APPLY mode (writes enabled)" : "DRY-RUN (no writes)",
    HISTORY_ONLY ? "| history-only (wallet balances preserved)" : "| reset-balances",
  );

  const cfg = await getMlmConfig();
  const draCfg = await getDirectReferralActivationConfig();

  const totals = {
    scanned: 0,
    processed: 0,
    wouldProcess: 0,
    skippedPendingWithdrawal: 0,
    overWithdrawn: 0,
    historyDrift: 0,
    errors: 0,
    purgedLedger: 0,
    purgedEvents: 0,
    wouldPurgeLedger: 0,
    wouldPurgeEvents: 0,
    zeroedEarnings: 0,
    zeroedPending: 0,
    wouldZeroEarnings: 0,
    wouldZeroPending: 0,
    creditedAmount: 0,
    wouldCredit: 0,
    perActivationEvents: 0,
    pairEvents: 0,
    firstPairEvents: 0,
  };

  const memberships = await MlmMembership.find({}).lean();
  for (const membership of memberships) {
    totals.scanned += 1;
    try {
      if (APPLY) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await regenerateMember(membership, cfg, draCfg, totals, session);
          });
        } finally {
          session.endSession();
        }
      } else {
        await regenerateMember(membership, cfg, draCfg, totals, null);
      }
    } catch (err) {
      totals.errors += 1;
      log(`ERROR ${membership.referralCode || membership.userId}: ${err.message}`);
    }
  }

  log("Summary:", JSON.stringify(totals, null, 2));
  await mongoose.connection.close();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  log("FATAL:", err.message);
  process.exit(1);
});
