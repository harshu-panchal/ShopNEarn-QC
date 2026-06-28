/**
 * Repair MLM data mismatches found by audit-mlm-data-integrity.js.
 *
 * Phases (in order):
 *   1. Refresh team binary snapshots + align pairsCompleted to credited events
 *   2. Reconcile lifetimePlanA/B earnings counters from credited events
 *   3. Fix directReferralsCount (+ sync Customer.mlm projection)
 *   4. Release held pair bonuses for now-active downlines
 *   5. Release held signup bonuses for now-active sponsors
 *   6. Credit missing team pair income (eligible > paid events)
 *   7. Sync binaryTopupMember flags from lifetime totals
 *
 * Usage:
 *   node scripts/repair-mlm-data-integrity.js
 *   node scripts/repair-mlm-data-integrity.js --apply
 *   node scripts/repair-mlm-data-integrity.js --apply --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Setting from "../app/models/setting.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
  MLM_DEFAULTS,
} from "../app/constants/mlm.js";
import {
  computeBinaryTeamPairSnapshot,
  countPaidBinaryPairEvents,
  computeAndCreditBinaryTeamPairIncome,
  syncBinaryTopupMemberFlag,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { releaseHeldPairBonusesForDownlineActivation } from "../app/services/mlm/mlmBonusEngineService.js";
import { releaseHeldSignupBonusesForSponsorActivation } from "../app/services/mlm/mlmSignupBonusService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

function tag(...args) {
  console.log("[repair-mlm-data-integrity]", ...args);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function buildLifetimeExpectedMaps() {
  const rows = await MlmCommissionEvent.aggregate([
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
      },
    },
  ]);

  const planA = new Map();
  const planB = new Map();
  for (const row of rows) {
    const uid = String(row._id.userId);
    const amt = round2(row.total);
    if (row._id.planType === MLM_PLAN_TYPE.B) {
      planB.set(uid, round2((planB.get(uid) || 0) + amt));
    } else {
      planA.set(uid, round2((planA.get(uid) || 0) + amt));
    }
  }
  return { planA, planB };
}

async function phase1TeamSnapshots(totals) {
  tag("Phase 1: team snapshots + pairsCompleted alignment");
  const cursor = MlmMembership.find(
    {},
    {
      userId: 1,
      binaryLeftChildId: 1,
      binaryRightChildId: 1,
      leftLegTeamActiveCount: 1,
      rightLegTeamActiveCount: 1,
      binaryPairsEligible: 1,
      binaryLeftBalance: 1,
      binaryRightBalance: 1,
      pairsCompleted: 1,
      lastPaidPairIndex: 1,
    },
  ).cursor();

  for await (const m of cursor) {
    totals.phase1.scanned += 1;
    try {
      const snapshot = await computeBinaryTeamPairSnapshot(m);
      const pairsPaidEvents = await countPaidBinaryPairEvents(m.userId);
      const pairsCompleted = Math.min(pairsPaidEvents, snapshot.binaryPairsEligible);

      const update = {
        ...snapshot,
        pairsCompleted,
        lastPaidPairIndex: pairsCompleted,
        binaryPairSnapshotAt: new Date(),
      };

      const changed =
        Number(m.leftLegTeamActiveCount || 0) !== snapshot.leftLegTeamActiveCount ||
        Number(m.rightLegTeamActiveCount || 0) !== snapshot.rightLegTeamActiveCount ||
        Number(m.binaryPairsEligible || 0) !== snapshot.binaryPairsEligible ||
        Number(m.pairsCompleted || 0) !== pairsCompleted;

      if (!changed) {
        totals.phase1.unchanged += 1;
        continue;
      }

      if (VERBOSE) {
        tag(
          `  ${String(m.userId)} L=${snapshot.leftLegTeamActiveCount} R=${snapshot.rightLegTeamActiveCount} eligible=${snapshot.binaryPairsEligible} paid=${pairsCompleted}`,
        );
      }

      if (APPLY) {
        await MlmMembership.updateOne({ _id: m._id }, { $set: update });
        totals.phase1.updated += 1;
      } else {
        totals.phase1.wouldUpdate += 1;
      }
    } catch (err) {
      totals.phase1.errors += 1;
      tag(`  ERROR phase1 ${String(m.userId)}: ${err.message}`);
    }
  }
}

async function phase2LifetimeCounters(expected, totals) {
  tag("Phase 2: lifetime earnings counters");
  const members = await MlmMembership.find(
    {},
    {
      userId: 1,
      referralCode: 1,
      lifetimePlanAEarnings: 1,
      lifetimePlanBEarnings: 1,
    },
  ).lean();

  for (const m of members) {
    const uid = String(m.userId);
    const expA = expected.planA.get(uid) || 0;
    const expB = expected.planB.get(uid) || 0;
    const storedA = round2(m.lifetimePlanAEarnings);
    const storedB = round2(m.lifetimePlanBEarnings);

    if (storedA === expA && storedB === expB) {
      totals.phase2.unchanged += 1;
      continue;
    }

    if (VERBOSE) {
      tag(
        `  ${m.referralCode || uid} planA ${storedA}→${expA} planB ${storedB}→${expB}`,
      );
    }

    if (APPLY) {
      await MlmMembership.updateOne(
        { _id: m._id },
        { $set: { lifetimePlanAEarnings: expA, lifetimePlanBEarnings: expB } },
      );
      await syncCustomerMlmProjection(m.userId);
      totals.phase2.updated += 1;
    } else {
      totals.phase2.wouldUpdate += 1;
    }
  }
}

async function phase3DirectReferralCounts(totals) {
  tag("Phase 3: directReferralsCount");
  const all = await MlmMembership.find(
    {},
    { userId: 1, referralCode: 1, sponsorId: 1, directReferralsCount: 1 },
  ).lean();

  const countBySponsor = new Map();
  for (const m of all) {
    if (!m.sponsorId) continue;
    const sid = String(m.sponsorId);
    countBySponsor.set(sid, (countBySponsor.get(sid) || 0) + 1);
  }

  for (const m of all) {
    const uid = String(m.userId);
    const actual = countBySponsor.get(uid) || 0;
    const stored = Number(m.directReferralsCount) || 0;
    if (stored === actual) {
      totals.phase3.unchanged += 1;
      continue;
    }

    if (VERBOSE) {
      tag(`  ${m.referralCode || uid} directReferrals ${stored}→${actual}`);
    }

    if (APPLY) {
      await MlmMembership.updateOne(
        { _id: m._id },
        { $set: { directReferralsCount: actual } },
      );
      await syncCustomerMlmProjection(m.userId);
      totals.phase3.updated += 1;
    } else {
      totals.phase3.wouldUpdate += 1;
    }
  }
}

async function phase4ReleaseHeldPairs(totals) {
  tag("Phase 4: release held pair bonuses");
  const activeMembers = await MlmMembership.find(
    { status: MLM_MEMBERSHIP_STATUS.ACTIVE },
    { userId: 1, referralCode: 1 },
  ).lean();

  if (!APPLY) {
    const heldCount = await MlmCommissionEvent.countDocuments({
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_DOWNLINE_ACTIVATION,
    });
    totals.phase4.wouldRelease = heldCount;
    tag(`  would scan ${activeMembers.length} active members; ${heldCount} held pair event(s) pending`);
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const m of activeMembers) {
        const released = await releaseHeldPairBonusesForDownlineActivation({
          newActiveUserId: m.userId,
          session,
          correlationId: `repair-held-pair-${String(m.userId)}`,
        });
        if (released.length) {
          totals.phase4.released += released.length;
          if (VERBOSE) {
            tag(`  ${m.referralCode || m.userId}: released ${released.length} held pair(s)`);
          }
        }
      }
    });
  } finally {
    await session.endSession();
  }
}

async function phase5ReleaseHeldSignup(totals) {
  tag("Phase 5: release held signup bonuses");
  const activeSponsors = await MlmMembership.find(
    { status: MLM_MEMBERSHIP_STATUS.ACTIVE },
    { userId: 1, referralCode: 1 },
  ).lean();

  if (!APPLY) {
    const heldCount = await MlmCommissionEvent.countDocuments({
      status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
    });
    totals.phase5.wouldRelease = heldCount;
    tag(`  would scan ${activeSponsors.length} active sponsors; ${heldCount} held signup event(s) pending`);
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const s of activeSponsors) {
        const released = await releaseHeldSignupBonusesForSponsorActivation({
          sponsorUserId: s.userId,
          session,
          correlationId: `repair-held-signup-${String(s.userId)}`,
        });
        if (released.length) {
          totals.phase5.released += released.length;
          if (VERBOSE) {
            tag(`  ${s.referralCode || s.userId}: released ${released.length} signup bonus(es)`);
          }
        }
      }
    });
  } finally {
    await session.endSession();
  }
}

async function phase6CreditMissingPairs(totals) {
  tag("Phase 6: credit missing team pair income");
  const candidates = await MlmMembership.find({
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
  });

  for (const m of candidates) {
    const paidEvents = await countPaidBinaryPairEvents(m.userId);
    const snap = await computeBinaryTeamPairSnapshot(m);
    const gap = snap.binaryPairsEligible - paidEvents;
    if (gap <= 0) {
      totals.phase6.skipped += 1;
      continue;
    }

    if (VERBOSE) {
      tag(
        `  ${m.referralCode || m.userId} paidEvents=${paidEvents} eligible=${snap.binaryPairsEligible} gap=${gap}`,
      );
    }

    if (!APPLY) {
      totals.phase6.wouldCredit += gap;
      totals.phase6.wouldCreditMembers += 1;
      continue;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const live = await MlmMembership.findById(m._id).session(session);
        if (!live) return;

        live.pairsCompleted = paidEvents;
        live.lastPaidPairIndex = paidEvents;
        Object.assign(live, snap);
        await live.save({ session });

        const events = await computeAndCreditBinaryTeamPairIncome({
          sponsorUserId: m.userId,
          triggerUserId: null,
          session,
          correlationId: `repair-missing-pairs-${String(m.userId)}`,
        });
        totals.phase6.creditedEvents += events.length;
        if (events.length) totals.phase6.creditedMembers += 1;

        // Re-align counter if daily cap blocked some credits.
        const paidAfter = await countPaidBinaryPairEvents(m.userId, { session });
        const snapAfter = await computeBinaryTeamPairSnapshot(
          await MlmMembership.findById(m._id).session(session),
          { session },
        );
        await MlmMembership.updateOne(
          { _id: m._id },
          {
            $set: {
              pairsCompleted: Math.min(paidAfter, snapAfter.binaryPairsEligible),
              lastPaidPairIndex: Math.min(paidAfter, snapAfter.binaryPairsEligible),
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }
}

async function phase7TopupFlags(totals) {
  tag("Phase 7: binaryTopupMember flags");
  const settingDoc = await Setting.findOne({}).select("mlm").lean();
  const cfg = { ...MLM_DEFAULTS, ...(settingDoc?.mlm || {}) };
  const threshold =
    Number(cfg.binaryTopupPairIncome?.eligibilityLifetimeEarnings) || 30000;

  const members = await MlmMembership.find(
    {},
    {
      userId: 1,
      referralCode: 1,
      binaryTopupMember: 1,
      lifetimePlanAEarnings: 1,
      lifetimePlanBEarnings: 1,
    },
  );

  for (const m of members) {
    const lt =
      (Number(m.lifetimePlanAEarnings) || 0) +
      (Number(m.lifetimePlanBEarnings) || 0);
    const shouldBe = lt >= threshold;
    const is = Boolean(m.binaryTopupMember);
    if (shouldBe === is) {
      totals.phase7.unchanged += 1;
      continue;
    }

    if (VERBOSE) {
      tag(`  ${m.referralCode || m.userId} topup ${is}→${shouldBe} (lifetime ₹${lt})`);
    }

    if (APPLY) {
      await syncBinaryTopupMemberFlag(m, { cfg });
      totals.phase7.updated += 1;
    } else {
      totals.phase7.wouldUpdate += 1;
    }
  }
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes enabled)" : "DRY-RUN (no writes)");

  const expected = await buildLifetimeExpectedMaps();
  const totals = {
    phase1: { scanned: 0, updated: 0, wouldUpdate: 0, unchanged: 0, errors: 0 },
    phase2: { updated: 0, wouldUpdate: 0, unchanged: 0 },
    phase3: { updated: 0, wouldUpdate: 0, unchanged: 0 },
    phase4: { released: 0, wouldRelease: 0 },
    phase5: { released: 0, wouldRelease: 0 },
    phase6: {
      skipped: 0,
      wouldCredit: 0,
      wouldCreditMembers: 0,
      creditedEvents: 0,
      creditedMembers: 0,
    },
    phase7: { updated: 0, wouldUpdate: 0, unchanged: 0 },
  };

  await phase1TeamSnapshots(totals);
  await phase2LifetimeCounters(expected, totals);
  await phase3DirectReferralCounts(totals);
  await phase4ReleaseHeldPairs(totals);
  await phase5ReleaseHeldSignup(totals);
  await phase6CreditMissingPairs(totals);
  await phase7TopupFlags(totals);

  tag("Summary:", JSON.stringify(totals, null, 2));
  if (!APPLY) {
    tag("Dry-run only. Re-run with --apply to persist.");
  }

  await mongoose.connection.close();
  const errors = totals.phase1.errors || 0;
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  tag("Fatal:", err.message);
  console.error(err);
  process.exit(1);
});
