/**
 * Fix signup bonuses credited while the direct sponsor was still unpaid.
 *
 *   • Sponsor still REGISTERED_UNPAID → claw back wallet credits, create HELD events
 *   • Sponsor ACTIVE → release any HELD signup bonuses for that sponsor
 *
 * Usage:
 *   node scripts/fix-signup-bonus-unpaid-sponsor-hold.js
 *   node scripts/fix-signup-bonus-unpaid-sponsor-hold.js --apply
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import MlmMembership from "../app/models/mlmMembership.js";
import { MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";
import {
  reclawSignupBonusesForUnpaidSponsor,
  releaseHeldSignupBonusesForSponsorActivation,
  restoreClawedSignupBonusesForActivatedSponsors,
} from "../app/services/mlm/mlmSignupBonusService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n${APPLY ? "[APPLY]" : "[DRY-RUN]"} Fix signup bonuses for unpaid sponsors\n`);

const memberships = await MlmMembership.find({
  sponsorId: { $ne: null },
}).lean();

const memByUser = new Map(memberships.map((m) => [String(m.userId), m]));

let clawTargets = 0;
let clawEvents = 0;
let releaseTargets = 0;

const sponsorIds = new Set(memberships.map((m) => String(m.sponsorId)).filter(Boolean));
const sponsorMems = await MlmMembership.find({
  userId: { $in: [...sponsorIds] },
}).lean();
const sponsorByUser = new Map(sponsorMems.map((m) => [String(m.userId), m]));

for (const sponsor of sponsorMems) {
  if (sponsor.status === MLM_MEMBERSHIP_STATUS.ACTIVE) {
    releaseTargets += 1;
  }
}

for (const referral of memberships) {
  if (!referral.sponsorId) continue;
  const sponsor = sponsorByUser.get(String(referral.sponsorId));
  if (!sponsor) continue;
  if (sponsor.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID) {
    clawTargets += 1;
  }
}

console.log(`Referrals with unpaid sponsor (clawback targets): ${clawTargets}`);
console.log(`Active sponsors (release held bonuses): ${releaseTargets}`);

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to persist.");
  await mongoose.disconnect();
  process.exit(0);
}

const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    for (const referral of memberships) {
      if (!referral.sponsorId) continue;
      const sponsor = sponsorByUser.get(String(referral.sponsorId));
      if (!sponsor) continue;
      if (sponsor.status !== MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID) continue;

      const liveReferral = await MlmMembership.findById(referral._id).session(session);
      const liveSponsor = await MlmMembership.findById(sponsor._id).session(session);
      const res = await reclawSignupBonusesForUnpaidSponsor({
        referralUserId: referral.userId,
        referralMembership: liveReferral,
        sponsorUserId: sponsor.userId,
        sponsorMembership: liveSponsor,
        session,
        correlationId: `fix-unpaid-sponsor-hold-${String(referral._id)}`,
      });
      clawEvents += res.clawed || 0;
    }

    for (const sponsor of sponsorMems) {
      if (sponsor.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) continue;
      await releaseHeldSignupBonusesForSponsorActivation({
        sponsorUserId: sponsor.userId,
        session,
        correlationId: `fix-unpaid-sponsor-release-${String(sponsor._id)}`,
      });
    }

    const restoreResult = await restoreClawedSignupBonusesForActivatedSponsors({
      session,
      correlationId: "fix-unpaid-sponsor-restore-clawed",
    });
    console.log(
      `Restored ${restoreResult.restored.length} clawed signup bonus event(s).`,
    );
  });
} finally {
  await session.endSession();
}

console.log(`\nClawed back ${clawEvents} credited signup bonus event(s).`);
console.log(`Released held signup bonuses for ${releaseTargets} active sponsor(s).`);
await mongoose.disconnect();
