/**
 * backfill-mlm-direct-referral-activation.js
 *
 * Credits the one-time direct-referral activation earnings bonus (default
 * ₹200) to every sponsor whose referral is already ACTIVE Plan A but
 * never received `DIRECT_REFERRAL_ACTIVATION` when the feature shipped.
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
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import {
  applyDirectReferralActivationBonusStandalone,
} from "../app/services/mlm/mlmSignupBonusService.js";
import { getDirectReferralActivationConfig } from "../app/services/mlm/mlmConfigService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MIGRATION_ID = "MLM-DRA-BACKFILL-2026";

function tag(...args) {
  console.log("[backfill-mlm-direct-referral-activation]", ...args);
}

function idempotencyKey(sponsorUserId, activatedUserId) {
  return `${MLM_IDEMPOTENCY_PREFIX.DIRECT_REFERRAL_ACTIVATION}-${String(sponsorUserId)}-${String(activatedUserId)}`;
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");

  const cfg = await getDirectReferralActivationConfig();
  if (!cfg.enabled || cfg.sponsorAmount <= 0) {
    tag("Direct referral activation bonus is disabled or zero — aborting.");
    process.exit(1);
  }
  tag(`Amount per credit: ₹${cfg.sponsorAmount}`);

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
  const sponsorByUserId = new Map(
    sponsors.map((s) => [String(s.userId), s]),
  );

  const totals = {
    scanned: activeReferrals.length,
    alreadyCredited: 0,
    wouldCredit: 0,
    credited: 0,
    skippedNoSponsor: 0,
    skippedSponsorIneligible: 0,
    skippedSelfReferral: 0,
    errors: 0,
    totalAmount: 0,
  };

  for (const referral of activeReferrals) {
    const activatedUserId = referral.userId;
    const sponsorUserId = referral.sponsorId;

    if (String(sponsorUserId) === String(activatedUserId)) {
      totals.skippedSelfReferral += 1;
      continue;
    }

    const sponsor = sponsorByUserId.get(String(sponsorUserId));
    if (!sponsor) {
      totals.skippedNoSponsor += 1;
      if (VERBOSE) {
        tag(
          `SKIP ${referral.referralCode} — sponsor ${String(sponsorUserId)} missing`,
        );
      }
      continue;
    }
    if (
      sponsor.status === MLM_MEMBERSHIP_STATUS.SUSPENDED ||
      sponsor.status === MLM_MEMBERSHIP_STATUS.TERMINATED
    ) {
      totals.skippedSponsorIneligible += 1;
      continue;
    }

    const key = idempotencyKey(sponsorUserId, activatedUserId);
    const existing = await MlmCommissionEvent.findOne({
      idempotencyKey: key,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    }).lean();

    if (existing) {
      totals.alreadyCredited += 1;
      continue;
    }

    if (!APPLY) {
      totals.wouldCredit += 1;
      totals.totalAmount += cfg.sponsorAmount;
      if (VERBOSE) {
        tag(
          `WOULD CREDIT sponsor ${sponsor.referralCode} ₹${cfg.sponsorAmount} for referral ${referral.referralCode}`,
        );
      }
      continue;
    }

    try {
      const res = await applyDirectReferralActivationBonusStandalone({
        activatedUserId,
        activatedMembership: referral,
        correlationId: `${MIGRATION_ID}-${String(referral._id)}`,
      });

      if (res?.skipped === "ALREADY_CREDITED") {
        totals.alreadyCredited += 1;
      } else if (res?.skipped) {
        if (VERBOSE) {
          tag(`SKIP ${referral.referralCode}: ${res.skipped}`);
        }
      } else if (res?.amount) {
        totals.credited += 1;
        totals.totalAmount += res.amount;
        if (VERBOSE) {
          tag(
            `OK sponsor ${sponsor.referralCode} +₹${res.amount} for ${referral.referralCode}`,
          );
        }
      }
    } catch (err) {
      totals.errors += 1;
      tag(
        `ERROR referral=${referral.referralCode} sponsor=${sponsor.referralCode}: ${err.message}`,
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
