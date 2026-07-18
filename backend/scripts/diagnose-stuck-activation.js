/**
 * READ-ONLY deep check for "member activated below X but no matching income".
 *
 * Looks for cases the pair-income diagnostic cannot see:
 *   1. Joining payments captured but activation not applied (stuck).
 *   2. Memberships sponsored under X but binary-placed OUTSIDE X's subtree.
 *   3. Recent memberships under X (sponsor chain) with ANY status.
 *
 * Usage: node scripts/diagnose-stuck-activation.js SE4C7NGSFB [daysBack=7]
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmJoiningPayment from "../app/models/mlmJoiningPayment.js";
import Customer from "../app/models/customer.js";

dotenv.config();

const code = (process.argv[2] || "").trim().toUpperCase();
const daysBack = Number(process.argv[3]) || 7;
if (!code) {
  console.error("Usage: node scripts/diagnose-stuck-activation.js <REFERRAL_CODE> [daysBack]");
  process.exit(1);
}

await connectDB();

let mem = await MlmMembership.findOne({ referralCode: code }).lean();
if (!mem) {
  const customer = await Customer.findOne({ userId: code }).select("_id").lean();
  if (customer) mem = await MlmMembership.findOne({ userId: customer._id }).lean();
}
if (!mem) {
  console.log("Member not found:", code);
  process.exit(1);
}
const rootUserId = String(mem.userId);
console.log(`Root: ${code} userId=${rootUserId}`);

const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

// Full binary subtree ids (any status) for placement checks.
const subtreeAgg = await MlmMembership.aggregate([
  { $match: { userId: new mongoose.Types.ObjectId(rootUserId) } },
  {
    $graphLookup: {
      from: MlmMembership.collection.name,
      startWith: "$userId",
      connectFromField: "userId",
      connectToField: "binaryParentId",
      as: "descendants",
      maxDepth: 64,
    },
  },
  {
    $project: {
      ids: { $concatArrays: [["$userId"], "$descendants.userId"] },
    },
  },
]);
const subtreeIds = new Set((subtreeAgg[0]?.ids || []).map(String));
console.log(`Binary subtree size (incl. root, any status): ${subtreeIds.size}`);

// 1. Recent memberships whose sponsorChain includes the root (downline by
//    sponsorship), regardless of status.
const recentDownline = await MlmMembership.find({
  $or: [
    { sponsorId: mem.userId },
    { sponsorChain: mem.userId },
  ],
  $and: [
    {
      $or: [
        { createdAt: { $gte: cutoff } },
        { planAJoinedAt: { $gte: cutoff } },
        { updatedAt: { $gte: cutoff } },
      ],
    },
  ],
})
  .select(
    "userId referralCode status planType planAJoinedAt createdAt updatedAt binaryParentId binaryPosition sponsorId",
  )
  .sort({ updatedAt: -1 })
  .lean();

const customerDocs = await Customer.find({
  _id: { $in: recentDownline.map((m) => m.userId) },
})
  .select("name userId phone")
  .lean();
const custById = new Map(customerDocs.map((c) => [String(c._id), c]));

console.log(`\n=== RECENT DOWNLINE (sponsor chain, any status, last ${daysBack}d): ${recentDownline.length} ===`);
for (const row of recentDownline) {
  const c = custById.get(String(row.userId));
  const inSubtree = subtreeIds.has(String(row.userId));
  const flag = !inSubtree
    ? "  <-- OUTSIDE BINARY SUBTREE!"
    : row.status !== "active"
      ? `  <-- STATUS ${row.status}`
      : "";
  console.log(
    `  ${c?.name || "?"} (${c?.userId || row.referralCode}) status=${row.status} plan=${row.planType} activated=${row.planAJoinedAt?.toISOString?.() || "-"} created=${row.createdAt?.toISOString?.()} binaryParent=${row.binaryParentId || "NULL"} pos=${row.binaryPosition || "-"}${flag}`,
  );
}

// 2. Captured joining payments in window with activation not applied or
//    an activation error, whose customer is in the recent downline set.
const downlineUserIds = recentDownline.map((m) => m.userId);
const paymentsAll = await MlmJoiningPayment.find({
  customer: { $in: downlineUserIds },
  createdAt: { $gte: cutoff },
})
  .select(
    "customer status activationApplied activationCompletedAt activationError failureReason capturedAt paymentMode manualPaymentDetails.transactionId createdAt",
  )
  .sort({ createdAt: -1 })
  .lean();

console.log(`\n=== JOINING PAYMENTS for recent downline (last ${daysBack}d): ${paymentsAll.length} ===`);
for (const p of paymentsAll) {
  const c = custById.get(String(p.customer));
  const problem =
    p.status === "captured" && !p.activationApplied
      ? "  <-- CAPTURED BUT NOT ACTIVATED!"
      : p.activationError
        ? `  <-- ACTIVATION ERROR: ${p.activationError}`
        : "";
  console.log(
    `  ${c?.name || "?"} (${c?.userId || "?"}) status=${p.status} mode=${p.paymentMode} applied=${p.activationApplied} capturedAt=${p.capturedAt?.toISOString?.() || "-"} createdAt=${p.createdAt?.toISOString?.()}${problem}`,
  );
}

// 3. Any captured-but-unapplied joining payments platform-wide in window
//    (safety net in case the member is not linked by sponsorChain).
const stuckGlobal = await MlmJoiningPayment.find({
  status: "captured",
  activationApplied: false,
  createdAt: { $gte: cutoff },
})
  .select("customer capturedAt activationError createdAt")
  .lean();
console.log(`\n=== GLOBAL captured-but-unapplied joining payments (last ${daysBack}d): ${stuckGlobal.length} ===`);
if (stuckGlobal.length) {
  const stuckCust = await Customer.find({
    _id: { $in: stuckGlobal.map((p) => p.customer) },
  })
    .select("name userId")
    .lean();
  const byId = new Map(stuckCust.map((c) => [String(c._id), c]));
  for (const p of stuckGlobal) {
    const c = byId.get(String(p.customer));
    console.log(
      `  ${c?.name || "?"} (${c?.userId || "?"}) capturedAt=${p.capturedAt?.toISOString?.() || "-"} error=${p.activationError || "-"}`,
    );
  }
}

await mongoose.disconnect();
console.log("\nDone (read-only).");
