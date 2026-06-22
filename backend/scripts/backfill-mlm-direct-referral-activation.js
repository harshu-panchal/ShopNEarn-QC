/**
 * backfill-mlm-direct-referral-activation.js
 *
 * Credits the one-time first direct-pair activation earnings bonus (default
 * ₹200) to sponsors who already have at least one active direct on each
 * binary leg but never received DIRECT_REFERRAL_ACTIVATION.
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
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import { classifyDirectReferralsByLegUnderRoot } from "../app/services/mlm/mlmBinaryTreeBuilder.js";
import {
  applyDirectReferralActivationBonusStandalone,
  countDirectReferralLegPairsFromLegMap,
  directReferralActivationFirstPairIdempotencyKey,
  shouldCreditFirstDirectReferralPair,
} from "../app/services/mlm/mlmSignupBonusService.js";
import { getDirectReferralActivationConfig } from "../app/services/mlm/mlmConfigService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MIGRATION_ID = "MLM-DRA-BACKFILL-2026";

function tag(...args) {
  console.log("[backfill-mlm-direct-referral-activation]", ...args);
}

async function sponsorAlreadyCredited(sponsorUserId) {
  const firstPairKey = directReferralActivationFirstPairIdempotencyKey(sponsorUserId);
  const existing = await MlmCommissionEvent.findOne({
    $or: [
      { idempotencyKey: firstPairKey, status: MLM_COMMISSION_EVENT_STATUS.CREDITED },
      {
        recipientId: sponsorUserId,
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      },
    ],
  }).lean();
  return Boolean(existing);
}

/**
 * Find the referral whose activation would have completed the first pair
 * (chronological Plan A activations among directs).
 */
async function findFirstPairTriggerReferral(sponsorMembership, activeDirects) {
  const sorted = [...activeDirects].sort((a, b) => {
    const ta = a.planAJoinedAt ? new Date(a.planAJoinedAt).getTime() : 0;
    const tb = b.planAJoinedAt ? new Date(b.planAJoinedAt).getTime() : 0;
    return ta - tb;
  });

  for (const referral of sorted) {
    const pairsBefore = await loadPairCounts(sponsorMembership, {
      excludeUserId: referral.userId,
      activeDirects,
    });
    const pairsAfter = await loadPairCounts(sponsorMembership, {
      activeDirects,
    });
    if (
      shouldCreditFirstDirectReferralPair({
        pairsBefore: pairsBefore.pairs,
        pairsAfter: pairsAfter.pairs,
      })
    ) {
      return referral;
    }
  }
  return sorted[sorted.length - 1] || null;
}

async function loadPairCounts(sponsorMembership, { excludeUserId, activeDirects }) {
  const directs = excludeUserId
    ? activeDirects.filter((d) => String(d.userId) !== String(excludeUserId))
    : activeDirects;
  const legByReferralId = await classifyDirectReferralsByLegUnderRoot({
    rootMembership: sponsorMembership,
    directReferrals: directs,
  });
  return countDirectReferralLegPairsFromLegMap(directs, legByReferralId);
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");

  const cfg = await getDirectReferralActivationConfig();
  if (!cfg.enabled || cfg.sponsorAmount <= 0) {
    tag("Direct referral activation bonus is disabled or zero — aborting.");
    process.exit(1);
  }
  tag(`Amount per first-pair credit: ₹${cfg.sponsorAmount}`);

  const sponsors = await MlmMembership.find({
    status: { $nin: [MLM_MEMBERSHIP_STATUS.SUSPENDED, MLM_MEMBERSHIP_STATUS.TERMINATED] },
  })
    .select("userId status referralCode")
    .lean();

  const totals = {
    sponsorsScanned: sponsors.length,
    alreadyCredited: 0,
    pairNotComplete: 0,
    wouldCredit: 0,
    credited: 0,
    skippedNoTrigger: 0,
    errors: 0,
    totalAmount: 0,
  };

  for (const sponsor of sponsors) {
    const sponsorUserId = sponsor.userId;

    if (await sponsorAlreadyCredited(sponsorUserId)) {
      totals.alreadyCredited += 1;
      continue;
    }

    const activeDirects = await MlmMembership.find({
      sponsorId: sponsorUserId,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      planType: MLM_PLAN_TYPE.A,
    })
      .select("_id userId sponsorId referralCode planAJoinedAt")
      .lean();

    if (!activeDirects.length) {
      totals.pairNotComplete += 1;
      continue;
    }

    const pairsAfter = await loadPairCounts(sponsor, { activeDirects });
    if (pairsAfter.pairs < 1) {
      totals.pairNotComplete += 1;
      if (VERBOSE) {
        tag(
          `SKIP ${sponsor.referralCode} — first pair not complete (L=${pairsAfter.left} R=${pairsAfter.right})`,
        );
      }
      continue;
    }

    const triggerReferral = await findFirstPairTriggerReferral(sponsor, activeDirects);
    if (!triggerReferral) {
      totals.skippedNoTrigger += 1;
      continue;
    }

    if (!APPLY) {
      totals.wouldCredit += 1;
      totals.totalAmount += cfg.sponsorAmount;
      if (VERBOSE) {
        tag(
          `WOULD CREDIT sponsor ${sponsor.referralCode} ₹${cfg.sponsorAmount} (first pair via ${triggerReferral.referralCode})`,
        );
      }
      continue;
    }

    try {
      const res = await applyDirectReferralActivationBonusStandalone({
        activatedUserId: triggerReferral.userId,
        activatedMembership: triggerReferral,
        correlationId: `${MIGRATION_ID}-${String(sponsor.userId)}`,
      });

      if (res?.skipped === "ALREADY_CREDITED") {
        totals.alreadyCredited += 1;
      } else if (res?.skipped) {
        if (VERBOSE) {
          tag(`SKIP ${sponsor.referralCode}: ${res.skipped}`);
        }
      } else if (res?.amount) {
        totals.credited += 1;
        totals.totalAmount += res.amount;
        if (VERBOSE) {
          tag(
            `OK sponsor ${sponsor.referralCode} +₹${res.amount} (first pair via ${triggerReferral.referralCode})`,
          );
        }
      }
    } catch (err) {
      totals.errors += 1;
      tag(
        `ERROR sponsor=${sponsor.referralCode}: ${err.message}`,
      );
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
