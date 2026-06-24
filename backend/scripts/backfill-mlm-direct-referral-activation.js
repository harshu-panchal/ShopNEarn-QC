/**
 * backfill-mlm-direct-referral-activation.js
 *
 * Backfills both direct-referral earnings flows:
 *   1. Per-direct Plan A activation income (each active direct)
 *   2. First direct L+R pair income (one-time per sponsor)
 *
 * Usage:
 *   node backend/scripts/backfill-mlm-direct-referral-activation.js
 *   node backend/scripts/backfill-mlm-direct-referral-activation.js --apply
 *   node backend/scripts/backfill-mlm-direct-referral-activation.js --apply --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import "../app/models/customer.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import { classifyDirectReferralsByLegUnderRoot } from "../app/services/mlm/mlmBinaryTreeBuilder.js";
import {
  applyDirectReferralFirstPairBonusStandalone,
  applyDirectReferralPerActivationBonusStandalone,
  countDirectReferralLegPairsFromLegMap,
  directReferralActivationFirstPairIdempotencyKey,
  directReferralPerActivationIdempotencyKey,
} from "../app/services/mlm/mlmSignupBonusService.js";
import { getDirectReferralActivationConfig } from "../app/services/mlm/mlmConfigService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MIGRATION_ID = "MLM-DRA-BACKFILL-2026";

function tag(...args) {
  console.log("[backfill-mlm-direct-referral-activation]", ...args);
}

async function perActivationAlreadyCredited(sponsorUserId, activatedUserId) {
  const keys = [
    directReferralPerActivationIdempotencyKey(sponsorUserId, activatedUserId),
    `${MLM_IDEMPOTENCY_PREFIX.DIRECT_REFERRAL_ACTIVATION}-${String(sponsorUserId)}-${String(activatedUserId)}`,
  ];
  const existing = await MlmCommissionEvent.findOne({
    idempotencyKey: { $in: keys },
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
  }).lean();
  return Boolean(existing);
}

async function firstPairAlreadyCredited(sponsorUserId) {
  const key = directReferralActivationFirstPairIdempotencyKey(sponsorUserId);
  const existing = await MlmCommissionEvent.findOne({
    idempotencyKey: key,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
  }).lean();
  return Boolean(existing);
}

async function loadPairCounts(sponsorMembership, activeDirects) {
  const legByReferralId = await classifyDirectReferralsByLegUnderRoot({
    rootMembership: sponsorMembership,
    directReferrals: activeDirects,
  });
  return countDirectReferralLegPairsFromLegMap(activeDirects, legByReferralId);
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");

  const cfg = await getDirectReferralActivationConfig();
  if (!cfg.enabled) {
    tag("Direct referral activation bonus is disabled — aborting.");
    process.exit(1);
  }

  const activeReferrals = await MlmMembership.find({
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
    sponsorId: { $ne: null },
  })
    .select("_id userId sponsorId referralCode planAJoinedAt")
    .lean();

  const sponsorIds = [...new Set(activeReferrals.map((m) => String(m.sponsorId)))];
  const sponsors = await MlmMembership.find({
    userId: { $in: sponsorIds },
  })
    .select("userId status referralCode")
    .lean();
  const sponsorByUserId = new Map(sponsors.map((s) => [String(s.userId), s]));

  const totals = {
    perActivationScanned: activeReferrals.length,
    perActivationWouldCredit: 0,
    perActivationCredited: 0,
    perActivationSkipped: 0,
    firstPairSponsorsScanned: sponsorIds.length,
    firstPairWouldCredit: 0,
    firstPairCredited: 0,
    firstPairSkipped: 0,
    errors: 0,
    totalAmount: 0,
  };

  tag("--- Phase 1: per-direct activation income ---");
  for (const referral of activeReferrals) {
    const sponsor = sponsorByUserId.get(String(referral.sponsorId));
    if (!sponsor || sponsor.status === MLM_MEMBERSHIP_STATUS.SUSPENDED
      || sponsor.status === MLM_MEMBERSHIP_STATUS.TERMINATED) {
      totals.perActivationSkipped += 1;
      continue;
    }
    if (!cfg.perActivation.enabled || cfg.perActivation.amount <= 0) {
      continue;
    }
    if (await perActivationAlreadyCredited(sponsor.userId, referral.userId)) {
      totals.perActivationSkipped += 1;
      continue;
    }

    if (!APPLY) {
      totals.perActivationWouldCredit += 1;
      totals.totalAmount += cfg.perActivation.amount;
      if (VERBOSE) {
        tag(
          `WOULD CREDIT per-activation sponsor ${sponsor.referralCode} +₹${cfg.perActivation.amount} for ${referral.referralCode}`,
        );
      }
      continue;
    }

    try {
      const res = await applyDirectReferralPerActivationBonusStandalone({
        activatedUserId: referral.userId,
        activatedMembership: referral,
        correlationId: `${MIGRATION_ID}-PER-${String(referral._id)}`,
      });
      if (res?.skipped === "ALREADY_CREDITED") {
        totals.perActivationSkipped += 1;
      } else if (res?.skipped) {
        if (VERBOSE) tag(`SKIP per ${referral.referralCode}: ${res.skipped}`);
      } else if (res?.amount) {
        totals.perActivationCredited += 1;
        totals.totalAmount += res.amount;
        if (VERBOSE) {
          tag(`OK per-activation ${sponsor.referralCode} +₹${res.amount} (${referral.referralCode})`);
        }
      }
    } catch (err) {
      totals.errors += 1;
      tag(`ERROR per ${referral.referralCode}: ${err.message}`);
    }
  }

  tag("--- Phase 2: first direct pair income ---");
  for (const sponsor of sponsors) {
    if (
      sponsor.status === MLM_MEMBERSHIP_STATUS.SUSPENDED
      || sponsor.status === MLM_MEMBERSHIP_STATUS.TERMINATED
    ) {
      totals.firstPairSkipped += 1;
      continue;
    }
    if (!cfg.firstPair.enabled || cfg.firstPair.amount <= 0) {
      continue;
    }
    if (await firstPairAlreadyCredited(sponsor.userId)) {
      totals.firstPairSkipped += 1;
      continue;
    }

    const activeDirects = await MlmMembership.find({
      sponsorId: sponsor.userId,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      planType: MLM_PLAN_TYPE.A,
    })
      .select("_id userId")
      .lean();

    const legPairs = await loadPairCounts(sponsor, activeDirects);
    if (legPairs.pairs < 1) {
      totals.firstPairSkipped += 1;
      continue;
    }

    const triggerReferral = activeDirects[0];

    if (!APPLY) {
      totals.firstPairWouldCredit += 1;
      totals.totalAmount += cfg.firstPair.amount;
      if (VERBOSE) {
        tag(`WOULD CREDIT first-pair ${sponsor.referralCode} +₹${cfg.firstPair.amount}`);
      }
      continue;
    }

    try {
      const res = await applyDirectReferralFirstPairBonusStandalone({
        activatedUserId: triggerReferral.userId,
        activatedMembership: triggerReferral,
        correlationId: `${MIGRATION_ID}-PAIR-${String(sponsor.userId)}`,
        backfill: true,
      });
      if (res?.skipped === "ALREADY_CREDITED") {
        totals.firstPairSkipped += 1;
      } else if (res?.skipped) {
        if (VERBOSE) tag(`SKIP first-pair ${sponsor.referralCode}: ${res.skipped}`);
      } else if (res?.amount) {
        totals.firstPairCredited += 1;
        totals.totalAmount += res.amount;
        if (VERBOSE) tag(`OK first-pair ${sponsor.referralCode} +₹${res.amount}`);
      }
    } catch (err) {
      totals.errors += 1;
      tag(`ERROR first-pair ${sponsor.referralCode}: ${err.message}`);
    }
  }

  tag("Summary:", JSON.stringify(totals, null, 2));
  await mongoose.disconnect();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[backfill-mlm-direct-referral-activation] FATAL:", err);
  process.exit(1);
});
