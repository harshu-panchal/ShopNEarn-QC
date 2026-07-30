/**
 * Inspect Vipul / Shilpaben / Bhanuji placement + counters after binary move.
 *   node scripts/inspect-post-move-counters.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import "../app/models/customer.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";

const PUBLIC_IDS = ["SE96307437", "SE62435417", "SE84271076", "SE84271074"];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  for (const publicId of PUBLIC_IDS) {
    const c = await Customer.findOne({ userId: publicId })
      .select("_id name userId")
      .lean();
    if (!c) {
      console.log(`\n=== ${publicId} NOT FOUND ===`);
      continue;
    }
    const m = await MlmMembership.findOne({ userId: c._id }).lean();
    if (!m) {
      console.log(`\n=== ${c.name} ${publicId} — no membership ===`);
      continue;
    }

    // Live binary subtree sizes
    const leftAgg = m.binaryLeftChildId
      ? await MlmMembership.aggregate([
          { $match: { userId: m.binaryLeftChildId } },
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
        ])
      : [{ n: 0 }];
    const rightAgg = m.binaryRightChildId
      ? await MlmMembership.aggregate([
          { $match: { userId: m.binaryRightChildId } },
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
        ])
      : [{ n: 0 }];

    // Who sits on L/R under this member (bottom-up)
    const [leftChild, rightChild] = await Promise.all([
      MlmMembership.findOne({
        binaryParentId: c._id,
        binaryPosition: "L",
        deletedAt: null,
      })
        .populate("userId", "name userId")
        .lean(),
      MlmMembership.findOne({
        binaryParentId: c._id,
        binaryPosition: "R",
        deletedAt: null,
      })
        .populate("userId", "name userId")
        .lean(),
    ]);

    let sponsorPublic = null;
    if (m.sponsorId) {
      const sp = await Customer.findById(m.sponsorId).select("userId name").lean();
      sponsorPublic = sp ? { name: sp.name, userId: sp.userId } : String(m.sponsorId);
    }
    let binaryParentPublic = null;
    if (m.binaryParentId) {
      const bp = await Customer.findById(m.binaryParentId)
        .select("userId name")
        .lean();
      binaryParentPublic = bp
        ? { name: bp.name, userId: bp.userId }
        : String(m.binaryParentId);
    }

    console.log(`\n=== ${c.name} (${publicId}) ===`);
    console.log({
      membershipId: String(m._id),
      sponsor: sponsorPublic,
      binaryParent: binaryParentPublic,
      binaryPosition: m.binaryPosition,
      topDownLeft: m.binaryLeftChildId ? String(m.binaryLeftChildId) : null,
      topDownRight: m.binaryRightChildId ? String(m.binaryRightChildId) : null,
      bottomUpLeft: leftChild
        ? { name: leftChild.userId?.name, userId: leftChild.userId?.userId }
        : null,
      bottomUpRight: rightChild
        ? { name: rightChild.userId?.name, userId: rightChild.userId?.userId }
        : null,
      liveBinaryLeftSubtree: leftAgg[0]?.n || 0,
      liveBinaryRightSubtree: rightAgg[0]?.n || 0,
      counters: {
        directReferralsCount: m.directReferralsCount,
        totalDownlineCount: m.totalDownlineCount,
        activeDownlineCount: m.activeDownlineCount,
        inactiveDownlineCount: m.inactiveDownlineCount,
        leftLegDirectCount: m.leftLegDirectCount,
        rightLegDirectCount: m.rightLegDirectCount,
        pairsCompleted: m.pairsCompleted,
        lastPaidPairIndex: m.lastPaidPairIndex,
        leftLegTeamActiveCount: m.leftLegTeamActiveCount,
        rightLegTeamActiveCount: m.rightLegTeamActiveCount,
        binaryPairsEligible: m.binaryPairsEligible,
        binaryLeftBalance: m.binaryLeftBalance,
        binaryRightBalance: m.binaryRightBalance,
      },
    });
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
