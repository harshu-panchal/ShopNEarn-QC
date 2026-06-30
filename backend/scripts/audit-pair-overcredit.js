/**
 * audit-pair-overcredit.js
 *
 * Scan all members for recalc-style pair over-credits:
 * credited BINARY_PAIR_MATCH events exceed eligible team pairs.
 *
 *   node scripts/audit-pair-overcredit.js
 *   node scripts/audit-pair-overcredit.js --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import MlmWithdrawalRequest from "../app/models/mlmWithdrawalRequest.js";
import Wallet from "../app/models/wallet.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
  MLM_WITHDRAWAL_STATUS,
} from "../app/constants/mlm.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import {
  computeBinaryTeamPairSnapshot,
  countActivePlanADirects,
  resolvePairIncomeConfig,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import { getDirectReferralActivationConfig } from "../app/services/mlm/mlmConfigService.js";

dotenv.config();

const VERBOSE = process.argv.includes("--verbose");
const TOLERANCE = 1;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pairIndexOf(event) {
  const fromMeta = Number(event?.meta?.pairIndex);
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  const key = String(event?.idempotencyKey || "");
  const m = key.match(/-P(\d+)$/i);
  return m ? Number(m[1]) : null;
}

async function main() {
  await connectDB();
  const cfg = await getMlmConfig();
  const draCfg = await getDirectReferralActivationConfig();
  const perActivationAmt = round2(draCfg.perActivation.amount || 200);

  const members = await MlmMembership.find({}).lean();

  const pairEvents = await MlmCommissionEvent.find(
    {
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      walletBucket: { $in: ["earnings", "pending"] },
    },
    {
      recipientId: 1,
      cappedAmount: 1,
      bonusAmount: 1,
      idempotencyKey: 1,
      meta: 1,
      createdAt: 1,
    },
  ).lean();

  const earnEvents = await MlmCommissionEvent.find(
    {
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      walletBucket: { $in: ["earnings", "pending"] },
    },
    { recipientId: 1, bonusType: 1, cappedAmount: 1, bonusAmount: 1 },
  ).lean();

  const perActivationByUser = new Map();
  const earnSumByUser = new Map();
  for (const e of earnEvents) {
    const uid = String(e.recipientId);
    const amt = round2(e.cappedAmount || e.bonusAmount || 0);
    earnSumByUser.set(uid, round2((earnSumByUser.get(uid) || 0) + amt));
    if (e.bonusType === MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION) {
      perActivationByUser.set(
        uid,
        round2((perActivationByUser.get(uid) || 0) + amt),
      );
    }
  }

  const pairEventsByUser = new Map();
  for (const e of pairEvents) {
    const uid = String(e.recipientId);
    if (!pairEventsByUser.has(uid)) pairEventsByUser.set(uid, []);
    pairEventsByUser.get(uid).push(e);
  }

  const wallets = await Wallet.find({ ownerType: OWNER_TYPE.CUSTOMER }).lean();
  const walletByUser = new Map(
    wallets.map((w) => [String(w.ownerId), round2(w.earningsBalance || 0)]),
  );

  const withdrawRows = await MlmWithdrawalRequest.aggregate([
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
  ]);
  const withdrawnByUser = new Map(
    withdrawRows.map((r) => [String(r._id), round2(r.gross || 0)]),
  );

  const activeDirectRows = await MlmMembership.aggregate([
    {
      $match: {
        sponsorId: { $ne: null },
        status: MLM_MEMBERSHIP_STATUS.ACTIVE,
        planType: MLM_PLAN_TYPE.A,
      },
    },
    { $group: { _id: "$sponsorId", count: { $sum: 1 } } },
  ]);
  const activeDirectsBySponsor = new Map(
    activeDirectRows.map((r) => [String(r._id), Number(r.count) || 0]),
  );

  const issues = [];
  let scannedWithEarnings = 0;

  for (const m of members) {
    const uid = String(m.userId);
    const code = m.referralCode || uid;
    const wallet = walletByUser.get(uid) || 0;
    const creditedEarn = earnSumByUser.get(uid) || 0;
    if (wallet <= 0 && creditedEarn <= 0) continue;
    scannedWithEarnings += 1;

    const withdrawn = withdrawnByUser.get(uid) || 0;
    const snapshot = await computeBinaryTeamPairSnapshot(m);
    const eligible = Math.max(
      snapshot.binaryPairsEligible,
      Number(m.binaryPairsEligible) || 0,
    );
    const pairsStored = Number(m.pairsCompleted) || 0;

    const userPairEvents = (pairEventsByUser.get(uid) || []).sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    );
    const pairEventCount = userPairEvents.length;
    const creditedPairSum = round2(
      userPairEvents.reduce(
        (s, e) => s + (e.cappedAmount || e.bonusAmount || 0),
        0,
      ),
    );

    const validPairEvents = userPairEvents.filter((e) => {
      const idx = pairIndexOf(e);
      return idx == null || idx <= eligible;
    });
    const extraPairEvents = userPairEvents.filter((e) => {
      const idx = pairIndexOf(e);
      return idx != null && idx > eligible;
    });
    const unindexedExtras =
      pairEventCount > eligible
        ? userPairEvents.slice(eligible)
        : [];

    const overpaidByIndex = round2(
      extraPairEvents.reduce(
        (s, e) => s + (e.cappedAmount || e.bonusAmount || 0),
        0,
      ),
    );
    const overpaidByCount = round2(
      unindexedExtras.reduce(
        (s, e) => s + (e.cappedAmount || e.bonusAmount || 0),
        0,
      ),
    );
    const overpaidPairAmount = Math.max(overpaidByIndex, overpaidByCount);

    const validPairSum = round2(creditedPairSum - overpaidPairAmount);
    const activeDirects = activeDirectsBySponsor.get(uid) || 0;
    const perActivationCredited = perActivationByUser.get(uid) || 0;
    const expectedPerActivation = round2(activeDirects * perActivationAmt);

    const directCount = await countActivePlanADirects(uid);
    const { pairIncome } = resolvePairIncomeConfig(
      cfg,
      directCount,
      !!m.binaryTopupMember,
    );
    const pairsToPay = Math.min(eligible, pairsStored || eligible);
    const expectedPairAtCurrentRate = round2(pairsToPay * pairIncome);
    const expectedEarnAtCurrentRate = round2(
      expectedPerActivation + expectedPairAtCurrentRate,
    );
    const expectedEarnFromCreditedValid = round2(
      expectedPerActivation + validPairSum,
    );

    const walletGap = round2(wallet - (creditedEarn - withdrawn));
    const lifetimeGap = round2(
      (Number(m.lifetimePlanAEarnings) || 0) - creditedEarn,
    );
    const overcreditGap = round2(wallet - expectedEarnFromCreditedValid);

    const memberIssues = [];

    if (pairEventCount > eligible) {
      memberIssues.push("PAIR_EVENTS_EXCEED_ELIGIBLE");
    }
    if (overpaidPairAmount > TOLERANCE) {
      memberIssues.push("PAIR_AMOUNT_OVERCREDIT");
    }
    if (pairsStored !== pairEventCount && pairEventCount > 0) {
      memberIssues.push("PAIRS_COMPLETED_MISMATCH");
    }
    if (
      activeDirects > 0
      && Math.abs(perActivationCredited - expectedPerActivation) > TOLERANCE
    ) {
      memberIssues.push("PER_ACTIVATION_MISMATCH");
    }
    if (Math.abs(wallet - (creditedEarn - withdrawn)) > TOLERANCE) {
      memberIssues.push("WALLET_VS_CREDITED_MISMATCH");
    }
    if (lifetimeGap > TOLERANCE) {
      memberIssues.push("LIFETIME_STALE");
    }
    if (overcreditGap > TOLERANCE) {
      memberIssues.push("WALLET_ABOVE_RULES");
    }

    if (!memberIssues.length) continue;

    issues.push({
      referralCode: code,
      userId: uid,
      issues: memberIssues,
      wallet,
      creditedEarn,
      withdrawn,
      lifetimePlanA: round2(m.lifetimePlanAEarnings),
      activeDirects,
      perActivationCredited,
      expectedPerActivation,
      pairEventCount,
      pairsStored,
      eligiblePairs: eligible,
      creditedPairSum,
      validPairSum,
      overpaidPairAmount,
      expectedEarnFromCreditedValid,
      expectedEarnAtCurrentRate,
      overcreditGap,
      teamLeft: snapshot.leftLegTeamActiveCount,
      teamRight: snapshot.rightLegTeamActiveCount,
      lifetimeGap,
      walletGap,
    });
  }

  issues.sort((a, b) => b.overcreditGap - a.overcreditGap);

  const summary = {
    scannedAt: new Date().toISOString(),
    membersWithEarnings: scannedWithEarnings,
    membersWithIssues: issues.length,
    byIssue: {},
    totalOverpaidPairAmount: round2(
      issues.reduce((s, r) => s + (r.overpaidPairAmount || 0), 0),
    ),
    totalWalletOvercreditGap: round2(
      issues.reduce((s, r) => s + Math.max(0, r.overcreditGap || 0), 0),
    ),
    top20: issues.slice(0, 20),
  };

  for (const row of issues) {
    for (const issue of row.issues) {
      summary.byIssue[issue] = (summary.byIssue[issue] || 0) + 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (VERBOSE) {
    console.log("\n--- ALL AFFECTED MEMBERS ---");
    for (const row of issues) {
      console.log(row);
    }
  }

  await mongoose.connection.close();
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[audit-pair-overcredit] FATAL:", err);
  process.exit(1);
});
