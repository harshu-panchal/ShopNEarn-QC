/**
 * Inspect (and optionally execute) moving Shilpaben SE62435417 under Vipul SE96307437 right leg.
 *
 *   node scripts/inspect-binary-move-shilpaben-vipul.js
 *   node scripts/inspect-binary-move-shilpaben-vipul.js --commit
 */
import "dotenv/config";
import mongoose from "mongoose";

import "../app/models/customer.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import {
  previewBinaryMove,
  executeBinaryMove,
} from "../app/services/mlm/mlmBinaryMoveService.js";

const VIPUL_PUBLIC = "SE96307437";
const SHILPA_PUBLIC = "SE62435417";
const COMMIT = process.argv.includes("--commit");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const [vipulC, shilpaC] = await Promise.all([
    Customer.findOne({ userId: VIPUL_PUBLIC }).select("_id name userId").lean(),
    Customer.findOne({ userId: SHILPA_PUBLIC }).select("_id name userId").lean(),
  ]);
  console.log("Customers:", { vipulC, shilpaC });
  if (!vipulC || !shilpaC) {
    await mongoose.disconnect();
    process.exit(1);
  }

  const [vipulM, shilpaM] = await Promise.all([
    MlmMembership.findOne({ userId: vipulC._id })
      .populate("userId", "name userId")
      .lean(),
    MlmMembership.findOne({ userId: shilpaC._id })
      .populate("userId", "name userId")
      .lean(),
  ]);

  console.log("\n=== Vipul ===");
  console.log({
    membershipId: String(vipulM?._id),
    name: vipulM?.userId?.name,
    binaryLeftChildId: vipulM?.binaryLeftChildId,
    binaryRightChildId: vipulM?.binaryRightChildId,
  });

  console.log("\n=== Shilpaben ===");
  console.log({
    membershipId: String(shilpaM?._id),
    name: shilpaM?.userId?.name,
    binaryParentId: shilpaM?.binaryParentId,
    binaryPosition: shilpaM?.binaryPosition,
    sponsorId: shilpaM?.sponsorId,
  });

  if (shilpaM?.binaryParentId) {
    const oldP = await MlmMembership.findOne({ userId: shilpaM.binaryParentId })
      .populate("userId", "name userId")
      .lean();
    console.log("Current binary parent:", {
      name: oldP?.userId?.name,
      publicId: oldP?.userId?.userId,
    });
  }

  const occupant = await MlmMembership.findOne({
    binaryParentId: vipulC._id,
    binaryPosition: "R",
    deletedAt: null,
  })
    .populate("userId", "name userId")
    .lean();
  console.log("\nVipul R slot (bottom-up):", occupant
    ? { name: occupant.userId?.name, publicId: occupant.userId?.userId }
    : "EMPTY");

  const agg = await MlmMembership.aggregate([
    { $match: { userId: shilpaC._id } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
      },
    },
  ]);
  const subtreeSize = (agg[0]?.descendants?.length || 0) + 1;
  console.log("\nShilpaben binary subtree size:", subtreeSize);

  const preview = await previewBinaryMove({
    membershipId: shilpaM._id,
    newParentMembershipId: vipulM._id,
    leg: "R",
    changeSponsorToNewParent: false,
  });
  console.log("\n=== Preview (binary only, sponsor unchanged) ===");
  console.log(JSON.stringify(preview, null, 2));

  if (COMMIT) {
    const result = await executeBinaryMove({
      membershipId: shilpaM._id,
      newParentMembershipId: vipulM._id,
      leg: "R",
      changeSponsorToNewParent: false,
      adminId: null,
      reason: "Admin request: Shilpaben subtree to Vipul right leg",
    });
    console.log("\n=== EXECUTED ===");
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("\nDry-run only. Pass --commit to apply.");
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
