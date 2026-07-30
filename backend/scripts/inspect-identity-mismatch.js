/**
 * Resolve Vipul / Shilpaben by name, public userId, membership referralCode, ObjectId.
 */
import "dotenv/config";
import mongoose from "mongoose";
import "../app/models/customer.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";

async function dumpMember(label, m) {
  if (!m) {
    console.log(label, "NOT FOUND");
    return;
  }
  const u = m.userId;
  console.log(label, {
    membershipId: String(m._id),
    referralCode: m.referralCode,
    userObjectId: String(u?._id || u),
    name: u?.name,
    publicUserId: u?.userId,
    binaryParentId: m.binaryParentId ? String(m.binaryParentId) : null,
    binaryPosition: m.binaryPosition,
    binaryLeftChildId: m.binaryLeftChildId ? String(m.binaryLeftChildId) : null,
    binaryRightChildId: m.binaryRightChildId ? String(m.binaryRightChildId) : null,
    sponsorId: m.sponsorId ? String(m.sponsorId) : null,
    leftLegTeamActiveCount: m.leftLegTeamActiveCount,
    rightLegTeamActiveCount: m.rightLegTeamActiveCount,
    totalDownlineCount: m.totalDownlineCount,
    leftLegDirectCount: m.leftLegDirectCount,
    rightLegDirectCount: m.rightLegDirectCount,
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  console.log("\n--- By Customer.userId ---");
  for (const pid of ["SE96307437", "SE62435417", "SE84271076", "SE84271074"]) {
    const c = await Customer.findOne({ userId: pid }).lean();
    console.log(pid, c ? { _id: String(c._id), name: c.name, userId: c.userId } : null);
  }

  console.log("\n--- Name search ---");
  const byName = await Customer.find({
    name: { $regex: /(vipul|shilpaben|bhanuji)/i },
  })
    .select("_id name userId")
    .lean();
  console.log(byName);

  console.log("\n--- Memberships by referralCode ---");
  for (const code of ["SE96307437", "SE62435417", "SE84271076", "SE84271074"]) {
    const m = await MlmMembership.findOne({ referralCode: code })
      .populate("userId", "name userId")
      .lean();
    await dumpMember(`referralCode ${code}`, m);
  }

  console.log("\n--- Memberships by known ObjectIds from prior move ---");
  for (const id of [
    "6a5226a0243134fa63cdf50d", // was Vipul membership
    "6a5ccc48a029e7d84e90be56", // was Shilpaben membership
    "6a5226a0243134fa63cdf509", // was Vipul customer
    "6a5ccc33a029e7d84e90be41", // was Shilpaben customer
  ]) {
    const m = await MlmMembership.findById(id).populate("userId", "name userId").lean();
    if (m) await dumpMember(`membership ${id}`, m);
    else {
      const c = await Customer.findById(id).select("name userId").lean();
      console.log(`id ${id} customer:`, c);
      if (c) {
        const mm = await MlmMembership.findOne({ userId: c._id })
          .populate("userId", "name userId")
          .lean();
        await dumpMember(`membership for customer ${id}`, mm);
      }
    }
  }

  // Who has Shilpaben as binary right child of someone named Vipul?
  const vipulLike = await Customer.find({ name: /vipul/i }).select("_id name userId").lean();
  console.log("\n--- Vipul-like customers ---", vipulLike);
  for (const v of vipulLike) {
    const m = await MlmMembership.findOne({ userId: v._id })
      .populate("userId", "name userId")
      .lean();
    await dumpMember("Vipul membership", m);
    if (m?.binaryRightChildId) {
      const child = await Customer.findById(m.binaryRightChildId)
        .select("name userId")
        .lean();
      console.log("  right child customer:", child);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
