/**
 * System-wide MLM wallet + earnings reconciliation.
 *
 *   node scripts/audit-all-members-wallet-earnings.js
 *   node scripts/audit-all-members-wallet-earnings.js --verbose
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
import {
  OWNER_TYPE,
  LEDGER_DIRECTION,
  LEDGER_TRANSACTION_TYPE,
} from "../app/constants/finance.js";
import { LEGACY_PER_ACTIVATION_DRA_KEY_RE } from "../app/services/mlm/mlmSignupBonusService.js";

dotenv.config();

const VERBOSE = process.argv.includes("--verbose");
const TOLERANCE = 1; // ₹1
const TOP_N = 25;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function row(code, userId, issue, detail) {
  return { referralCode: code, userId: String(userId), issue, ...detail };
}

async function main() {
  await connectDB();

  const members = await MlmMembership.find(
    {},
    {
      userId: 1,
      referralCode: 1,
      lifetimePlanAEarnings: 1,
      lifetimePlanBEarnings: 1,
      pairsCompleted: 1,
      status: 1,
    },
  ).lean();

  const codeByUser = new Map(
    members.map((m) => [String(m.userId), m.referralCode || String(m.userId)]),
  );

  const [
    eventEarnRows,
    eventPlanARows,
    eventPlanBRows,
    eventShopRows,
    pairEventRows,
    perActivationRows,
    legacyDrpaRows,
    withdrawRows,
    wallets,
    joiningCredits,
    shoppingDebits,
    activeDirectRows,
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
    MlmCommissionEvent.aggregate([
      {
        $match: {
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          walletBucket: { $in: ["earnings", "pending"] },
          planType: MLM_PLAN_TYPE.A,
        },
      },
      { $group: { _id: "$recipientId", total: { $sum: "$cappedAmount" } } },
    ]),
    MlmCommissionEvent.aggregate([
      {
        $match: {
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          walletBucket: { $in: ["earnings", "pending"] },
          planType: MLM_PLAN_TYPE.B,
        },
      },
      { $group: { _id: "$recipientId", total: { $sum: "$cappedAmount" } } },
    ]),
    MlmCommissionEvent.aggregate([
      {
        $match: {
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          walletBucket: "shopping",
        },
      },
      { $group: { _id: "$recipientId", total: { $sum: "$cappedAmount" } } },
    ]),
    MlmCommissionEvent.aggregate([
      {
        $match: {
          bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        },
      },
      { $group: { _id: "$recipientId", count: { $sum: 1 } } },
    ]),
    MlmCommissionEvent.aggregate([
      {
        $match: {
          bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          walletBucket: { $in: ["earnings", "pending"] },
        },
      },
      { $group: { _id: "$recipientId", count: { $sum: 1 } } },
    ]),
    MlmCommissionEvent.aggregate([
      {
        $match: {
          bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          walletBucket: { $in: ["earnings", "pending"] },
          idempotencyKey: { $regex: LEGACY_PER_ACTIVATION_DRA_KEY_RE.source },
        },
      },
      { $group: { _id: "$recipientId", count: { $sum: 1 } } },
    ]),
    MlmWithdrawalRequest.aggregate([
      {
        $match: {
          status: {
            $in: [
              MLM_WITHDRAWAL_STATUS.PENDING,
              MLM_WITHDRAWAL_STATUS.APPROVED,
              MLM_WITHDRAWAL_STATUS.PAID,
            ],
          },
        },
      },
      { $group: { _id: "$userId", gross: { $sum: "$amount" } } },
    ]),
    Wallet.find({ ownerType: OWNER_TYPE.CUSTOMER }).lean(),
    LedgerEntry.aggregate([
      {
        $match: {
          actorType: OWNER_TYPE.CUSTOMER,
          type: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
          direction: LEDGER_DIRECTION.CREDIT,
        },
      },
      { $group: { _id: "$actorId", total: { $sum: "$amount" } } },
    ]),
    LedgerEntry.aggregate([
      {
        $match: {
          actorType: OWNER_TYPE.CUSTOMER,
          direction: LEDGER_DIRECTION.DEBIT,
          "metadata.bucketDrained": "shopping",
        },
      },
      { $group: { _id: "$actorId", total: { $sum: "$amount" } } },
    ]),
    MlmMembership.aggregate([
      {
        $match: {
          sponsorId: { $ne: null },
          status: MLM_MEMBERSHIP_STATUS.ACTIVE,
        },
      },
      { $group: { _id: "$sponsorId", count: { $sum: 1 } } },
    ]),
  ]);

  const mapNum = (rows, field = "total") =>
    new Map(rows.map((r) => [String(r._id), round2(r[field] || 0)]));
  const mapCount = (rows) =>
    new Map(rows.map((r) => [String(r._id), Number(r.count) || 0]));

  const earnByUser = mapNum(eventEarnRows);
  const planAByUser = mapNum(eventPlanARows);
  const planBByUser = mapNum(eventPlanBRows);
  const shopEventsByUser = mapNum(eventShopRows);
  const pairEventsByUser = mapCount(pairEventRows);
  const perActivationByUser = mapCount(perActivationRows);
  const legacyDrpaByUser = mapCount(legacyDrpaRows);
  const withdrawByUser = mapNum(withdrawRows, "gross");
  const joiningByUser = mapNum(joiningCredits);
  const shopSpendByUser = mapNum(shoppingDebits);
  const activeDirectsBySponsor = mapCount(activeDirectRows);

  const walletByUser = new Map(
    wallets.map((w) => [
      String(w.ownerId),
      {
        earnings: round2(w.earningsBalance),
        shopping: round2(w.shoppingBalance),
        pending: round2(w.pendingBalance),
      },
    ]),
  );

  const lifetimeDrift = [];
  const earningsWalletDrift = [];
  const shoppingWalletDrift = [];
  const pairCountDrift = [];
  const directActivationDrift = [];
  const negativeWallets = [];

  for (const m of members) {
    const uid = String(m.userId);
    const code = codeByUser.get(uid) || uid;

    const storedA = round2(m.lifetimePlanAEarnings);
    const storedB = round2(m.lifetimePlanBEarnings);
    const expA = planAByUser.get(uid) || 0;
    const expB = planBByUser.get(uid) || 0;
    if (Math.abs(storedA - expA) > TOLERANCE || Math.abs(storedB - expB) > TOLERANCE) {
      lifetimeDrift.push(
        row(code, uid, "lifetime_counter", {
          storedPlanA: storedA,
          expectedPlanA: expA,
          storedPlanB: storedB,
          expectedPlanB: expB,
        }),
      );
    }

    const creditedEarn = earnByUser.get(uid) || 0;
    const withdrawn = withdrawByUser.get(uid) || 0;
    const expectedEarnWallet = round2(creditedEarn - withdrawn);
    const wallet = walletByUser.get(uid) || {
      earnings: 0,
      shopping: 0,
      pending: 0,
    };

    if (Math.abs(wallet.earnings - expectedEarnWallet) > TOLERANCE) {
      earningsWalletDrift.push(
        row(code, uid, "earnings_wallet", {
          wallet: wallet.earnings,
          expected: expectedEarnWallet,
          creditedEarn,
          withdrawn,
          gap: round2(wallet.earnings - expectedEarnWallet),
        }),
      );
    }

    if (wallet.earnings < -TOLERANCE || wallet.shopping < -TOLERANCE) {
      negativeWallets.push(
        row(code, uid, "negative_wallet", {
          earnings: wallet.earnings,
          shopping: wallet.shopping,
        }),
      );
    }

    const shopCredits = round2(
      (shopEventsByUser.get(uid) || 0) + (joiningByUser.get(uid) || 0),
    );
    const shopSpent = shopSpendByUser.get(uid) || 0;
    const expectedShopping = round2(shopCredits - shopSpent);
    if (
      shopCredits > 0 &&
      Math.abs(wallet.shopping - expectedShopping) > TOLERANCE
    ) {
      shoppingWalletDrift.push(
        row(code, uid, "shopping_wallet", {
          wallet: wallet.shopping,
          expected: expectedShopping,
          shopEventCredits: shopEventsByUser.get(uid) || 0,
          joiningCredits: joiningByUser.get(uid) || 0,
          shopSpent,
          gap: round2(wallet.shopping - expectedShopping),
        }),
      );
    }

    const pairsStored = Number(m.pairsCompleted) || 0;
    const pairEvents = pairEventsByUser.get(uid) || 0;
    if (pairsStored !== pairEvents) {
      pairCountDrift.push(
        row(code, uid, "pairs_completed", {
          pairsCompleted: pairsStored,
          pairEvents,
          gap: pairsStored - pairEvents,
        }),
      );
    }

    const activeDirects = activeDirectsBySponsor.get(uid) || 0;
    if (activeDirects > 0) {
      const creditedActivations =
        (perActivationByUser.get(uid) || 0) + (legacyDrpaByUser.get(uid) || 0);
      if (activeDirects !== creditedActivations) {
        directActivationDrift.push(
          row(code, uid, "direct_activation_count", {
            activeDirects,
            creditedActivations,
            gap: activeDirects - creditedActivations,
          }),
        );
      }
    }
  }

  const report = {
    scannedAt: new Date().toISOString(),
    membersScanned: members.length,
    summary: {
      lifetimeCounterDrift: lifetimeDrift.length,
      earningsWalletDrift: earningsWalletDrift.length,
      shoppingWalletDrift: shoppingWalletDrift.length,
      pairCountDrift: pairCountDrift.length,
      directActivationDrift: directActivationDrift.length,
      negativeWallets: negativeWallets.length,
    },
    topSamples: {
      lifetimeCounterDrift: lifetimeDrift.slice(0, TOP_N),
      earningsWalletDrift: earningsWalletDrift
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, TOP_N),
      shoppingWalletDrift: shoppingWalletDrift
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, TOP_N),
      pairCountDrift: pairCountDrift
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, TOP_N),
      directActivationDrift: directActivationDrift
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, TOP_N),
      negativeWallets,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (VERBOSE) {
    const print = (title, rows) => {
      if (!rows.length) return;
      console.log(`\n--- ${title} (${rows.length}) ---`);
      for (const r of rows) console.log(r);
    };
    print("Lifetime drift (all)", lifetimeDrift);
    print("Earnings wallet drift (all)", earningsWalletDrift);
    print("Shopping wallet drift (all)", shoppingWalletDrift);
    print("Pair count drift (all)", pairCountDrift);
    print("Direct activation drift (all)", directActivationDrift);
  }

  await mongoose.connection.close();
  const totalIssues =
    lifetimeDrift.length +
    earningsWalletDrift.length +
    shoppingWalletDrift.length +
    pairCountDrift.length +
    directActivationDrift.length +
    negativeWallets.length;
  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
