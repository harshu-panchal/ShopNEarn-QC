/**
 * READ-ONLY: compare binary leg volumes at maxDepth 64 vs deep (500)
 * for a member, to prove/disprove $graphLookup depth truncation.
 *
 * Usage: node scripts/verify-depth-truncation.js SE4C7NGSFB
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import Customer from "../app/models/customer.js";
import { calculateBinaryPairs } from "../app/services/mlm/mlmBinaryPairIncomeService.js";

dotenv.config();

const code = (process.argv[2] || "").trim().toUpperCase();
if (!code) {
  console.error("Usage: node scripts/verify-depth-truncation.js <REFERRAL_CODE>");
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

async function countActive(rootUserId, maxDepth) {
  if (!rootUserId) return { count: 0, members: [] };
  const agg = await MlmMembership.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(rootUserId)) } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
        maxDepth,
        depthField: "treeDepth",
      },
    },
    {
      $project: {
        rootActive: {
          $cond: [
            {
              $and: [
                { $eq: ["$status", "active"] },
                { $in: ["$planType", ["A", "B"]] },
              ],
            },
            1,
            0,
          ],
        },
        activeDesc: {
          $map: {
            input: {
              $filter: {
                input: "$descendants",
                as: "d",
                cond: {
                  $and: [
                    { $eq: ["$$d.status", "active"] },
                    { $in: ["$$d.planType", ["A", "B"]] },
                  ],
                },
              },
            },
            as: "d",
            in: { userId: "$$d.userId", depth: "$$d.treeDepth", code: "$$d.referralCode" },
          },
        },
      },
    },
  ]);
  const row = agg[0] || { rootActive: 0, activeDesc: [] };
  return {
    count: (row.rootActive || 0) + (row.activeDesc || []).length,
    members: row.activeDesc || [],
  };
}

console.log(`Member ${code}: L-child=${mem.binaryLeftChildId} R-child=${mem.binaryRightChildId}`);
const leftChild = mem.binaryLeftChildId;
const rightChild = mem.binaryRightChildId;

// Which child is which member?
for (const [label, id] of [["LEFT", leftChild], ["RIGHT", rightChild]]) {
  if (!id) continue;
  const c = await Customer.findById(id).select("name userId").lean();
  console.log(`${label} child: ${c?.name} (${c?.userId})`);
}

for (const depth of [64, 500]) {
  const [l, r] = await Promise.all([
    countActive(leftChild, depth),
    countActive(rightChild, depth),
  ]);
  const pairs = calculateBinaryPairs(l.count, r.count);
  console.log(
    `\nmaxDepth=${depth}: leftActive=${l.count} rightActive=${r.count} => pairsEligible=${pairs.pairs} (leftBal=${pairs.leftBalance}, rightBal=${pairs.rightBalance})`,
  );
  const deepL = l.members.filter((m) => m.depth > 60);
  const deepR = r.members.filter((m) => m.depth > 60);
  if (deepL.length || deepR.length) {
    console.log("  Active members deeper than 60 levels:");
    for (const m of deepL) console.log(`    LEFT depth=${m.depth} code=${m.code || m.userId}`);
    for (const m of deepR) console.log(`    RIGHT depth=${m.depth} code=${m.code || m.userId}`);
  }
}

console.log(`\npairsCompleted on membership: ${mem.pairsCompleted}`);
console.log(`binaryDailyPairTracker: ${JSON.stringify(mem.binaryDailyPairTracker)}`);

await mongoose.disconnect();
console.log("\nDone (read-only).");
