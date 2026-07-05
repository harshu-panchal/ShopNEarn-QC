/**
 * Restore signup bonuses stuck in CLAWED_BACK after the direct sponsor
 * has since activated. Also previews all affected members.
 *
 * Usage:
 *   node scripts/restore-clawed-signup-bonuses.js
 *   node scripts/restore-clawed-signup-bonuses.js --apply
 *   node scripts/restore-clawed-signup-bonuses.js --apply SE31664406
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Wallet from "../app/models/wallet.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
} from "../app/constants/mlm.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import { restoreClawedSignupBonusesForActivatedSponsors } from "../app/services/mlm/mlmSignupBonusService.js";

dotenv.config();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const referralFilter = args.find(
  (arg) => !arg.startsWith("--") && !arg.endsWith(".js"),
);

await connectDB();

const clawedEvents = await MlmCommissionEvent.find({
  bonusType: {
    $in: [MLM_BONUS_TYPE.SIGNUP_BONUS_SELF, MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR],
  },
  status: MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
}).lean();

const recipientIds = [...new Set(clawedEvents.map((e) => String(e.recipientId)))];
const memberships = await MlmMembership.find({
  userId: { $in: recipientIds },
})
  .select("userId referralCode sponsorId")
  .lean();
const membershipByUser = new Map(memberships.map((m) => [String(m.userId), m]));

const sponsorIds = new Set();
for (const event of clawedEvents) {
  const meta = event.meta || {};
  const mem = membershipByUser.get(String(event.recipientId));
  if (meta.unpaidSponsorUserId) sponsorIds.add(String(meta.unpaidSponsorUserId));
  if (meta.sponsorUserId) sponsorIds.add(String(meta.sponsorUserId));
  if (mem?.sponsorId) sponsorIds.add(String(mem.sponsorId));
  if (event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR) {
    sponsorIds.add(String(event.recipientId));
  }
}

const sponsors = await MlmMembership.find({
  userId: { $in: [...sponsorIds] },
})
  .select("userId referralCode status")
  .lean();
const sponsorByUser = new Map(sponsors.map((s) => [String(s.userId), s]));

const preview = [];
for (const event of clawedEvents) {
  const recipient = membershipByUser.get(String(event.recipientId));
  if (referralFilter && recipient?.referralCode !== referralFilter) continue;

  const meta = event.meta || {};
  const unpaidSponsorUserId =
    meta.unpaidSponsorUserId
    || meta.sponsorUserId
    || (event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SELF
      ? recipient?.sponsorId
      : event.recipientId);

  const sponsor = unpaidSponsorUserId
    ? sponsorByUser.get(String(unpaidSponsorUserId))
    : null;

  const eligible =
    sponsor?.status === MLM_MEMBERSHIP_STATUS.ACTIVE
    && !(await MlmCommissionEvent.exists({
      idempotencyKey: event.idempotencyKey,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    }));

  preview.push({
    referralCode: recipient?.referralCode || String(event.recipientId),
    bonusType: event.bonusType,
    amount: event.bonusAmount || event.clawbackAmount || 0,
    sponsorCode: sponsor?.referralCode || null,
    sponsorStatus: sponsor?.status || null,
    clawbackAt: event.clawbackAt,
    eligible,
  });
}

console.log(`\n${APPLY ? "[APPLY]" : "[DRY-RUN]"} Restore clawed signup bonuses\n`);
console.log(`Clawed signup events: ${clawedEvents.length}`);
console.log(`Eligible for restore: ${preview.filter((row) => row.eligible).length}`);
console.log(JSON.stringify(preview, null, 2));

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to persist.");
  await mongoose.connection.close();
  process.exit(0);
}

const session = await mongoose.startSession();
let result = { restored: [], skipped: [] };

try {
  await session.withTransaction(async () => {
    if (referralFilter) {
      const membership = await MlmMembership.findOne({
        referralCode: referralFilter,
      }).session(session);
      if (!membership) {
        throw new Error(`Referral code not found: ${referralFilter}`);
      }

      result = await restoreClawedSignupBonusesForActivatedSponsors({
        recipientUserId: membership.userId,
        session,
        correlationId: `restore-clawed-signup-${referralFilter}`,
      });
    } else {
      result = await restoreClawedSignupBonusesForActivatedSponsors({
        session,
        correlationId: "restore-clawed-signup-all",
      });
    }
  });
} finally {
  await session.endSession();
}

if (result.restored.length) {
  const restoredRecipients = [...new Set(result.restored.map((r) => r.recipientId))];
  const restoredMemberships = await MlmMembership.find({
    userId: { $in: restoredRecipients },
  })
    .select("userId referralCode")
    .lean();
  const codeByUser = new Map(
    restoredMemberships.map((m) => [String(m.userId), m.referralCode]),
  );

  for (const row of result.restored) {
    const wallet = await Wallet.findOne({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: row.recipientId,
    }).lean();
    console.log(
      `Restored ${codeByUser.get(row.recipientId) || row.recipientId}: +₹${row.amount} shopping (${row.bonusType}) → shopping wallet ₹${wallet?.shoppingBalance ?? "?"}`,
    );
  }
}

console.log(`\nRestored: ${result.restored.length}`);
console.log(`Skipped: ${result.skipped.length}`);
if (result.skipped.length) {
  console.log(JSON.stringify(result.skipped, null, 2));
}

await mongoose.connection.close();
process.exit(0);
