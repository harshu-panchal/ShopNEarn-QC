import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import { reconcileDirectReferralActivationIncomeOnSponsorChange } from "../app/services/mlm/mlmSignupBonusService.js";

const MEMBER_PUBLIC = "SE24347887"; // Meena Sisodia
const OLD_SPONSOR_ID = "6a71ea489f7445328efb05a6"; // Gajjar Dinaben Jagdishbhai (SE98657305)
const NEW_SPONSOR_ID = "6a74545a1ffff322f2a60a5d"; // Seema Kashyap (SE91147436) — current sponsor

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
  if (String(membership.sponsorId) !== NEW_SPONSOR_ID) {
    console.error(
      `Safety check failed: member's current sponsorId (${membership.sponsorId}) does not match expected NEW_SPONSOR_ID (${NEW_SPONSOR_ID}). Aborting.`,
    );
    process.exit(1);
  }

  console.log(`Reconciling DIRECT_REFERRAL_PER_ACTIVATION income for ${memberUser.name} (${MEMBER_PUBLIC})...`);
  console.log(`  Reversing credit from old sponsor: ${OLD_SPONSOR_ID}`);
  console.log(`  New sponsor (already correctly credited, idempotent no-op expected): ${NEW_SPONSOR_ID}\n`);

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      result = await reconcileDirectReferralActivationIncomeOnSponsorChange({
        memberUserId: memberUser._id,
        oldSponsorUserId: OLD_SPONSOR_ID,
        newSponsorUserId: NEW_SPONSOR_ID,
        adminId: null,
        reason: "Manual correction: sponsor changed after activation income was already credited to old sponsor; old sponsor's credit was reversed and the (already-existing) new-sponsor credit left intact.",
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  console.log("=== RESULT ===");
  console.log(result);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
