import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import { MLM_BONUS_TYPE, MLM_COMMISSION_EVENT_STATUS } from "../app/constants/mlm.js";

const MEMBER_PUBLIC = "SE24347887"; // Meena Sisodia

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI is missing in environment");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected.\n");

  const memberUser = await Customer.findOne({ userId: MEMBER_PUBLIC })
    .select("_id name userId")
    .lean();
  if (!memberUser) {
    console.error(`Member ${MEMBER_PUBLIC} not found!`);
    process.exit(1);
  }

  const membership = await MlmMembership.findOne({ userId: memberUser._id }).lean();
  if (!membership) {
    console.error(`MlmMembership not found for ${MEMBER_PUBLIC}`);
    process.exit(1);
  }

  const currentSponsorUser = membership.sponsorId
    ? await Customer.findById(membership.sponsorId).select("_id name userId").lean()
    : null;

  console.log("=== MEMBER ===");
  console.log({
    name: memberUser.name,
    userId: memberUser.userId,
    membershipId: String(membership._id),
    membershipStatus: membership.status,
    currentSponsor: currentSponsorUser
      ? { name: currentSponsorUser.name, userId: currentSponsorUser.userId, _id: String(currentSponsorUser._id) }
      : "None",
  });

  const events = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_PER_ACTIVATION,
    sourceUserId: memberUser._id,
  })
    .sort({ createdAt: 1 })
    .lean();

  console.log(`\n=== DIRECT_REFERRAL_PER_ACTIVATION events sourced from ${MEMBER_PUBLIC} (${events.length}) ===`);
  for (const ev of events) {
    const recipient = await Customer.findById(ev.recipientId).select("name userId").lean();
    const isStale =
      ev.status === MLM_COMMISSION_EVENT_STATUS.CREDITED &&
      currentSponsorUser &&
      String(ev.recipientId) !== String(currentSponsorUser._id);
    console.log({
      eventId: String(ev._id),
      recipient: recipient ? `${recipient.name} (${recipient.userId})` : String(ev.recipientId),
      recipientId: String(ev.recipientId),
      status: ev.status,
      bonusAmount: ev.bonusAmount,
      cappedAmount: ev.cappedAmount,
      walletBucket: ev.walletBucket,
      createdAt: ev.createdAt,
      clawbackAt: ev.clawbackAt || null,
      MISMATCHES_CURRENT_SPONSOR: isStale,
    });
  }

  if (currentSponsorUser) {
    const { getOrCreateWallet } = await import("../app/services/finance/walletService.js");
    const { OWNER_TYPE } = await import("../app/constants/finance.js");
    for (const ev of events) {
      if (
        ev.status === MLM_COMMISSION_EVENT_STATUS.CREDITED &&
        String(ev.recipientId) !== String(currentSponsorUser._id)
      ) {
        const oldSponsorWallet = await getOrCreateWallet(OWNER_TYPE.CUSTOMER, ev.recipientId, {});
        console.log(`\nOld sponsor (${String(ev.recipientId)}) wallet balances:`, {
          earningsBalance: oldSponsorWallet.earningsBalance,
          availableBalance: oldSponsorWallet.availableBalance,
          pendingBalance: oldSponsorWallet.pendingBalance,
        });
      }
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
