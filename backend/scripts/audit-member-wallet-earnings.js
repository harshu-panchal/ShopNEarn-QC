/**
 * Full wallet + earnings reconciliation for one member.
 *   node scripts/audit-member-wallet-earnings.js SEUHTFTX5K
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
  MLM_WITHDRAWAL_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import { OWNER_TYPE, LEDGER_DIRECTION } from "../app/constants/finance.js";
import { getBinaryPairIncomePreview } from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { normalizeEarningsBonusType } from "../app/services/mlm/mlmSignupBonusService.js";
import { countPaidBinaryPairEvents } from "../app/services/mlm/mlmBinaryPairIncomeService.js";

dotenv.config();

const code = process.argv[2] || "SEUHTFTX5K";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function issue(list, severity, msg, detail = null) {
  list.push({ severity, msg, detail });
}

await connectDB();

const membership = await MlmMembership.findOne({ referralCode: code }).lean();
if (!membership) {
  console.error("Not found:", code);
  process.exit(1);
}

const userId = membership.userId;
const userOid = new mongoose.Types.ObjectId(userId);
const issues = [];

const [wallet, pairPreview, pairEventsPaid] = await Promise.all([
  Wallet.findOne({ ownerType: OWNER_TYPE.CUSTOMER, ownerId: userId }).lean(),
  getBinaryPairIncomePreview(membership),
  countPaidBinaryPairEvents(userId),
]);

// ── Ledger vs wallet ───────────────────────────────────────────────
const ledgerRows = await LedgerEntry.aggregate([
  { $match: { ownerType: OWNER_TYPE.CUSTOMER, ownerId: userOid } },
  {
    $group: {
      _id: "$bucket",
      net: {
        $sum: {
          $cond: [
            { $eq: ["$direction", LEDGER_DIRECTION.CREDIT] },
            "$amount",
            { $multiply: ["$amount", -1] },
          ],
        },
      },
    },
  },
]);

const ledgerByBucket = Object.fromEntries(
  ledgerRows.map((r) => [r._id, round2(r.net)]),
);

const walletEarn = round2(wallet?.earningsBalance);
const walletPending = round2(wallet?.pendingBalance);
const walletShopping = round2(wallet?.shoppingBalance);
const ledgerEarn = round2(ledgerByBucket.earnings);
const ledgerPending = round2(ledgerByBucket.pending);
const ledgerShopping = round2(ledgerByBucket.shopping);

if (Math.abs(walletEarn - ledgerEarn) > 0.01) {
  issue(issues, "ERROR", "Earnings wallet ≠ ledger", {
    wallet: walletEarn,
    ledger: ledgerEarn,
    gap: round2(walletEarn - ledgerEarn),
  });
}
if (Math.abs(walletPending - ledgerPending) > 0.01) {
  issue(issues, "ERROR", "Pending wallet ≠ ledger", {
    wallet: walletPending,
    ledger: ledgerPending,
    gap: round2(walletPending - ledgerPending),
  });
}
if (Math.abs(walletShopping - ledgerShopping) > 0.01) {
  issue(issues, "ERROR", "Shopping wallet ≠ ledger", {
    wallet: walletShopping,
    ledger: ledgerShopping,
    gap: round2(walletShopping - ledgerShopping),
  });
}

// ── Commission events vs lifetime counters ─────────────────────────
const creditedEvents = await MlmCommissionEvent.find({
  recipientId: userId,
  status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
}).lean();

let eventEarnPending = 0;
let eventShopping = 0;
let eventPlanA = 0;
let eventPlanB = 0;
const byType = new Map();

for (const e of creditedEvents) {
  const amt = round2(e.cappedAmount || e.bonusAmount || 0);
  const displayType = normalizeEarningsBonusType(e.bonusType, e.idempotencyKey);
  const prev = byType.get(displayType) || { total: 0, count: 0 };
  byType.set(displayType, { total: prev.total + amt, count: prev.count + 1 });

  if (["earnings", "pending"].includes(e.walletBucket)) {
    eventEarnPending += amt;
    if (e.planType === MLM_PLAN_TYPE.B) eventPlanB += amt;
    else eventPlanA += amt;
  } else if (e.walletBucket === "shopping") {
    eventShopping += amt;
  }
}

eventEarnPending = round2(eventEarnPending);
eventPlanA = round2(eventPlanA);
eventPlanB = round2(eventPlanB);
eventShopping = round2(eventShopping);

const storedLifetimeA = round2(membership.lifetimePlanAEarnings);
const storedLifetimeB = round2(membership.lifetimePlanBEarnings);
const storedLifetime = round2(storedLifetimeA + storedLifetimeB);

if (storedLifetimeA !== eventPlanA) {
  issue(issues, "WARN", "lifetimePlanAEarnings ≠ credited events sum", {
    stored: storedLifetimeA,
    fromEvents: eventPlanA,
    gap: round2(storedLifetimeA - eventPlanA),
  });
}
if (storedLifetimeB !== eventPlanB) {
  issue(issues, "WARN", "lifetimePlanBEarnings ≠ credited events sum", {
    stored: storedLifetimeB,
    fromEvents: eventPlanB,
    gap: round2(storedLifetimeB - eventPlanB),
  });
}

// ── Wallet earnings vs lifetime − withdrawals ──────────────────────
const withdrawals = await MlmWithdrawalRequest.find({ userId }).lean();
const completedWithdrawGross = round2(
  withdrawals
    .filter((w) => w.status === MLM_WITHDRAWAL_STATUS.COMPLETED)
    .reduce((s, w) => s + (w.amount || 0), 0),
);
const pendingWithdrawGross = round2(
  withdrawals
    .filter((w) =>
      [MLM_WITHDRAWAL_STATUS.PENDING, MLM_WITHDRAWAL_STATUS.APPROVED].includes(
        w.status,
      ),
    )
    .reduce((s, w) => s + (w.amount || 0), 0),
);

const expectedEarningsWallet = round2(
  eventEarnPending - completedWithdrawGross - pendingWithdrawGross,
);
if (Math.abs(walletEarn - expectedEarningsWallet) > 0.01) {
  issue(issues, "WARN", "Earnings wallet ≠ (credited earnings − withdrawals)", {
    wallet: walletEarn,
    creditedEarningsPending: eventEarnPending,
    completedWithdrawals: completedWithdrawGross,
    pendingWithdrawals: pendingWithdrawGross,
    expectedWallet: expectedEarningsWallet,
    gap: round2(walletEarn - expectedEarningsWallet),
  });
}

// ── Pairs completed vs events ──────────────────────────────────────
const pairsStored = Number(membership.pairsCompleted) || 0;
if (pairsStored !== pairEventsPaid) {
  issue(issues, "WARN", "pairsCompleted ≠ credited pair events", {
    stored: pairsStored,
    pairEvents: pairEventsPaid,
  });
}
if (pairsStored > pairPreview.binaryPairsEligible) {
  issue(issues, "WARN", "pairsCompleted > team-eligible pairs", {
    pairsCompleted: pairsStored,
    eligible: pairPreview.binaryPairsEligible,
  });
}

// ── Direct referrals vs per-activation credits ─────────────────────
const directs = await MlmMembership.find({
  sponsorId: userId,
  status: MLM_MEMBERSHIP_STATUS.ACTIVE,
}).lean();

const perActivationCount = creditedEvents.filter(
  (e) =>
    normalizeEarningsBonusType(e.bonusType, e.idempotencyKey) ===
      MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION &&
    ["earnings", "pending"].includes(e.walletBucket),
).length;

if (directs.length !== perActivationCount) {
  issue(issues, "WARN", "Active directs ≠ per-activation income events", {
    activeDirects: directs.length,
    perActivationEvents: perActivationCount,
  });
}

// ── Network counts (live vs dashboard API logic) ───────────────────
const [activeDownline, unpaidDownline, totalDownlineLive, directActive] =
  await Promise.all([
    MlmMembership.countDocuments({
      sponsorChain: userOid,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    }),
    MlmMembership.countDocuments({
      sponsorChain: userOid,
      status: MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
    }),
    MlmMembership.countDocuments({ sponsorChain: userOid }),
    MlmMembership.countDocuments({
      sponsorId: userId,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    }),
  ]);

const monthStart = new Date();
monthStart.setUTCDate(1);
monthStart.setUTCHours(0, 0, 0, 0);
const thisMonthEarn = round2(
  creditedEvents
    .filter(
      (e) =>
        ["earnings", "pending"].includes(e.walletBucket) &&
        e.createdAt >= monthStart,
    )
    .reduce((s, e) => s + (e.cappedAmount || 0), 0),
);

const clawedBack = await MlmCommissionEvent.countDocuments({
  recipientId: userId,
  status: MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
  bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
});

const report = {
  referralCode: code,
  scannedAt: new Date().toISOString(),
  issuesFound: issues.length,
  issues,
  snapshot: {
    wallets: {
      earnings: walletEarn,
      pending: walletPending,
      shopping: walletShopping,
    },
    ledger: {
      earnings: ledgerEarn,
      pending: ledgerPending,
      shopping: ledgerShopping,
    },
    lifetime: {
      storedTotal: storedLifetime,
      storedPlanA: storedLifetimeA,
      storedPlanB: storedLifetimeB,
      fromCreditedEvents: eventEarnPending,
    },
    withdrawals: {
      pendingGross: pendingWithdrawGross,
      pendingCount: withdrawals.filter((w) =>
        [MLM_WITHDRAWAL_STATUS.PENDING, MLM_WITHDRAWAL_STATUS.APPROVED].includes(
          w.status,
        ),
      ).length,
      completedGross: completedWithdrawGross,
    },
    thisMonthEarningsOnly: thisMonthEarn,
    shoppingCredited: eventShopping,
    pairs: {
      pairsCompleted: pairsStored,
      pairEventsCredited: pairEventsPaid,
      eligible: pairPreview.binaryPairsEligible,
      nextBonus: pairPreview.nextPairBonusAmount,
      teamLeft: pairPreview.leftLegTeamActiveCount,
      teamRight: pairPreview.rightLegTeamActiveCount,
    },
    referrals: {
      directActive,
      activeInNetwork: activeDownline,
      pendingInNetwork: unpaidDownline,
      networkSizeLive: totalDownlineLive,
    },
    earningsByType: Object.fromEntries(
      [...byType.entries()].map(([k, v]) => [k, v]),
    ),
    clawedBackPairEvents: clawedBack,
  },
  uiExpected: {
    earningsWallet: 3500,
    shoppingWallet: 5450,
    totalEarnings: 4500,
    thisMonth: 4500,
    pendingPayout: 1000,
    directReferrals: 7,
    activeCustomers: 78,
    networkSize: 325,
    pendingNetwork: 247,
    pairsCompleted: 12,
    leftTeam: 55,
    rightTeam: 12,
  },
};

console.log(JSON.stringify(report, null, 2));
await mongoose.connection.close();
process.exit(issues.filter((i) => i.severity === "ERROR").length > 0 ? 1 : 0);
