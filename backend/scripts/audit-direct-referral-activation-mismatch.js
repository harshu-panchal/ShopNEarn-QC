/**
 * Audit direct-referral per-activation income vs active direct referrals.
 *
 *   node scripts/audit-direct-referral-activation-mismatch.js
 *   node scripts/audit-direct-referral-activation-mismatch.js --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
} from "../app/constants/mlm.js";
import {
  directReferralPerActivationIdempotencyKey,
  isLegacyPerActivationDirectReferralCredit,
  LEGACY_PER_ACTIVATION_DRA_KEY_RE,
} from "../app/services/mlm/mlmSignupBonusService.js";

dotenv.config();

const VERBOSE = process.argv.includes("--verbose");
const TOP_N = 20;

function tag(...args) {
  console.log("[audit-drpa]", ...args);
}

async function main() {
  await connectDB();

  // ── 1. Remaining legacy mislabeled events (post-migration) ─────────
  const legacyMislabeled = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    idempotencyKey: { $regex: LEGACY_PER_ACTIVATION_DRA_KEY_RE },
  }).lean();

  const firstPairKeys = await MlmCommissionEvent.countDocuments({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    idempotencyKey: { $regex: /FIRST-DIRECT-PAIR$/ },
  });

  const restoreFirstPair = await MlmCommissionEvent.countDocuments({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    idempotencyKey: { $regex: /RESTORE/i },
  });

  // ── 2. Per-sponsor: active directs vs credited per-activation ─────
  const activeSponsors = await MlmMembership.find(
    { status: MLM_MEMBERSHIP_STATUS.ACTIVE },
    { userId: 1, referralCode: 1, directReferralsCount: 1 },
  ).lean();

  const allDirects = await MlmMembership.find(
    {
      sponsorId: { $ne: null },
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    },
    { userId: 1, sponsorId: 1, referralCode: 1, status: 1 },
  ).lean();

  const directsBySponsor = new Map();
  for (const d of allDirects) {
    const sid = String(d.sponsorId);
    if (!directsBySponsor.has(sid)) directsBySponsor.set(sid, []);
    directsBySponsor.get(sid).push(d);
  }

  const perActivationEvents = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
  })
    .select("recipientId sourceUserId idempotencyKey bonusAmount cappedAmount")
    .lean();

  const legacyStillDrpa = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    idempotencyKey: { $regex: LEGACY_PER_ACTIVATION_DRA_KEY_RE },
  })
    .select("recipientId sourceUserId idempotencyKey")
    .lean();

  // Build credited set per sponsor: DRPA events + unmigrated legacy DRA per-user
  const creditedBySponsor = new Map();
  function markCredited(sponsorId, activatedUserId) {
    const sid = String(sponsorId);
    if (!creditedBySponsor.has(sid)) creditedBySponsor.set(sid, new Set());
    creditedBySponsor.get(sid).add(String(activatedUserId));
  }

  for (const e of perActivationEvents) {
    if (e.sourceUserId) markCredited(e.recipientId, e.sourceUserId);
  }
  for (const e of legacyStillDrpa) {
    if (e.sourceUserId) markCredited(e.recipientId, e.sourceUserId);
  }

  const mismatchRows = [];
  let sponsorsWithDirects = 0;
  let sponsorsFullyPaid = 0;
  let sponsorsWithGap = 0;
  let totalMissingCredits = 0;

  for (const sponsor of activeSponsors) {
    const sid = String(sponsor.userId);
    const directs = directsBySponsor.get(sid) || [];
    if (directs.length === 0) continue;

    sponsorsWithDirects += 1;
    const credited = creditedBySponsor.get(sid) || new Set();
    const missing = directs.filter((d) => !credited.has(String(d.userId)));

    if (missing.length === 0) {
      sponsorsFullyPaid += 1;
      continue;
    }

    sponsorsWithGap += 1;
    totalMissingCredits += missing.length;

    mismatchRows.push({
      referralCode: sponsor.referralCode,
      userId: sid,
      activeDirects: directs.length,
      creditedPerActivation: credited.size,
      missingCount: missing.length,
      missingReferrals: missing.map((d) => ({
        code: d.referralCode,
        userId: String(d.userId),
      })),
    });
  }

  mismatchRows.sort((a, b) => b.missingCount - a.missingCount);

  // ── 3. Display-type drift: raw byType vs normalized (unmigrated legacy) ─
  const sponsorsWithLegacyDisplayDrift = await MlmCommissionEvent.aggregate([
    {
      $match: {
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        walletBucket: { $in: ["earnings", "pending"] },
        idempotencyKey: { $regex: LEGACY_PER_ACTIVATION_DRA_KEY_RE.source },
      },
    },
    { $group: { _id: "$recipientId", count: { $sum: 1 }, total: { $sum: "$cappedAmount" } } },
    { $sort: { count: -1 } },
  ]);

  const migratedCount = await MlmCommissionEvent.countDocuments({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
    "meta.migratedFromLegacyDraKey": { $exists: true },
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
  });

  const report = {
    scannedAt: new Date().toISOString(),
    legacyMislabeledRemaining: legacyMislabeled.length,
    migratedToDrpa: migratedCount,
    firstPairCredits: firstPairKeys,
    restoreFirstPairCredits: restoreFirstPair,
    totalDrpaCredited: perActivationEvents.length,
    sponsorsWithActiveDirects: sponsorsWithDirects,
    sponsorsFullyCredited: sponsorsFullyPaid,
    sponsorsWithMissingPerActivation: sponsorsWithGap,
    totalMissingPerActivationCredits: totalMissingCredits,
    sponsorsWithLegacyDisplayDrift: sponsorsWithLegacyDisplayDrift.length,
    topMissing: mismatchRows.slice(0, TOP_N),
  };

  console.log(JSON.stringify(report, null, 2));

  const migratedByRecipient = await MlmCommissionEvent.aggregate([
    {
      $match: {
        "meta.migratedFromLegacyDraKey": { $exists: true },
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      },
    },
    { $group: { _id: "$recipientId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  if (migratedByRecipient.length > 0) {
    const mems = await MlmMembership.find({
      userId: { $in: migratedByRecipient.map((r) => r._id) },
    })
      .select("userId referralCode")
      .lean();
    const codeBy = new Map(mems.map((m) => [String(m.userId), m.referralCode]));

    tag(
      `\nMembers who had legacy mislabeled per-activation credits (${migratedByRecipient.length} sponsors):`,
    );
    for (const row of migratedByRecipient.slice(0, TOP_N)) {
      tag(
        `  ${codeBy.get(String(row._id)) || row._id}: ${row.count} event(s) reclassified`,
      );
    }
    if (migratedByRecipient.length > TOP_N) {
      tag(`  ... and ${migratedByRecipient.length - TOP_N} more`);
    }
  }

  if (VERBOSE && mismatchRows.length) {
    tag("\nAll sponsors with gaps:");
    for (const row of mismatchRows) {
      tag(
        `${row.referralCode}: ${row.activeDirects} directs, ${row.creditedPerActivation} credited, missing ${row.missingCount}`,
        row.missingReferrals.map((m) => m.code).join(", "),
      );
    }
  }

  await mongoose.connection.close();
}

main().catch((err) => {
  tag("Fatal:", err.message);
  process.exit(1);
});
