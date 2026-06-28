/**
 * Read-only MLM data integrity audit against the live database.
 *
 *   node scripts/audit-mlm-data-integrity.js
 *   node scripts/audit-mlm-data-integrity.js --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import Wallet from "../app/models/wallet.js";
import Setting from "../app/models/setting.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
  MLM_DEFAULTS,
} from "../app/constants/mlm.js";
import { OWNER_TYPE, LEDGER_DIRECTION } from "../app/constants/finance.js";
import {
  calculateBinaryPairs,
  computeBinaryTeamPairSnapshot,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { classifyDirectReferralsByLegUnderRoot } from "../app/services/mlm/mlmBinaryTreeBuilder.js";

dotenv.config();

const VERBOSE = process.argv.includes("--verbose");
const TOP_N = 25;

function sampleRow(m, fields) {
  const out = { userId: String(m.userId), referralCode: m.referralCode };
  for (const f of fields) out[f] = m[f];
  return out;
}

async function main() {
  await connectDB();

  const settingDoc = await Setting.findOne({}).select("mlm").lean();
  const cfg = { ...MLM_DEFAULTS, ...(settingDoc?.mlm || {}) };
  const topupThreshold =
    Number(cfg.binaryTopupPairIncome?.eligibilityLifetimeEarnings) || 30000;

  const totalMembers = await MlmMembership.countDocuments({});
  const activeMembers = await MlmMembership.countDocuments({
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
  });

  // ── 1. Commission event totals vs membership lifetime counters ─────
  const eventTotalsByUser = await MlmCommissionEvent.aggregate([
    {
      $match: {
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        walletBucket: { $in: ["earnings", "pending"] },
      },
    },
    {
      $group: {
        _id: { userId: "$recipientId", planType: "$planType" },
        total: { $sum: "$cappedAmount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const eventPlanA = new Map();
  const eventPlanB = new Map();
  const eventAll = new Map();
  for (const row of eventTotalsByUser) {
    const uid = String(row._id.userId);
    const amt = Number(row.total) || 0;
    eventAll.set(uid, (eventAll.get(uid) || 0) + amt);
    if (row._id.planType === MLM_PLAN_TYPE.B) {
      eventPlanB.set(uid, (eventPlanB.get(uid) || 0) + amt);
    } else {
      eventPlanA.set(uid, (eventPlanA.get(uid) || 0) + amt);
    }
  }

  const lifetimeDrift = [];
  const membersForLifetime = await MlmMembership.find(
    {},
    {
      userId: 1,
      referralCode: 1,
      lifetimePlanAEarnings: 1,
      lifetimePlanBEarnings: 1,
    },
  ).lean();

  for (const m of membersForLifetime) {
    const uid = String(m.userId);
    const storedA = Number(m.lifetimePlanAEarnings) || 0;
    const storedB = Number(m.lifetimePlanBEarnings) || 0;
    const expectedA = Math.round((eventPlanA.get(uid) || 0) * 100) / 100;
    const expectedB = Math.round((eventPlanB.get(uid) || 0) * 100) / 100;
    const gapA = Math.round((storedA - expectedA) * 100) / 100;
    const gapB = Math.round((storedB - expectedB) * 100) / 100;
    if (Math.abs(gapA) > 0.01 || Math.abs(gapB) > 0.01) {
      lifetimeDrift.push({
        userId: uid,
        referralCode: m.referralCode,
        storedPlanA: storedA,
        expectedPlanA: expectedA,
        gapPlanA: gapA,
        storedPlanB: storedB,
        expectedPlanB: expectedB,
        gapPlanB: gapB,
      });
    }
  }

  // ── 2. Pair events vs pairsCompleted ───────────────────────────────
  const pairEventCounts = await MlmCommissionEvent.aggregate([
    {
      $match: {
        bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
        status: {
          $in: [
            MLM_COMMISSION_EVENT_STATUS.CREDITED,
            MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER,
          ],
        },
      },
    },
    { $group: { _id: "$recipientId", count: { $sum: 1 } } },
  ]);
  const pairEventsByUser = new Map(
    pairEventCounts.map((r) => [String(r._id), r.count]),
  );

  const pairCountDrift = [];
  const heldPairEvents = await MlmCommissionEvent.countDocuments({
    bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_DOWNLINE_ACTIVATION,
  });

  const membersWithPairs = await MlmMembership.find(
    { $or: [{ pairsCompleted: { $gt: 0 } }, { binaryPairsEligible: { $gt: 0 } }] },
    {
      userId: 1,
      referralCode: 1,
      pairsCompleted: 1,
      lastPaidPairIndex: 1,
      binaryPairsEligible: 1,
      leftLegDirectCount: 1,
      rightLegDirectCount: 1,
      leftLegTeamActiveCount: 1,
      rightLegTeamActiveCount: 1,
    },
  ).lean();

  for (const m of membersWithPairs) {
    const uid = String(m.userId);
    const paid = Number(m.pairsCompleted) || 0;
    const events = pairEventsByUser.get(uid) || 0;
    const eligible = Number(m.binaryPairsEligible) || 0;
    const directMin = Math.min(
      Number(m.leftLegDirectCount) || 0,
      Number(m.rightLegDirectCount) || 0,
    );
    const lastIdx = Number(m.lastPaidPairIndex) || 0;

    const issues = [];
    if (paid !== events) issues.push(`pairsCompleted(${paid})≠creditedEvents(${events})`);
    if (paid > eligible && eligible > 0) issues.push(`paid(${paid})>eligible(${eligible})`);
    if (lastIdx !== paid && lastIdx > 0) issues.push(`lastPaidPairIndex(${lastIdx})≠pairsCompleted(${paid})`);
    if (paid > directMin && directMin >= 0) {
      issues.push(`paid(${paid})>minDirectLegs(${directMin}) [legacy direct-leg model]`);
    }

    if (issues.length) {
      pairCountDrift.push({
        userId: uid,
        referralCode: m.referralCode,
        pairsCompleted: paid,
        pairEvents: events,
        binaryPairsEligible: eligible,
        leftLegDirectCount: m.leftLegDirectCount,
        rightLegDirectCount: m.rightLegDirectCount,
        leftLegTeamActiveCount: m.leftLegTeamActiveCount,
        rightLegTeamActiveCount: m.rightLegTeamActiveCount,
        issues,
      });
    }
  }

  // ── 3. Referral + leg direct counters ──────────────────────────────
  const allMembers = await MlmMembership.find(
    {},
    {
      userId: 1,
      referralCode: 1,
      sponsorId: 1,
      directReferralsCount: 1,
      leftLegDirectCount: 1,
      rightLegDirectCount: 1,
      totalDownlineCount: 1,
      status: 1,
      binaryPosition: 1,
    },
  ).lean();

  const directsBySponsor = new Map();
  for (const m of allMembers) {
    if (!m.sponsorId) continue;
    const sid = String(m.sponsorId);
    if (!directsBySponsor.has(sid)) directsBySponsor.set(sid, []);
    directsBySponsor.get(sid).push(m);
  }

  const referralCountDrift = [];
  const legDirectDrift = [];

  for (const m of allMembers) {
    const uid = String(m.userId);
    const directs = directsBySponsor.get(uid) || [];
    const actualDirectCount = directs.length;
    const storedDirect = Number(m.directReferralsCount) || 0;

    if (storedDirect !== actualDirectCount) {
      referralCountDrift.push({
        userId: uid,
        referralCode: m.referralCode,
        stored: storedDirect,
        actual: actualDirectCount,
        gap: storedDirect - actualDirectCount,
      });
    }

    if (directs.length === 0) continue;

    let left = 0;
    let right = 0;
    try {
      const legMap = await classifyDirectReferralsByLegUnderRoot({
        rootMembership: m,
        directReferrals: directs,
      });
      for (const d of directs) {
        const leg = legMap.get(String(d._id)) ?? legMap.get(String(d.userId));
        if (leg === "L") left += 1;
        else if (leg === "R") right += 1;
      }
    } catch {
      for (const d of directs) {
        if (d.binaryPosition === "L") left += 1;
        else if (d.binaryPosition === "R") right += 1;
      }
    }

    const storedL = Number(m.leftLegDirectCount) || 0;
    const storedR = Number(m.rightLegDirectCount) || 0;
    if (storedL !== left || storedR !== right) {
      legDirectDrift.push({
        userId: uid,
        referralCode: m.referralCode,
        storedLeft: storedL,
        actualLeft: left,
        storedRight: storedR,
        actualRight: right,
      });
    }
  }

  // ── 4. Team snapshot drift (active members with pair activity) ─────
  const teamSnapshotDrift = [];
  const teamCandidates = await MlmMembership.find({
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
    $or: [
      { pairsCompleted: { $gt: 0 } },
      { binaryPairsEligible: { $gt: 0 } },
      { leftLegTeamActiveCount: { $gt: 0 } },
      { rightLegTeamActiveCount: { $gt: 0 } },
    ],
  }).limit(500);

  for (const m of teamCandidates) {
    const snap = await computeBinaryTeamPairSnapshot(m);
    const issues = [];
    if ((m.leftLegTeamActiveCount || 0) !== snap.leftLegTeamActiveCount) {
      issues.push(
        `leftTeam stored=${m.leftLegTeamActiveCount} actual=${snap.leftLegTeamActiveCount}`,
      );
    }
    if ((m.rightLegTeamActiveCount || 0) !== snap.rightLegTeamActiveCount) {
      issues.push(
        `rightTeam stored=${m.rightLegTeamActiveCount} actual=${snap.rightLegTeamActiveCount}`,
      );
    }
    if ((m.binaryPairsEligible || 0) !== snap.binaryPairsEligible) {
      issues.push(
        `eligible stored=${m.binaryPairsEligible} actual=${snap.binaryPairsEligible}`,
      );
    }
    const paid = Number(m.pairsCompleted) || 0;
    if (paid > snap.binaryPairsEligible) {
      issues.push(`paid(${paid})>recomputedEligible(${snap.binaryPairsEligible})`);
    }
    const { pairs: expectedPaidFromTeam } = calculateBinaryPairs(
      snap.leftLegTeamActiveCount,
      snap.rightLegTeamActiveCount,
    );
    if (paid > expectedPaidFromTeam) {
      issues.push(`paid(${paid})>teamVolumePairs(${expectedPaidFromTeam})`);
    }
    if (issues.length) {
      teamSnapshotDrift.push({
        userId: String(m.userId),
        referralCode: m.referralCode,
        pairsCompleted: paid,
        issues,
        stored: {
          leftLegTeamActiveCount: m.leftLegTeamActiveCount,
          rightLegTeamActiveCount: m.rightLegTeamActiveCount,
          binaryPairsEligible: m.binaryPairsEligible,
        },
        actual: snap,
      });
    }
  }

  // ── 5. binaryTopupMember flag ────────────────────────────────────
  const topupShouldBeTrue = [];
  const topupShouldBeFalse = [];
  const membersForTopup = await MlmMembership.find(
    {},
    {
      userId: 1,
      referralCode: 1,
      binaryTopupMember: 1,
      lifetimePlanAEarnings: 1,
      lifetimePlanBEarnings: 1,
    },
  ).lean();

  for (const m of membersForTopup) {
    const lt =
      (Number(m.lifetimePlanAEarnings) || 0) + (Number(m.lifetimePlanBEarnings) || 0);
    if (lt >= topupThreshold && !m.binaryTopupMember) {
      topupShouldBeTrue.push({
        userId: String(m.userId),
        referralCode: m.referralCode,
        lifetime: lt,
        threshold: topupThreshold,
      });
    }
    if (lt < topupThreshold && m.binaryTopupMember) {
      topupShouldBeFalse.push({
        userId: String(m.userId),
        referralCode: m.referralCode,
        lifetime: lt,
        threshold: topupThreshold,
      });
    }
  }

  // ── 6. Wallet vs ledger (earnings + pending buckets) ───────────────
  const walletLedgerDrift = [];
  const wallets = await Wallet.find({ ownerType: OWNER_TYPE.CUSTOMER }).lean();
  const ledgerByOwner = await LedgerEntry.aggregate([
    { $match: { ownerType: OWNER_TYPE.CUSTOMER } },
    {
      $group: {
        _id: "$ownerId",
        netEarnings: {
          $sum: {
            $cond: [
              { $eq: ["$bucket", "earnings"] },
              {
                $cond: [
                  { $eq: ["$direction", LEDGER_DIRECTION.CREDIT] },
                  "$amount",
                  { $multiply: ["$amount", -1] },
                ],
              },
              0,
            ],
          },
        },
        netPending: {
          $sum: {
            $cond: [
              { $eq: ["$bucket", "pending"] },
              {
                $cond: [
                  { $eq: ["$direction", LEDGER_DIRECTION.CREDIT] },
                  "$amount",
                  { $multiply: ["$amount", -1] },
                ],
              },
              0,
            ],
          },
        },
      },
    },
  ]);
  const ledgerMap = new Map(ledgerByOwner.map((r) => [String(r._id), r]));

  for (const w of wallets) {
    const uid = String(w.ownerId);
    const ledger = ledgerMap.get(uid);
    if (!ledger) continue;
    const walletEarn = Number(w.earningsBalance) || 0;
    const walletPending = Number(w.pendingBalance) || 0;
    const ledgerEarn = Math.round((Number(ledger.netEarnings) || 0) * 100) / 100;
    const ledgerPending = Math.round((Number(ledger.netPending) || 0) * 100) / 100;
    const gapE = Math.round((walletEarn - ledgerEarn) * 100) / 100;
    const gapP = Math.round((walletPending - ledgerPending) * 100) / 100;
    if (Math.abs(gapE) > 1 || Math.abs(gapP) > 1) {
      const isMlm = membersForLifetime.some((m) => String(m.userId) === uid);
      if (!isMlm) continue;
      walletLedgerDrift.push({
        userId: uid,
        walletEarnings: walletEarn,
        ledgerEarnings: ledgerEarn,
        gapEarnings: gapE,
        walletPending: walletPending,
        ledgerPending: ledgerPending,
        gapPending: gapP,
      });
    }
  }

  // ── 7. Legacy pair events without team meta ────────────────────────
  const legacyPairEvents = await MlmCommissionEvent.countDocuments({
    bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    "meta.matchingMode": { $ne: "team" },
    "meta.leftContributorUserId": { $exists: false },
  });
  const teamPairEvents = await MlmCommissionEvent.countDocuments({
    bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    "meta.matchingMode": "team",
  });

  // ── 8. Held signup / pair events with active sponsors ─────────────
  const heldSignup = await MlmCommissionEvent.countDocuments({
    status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
  });

  const bonusSummary = await MlmCommissionEvent.aggregate([
    { $group: { _id: { bonusType: "$bonusType", status: "$status" }, count: { $sum: 1 }, total: { $sum: "$bonusAmount" } } },
    { $sort: { count: -1 } },
  ]);

  const report = {
    scannedAt: new Date().toISOString(),
    totals: { totalMembers, activeMembers, topupThreshold },
    summary: {
      lifetimeCounterDrift: lifetimeDrift.length,
      pairCountDrift: pairCountDrift.length,
      referralCountDrift: referralCountDrift.length,
      legDirectDrift: legDirectDrift.length,
      teamSnapshotDrift: teamSnapshotDrift.length,
      walletLedgerDrift: walletLedgerDrift.length,
      topupFlagMissing: topupShouldBeTrue.length,
      topupFlagUnexpected: topupShouldBeFalse.length,
      heldPairEvents,
      heldSignupEvents: heldSignup,
      legacyPairEventsNoTeamMeta: legacyPairEvents,
      teamPairEvents,
    },
    topSamples: {
      lifetimeCounterDrift: lifetimeDrift
        .sort((a, b) => Math.abs(b.gapPlanA) - Math.abs(a.gapPlanA))
        .slice(0, TOP_N),
      pairCountDrift: pairCountDrift.slice(0, TOP_N),
      referralCountDrift: referralCountDrift
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, TOP_N),
      legDirectDrift: legDirectDrift.slice(0, TOP_N),
      teamSnapshotDrift: teamSnapshotDrift.slice(0, TOP_N),
      walletLedgerDrift: walletLedgerDrift
        .sort((a, b) => Math.abs(b.gapEarnings) - Math.abs(a.gapEarnings))
        .slice(0, TOP_N),
      topupFlagMissing: topupShouldBeTrue.slice(0, TOP_N),
    },
    bonusEventBreakdown: bonusSummary,
  };

  if (VERBOSE) {
    report.full = {
      lifetimeCounterDrift,
      pairCountDrift,
      referralCountDrift,
      legDirectDrift,
      teamSnapshotDrift,
      walletLedgerDrift,
    };
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
