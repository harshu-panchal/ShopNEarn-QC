/**
 * Find Chavda / Falguni / Bhavesh and dump placement relevant to screenshots.
 */
import "dotenv/config";
import mongoose from "mongoose";
import "../app/models/customer.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";

async function subtreeSize(rootUserId) {
  if (!rootUserId) return 0;
  const agg = await MlmMembership.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(rootUserId)) } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "d",
      },
    },
    { $project: { n: { $add: [{ $size: "$d" }, 1] } } },
  ]);
  return agg[0]?.n || 0;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("DB:", (process.env.MONGODB_URI || process.env.MONGO_URI || "").replace(/:\/\/[^@]+@/, "://***@"));

  const hits = await Customer.find({
    $or: [
      { name: /bhanukant|chavda|falguni|bhaveshkumar|raghjibhai prajapati/i },
      { userId: { $in: ["SE96307437", "SE62435417", "SE38102364", "SE10762512", "SE38162364"] } },
    ],
  })
    .select("_id name userId phone email")
    .lean();
  console.log("\nHits:", hits);

  for (const c of hits) {
    const m = await MlmMembership.findOne({ userId: c._id }).lean();
    if (!m) {
      console.log(c.userId, "no membership");
      continue;
    }
    console.log("\n", c.name, c.userId, {
      membershipId: String(m._id),
      referralCode: m.referralCode,
      binaryParentId: m.binaryParentId ? String(m.binaryParentId) : null,
      binaryPosition: m.binaryPosition,
      L: m.binaryLeftChildId ? String(m.binaryLeftChildId) : null,
      R: m.binaryRightChildId ? String(m.binaryRightChildId) : null,
      sponsorId: m.sponsorId ? String(m.sponsorId) : null,
      liveL: await subtreeSize(m.binaryLeftChildId),
      liveR: await subtreeSize(m.binaryRightChildId),
      totalDownlineCount: m.totalDownlineCount,
      directReferralsCount: m.directReferralsCount,
      leftLegDirectCount: m.leftLegDirectCount,
      rightLegDirectCount: m.rightLegDirectCount,
      leftLegTeamActiveCount: m.leftLegTeamActiveCount,
      rightLegTeamActiveCount: m.rightLegTeamActiveCount,
      pairsCompleted: m.pairsCompleted,
    });
  }

  // Who still has SE96307437 anywhere?
  const any963 = await Customer.find({
    $or: [{ userId: "SE96307437" }, { name: /Vipul Bhanukant/i }],
  }).lean();
  const mem963 = await MlmMembership.find({
    $or: [{ referralCode: "SE96307437" }],
  }).lean();
  console.log("\nSE96307437 remnants customers", any963.length, "memberships", mem963.length);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
