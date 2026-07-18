/**
 * READ-ONLY: trace a member's sponsor vs binary placement and walk the
 * binary ancestor chain upward.
 *
 * Usage: node scripts/trace-member-placement.js SE35346959
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import Customer from "../app/models/customer.js";

dotenv.config();

const code = (process.argv[2] || "").trim().toUpperCase();
if (!code) {
  console.error("Usage: node scripts/trace-member-placement.js <REFERRAL_CODE>");
  process.exit(1);
}

await connectDB();

async function describeUser(userId) {
  if (!userId) return "NULL";
  const c = await Customer.findById(userId).select("name userId").lean();
  const m = await MlmMembership.findOne({ userId }).select("referralCode status").lean();
  return `${c?.name || "?"} (${c?.userId || m?.referralCode || String(userId)}) status=${m?.status || "?"} _uid=${String(userId)}`;
}

let mem = await MlmMembership.findOne({ referralCode: code }).lean();
if (!mem) {
  const customer = await Customer.findOne({ userId: code }).select("_id").lean();
  if (customer) mem = await MlmMembership.findOne({ userId: customer._id }).lean();
}
if (!mem) {
  console.log("Member not found:", code);
  process.exit(1);
}

console.log("=== MEMBER ===");
console.log(await describeUser(mem.userId));
console.log({
  status: mem.status,
  planType: mem.planType,
  planAJoinedAt: mem.planAJoinedAt,
  createdAt: mem.createdAt,
  binaryPosition: mem.binaryPosition,
});

console.log("\nSponsor:", await describeUser(mem.sponsorId));
console.log("\nSponsor chain (0 = direct sponsor):");
for (let i = 0; i < (mem.sponsorChain || []).length; i += 1) {
  console.log(`  [${i}] ${await describeUser(mem.sponsorChain[i])}`);
}

console.log("\nBinary ancestor walk (parent upward):");
let parentId = mem.binaryParentId;
const seen = new Set();
let depth = 0;
while (parentId && !seen.has(String(parentId)) && depth < 80) {
  seen.add(String(parentId));
  console.log(`  [${depth}] ${await describeUser(parentId)}`);
  const parent = await MlmMembership.findOne({ userId: parentId })
    .select("binaryParentId")
    .lean();
  parentId = parent?.binaryParentId || null;
  depth += 1;
}
if (depth === 0) console.log("  (no binary parent)");

await mongoose.disconnect();
console.log("\nDone (read-only).");
