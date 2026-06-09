/**
 * Verification — call the new shared builder against the offending
 * root and report how many nodes it now renders vs the legacy
 * top-down walker. Also re-classify the direct referrals by leg of
 * root and confirm the totals match `leftLegDirectCount` /
 * `rightLegDirectCount`.
 *
 * Usage:
 *   node scripts/verifyBinaryTreeBuilder.js <referralCode>
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js";
import { MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";
import {
  buildBinaryTreeBottomUp,
  classifyDirectReferralsByLegUnderRoot,
} from "../app/services/mlm/mlmBinaryTreeBuilder.js";

const codeArg = process.argv[2];
if (!codeArg) {
  console.error("usage: node scripts/verifyBinaryTreeBuilder.js <referralCode>");
  process.exit(2);
}

function countNodes(node) {
  if (!node) return 0;
  return 1 + countNodes(node.left) + countNodes(node.right);
}

function printTree(node, depth = 0, maxDepth = 4) {
  if (!node) return;
  if (depth > maxDepth) return;
  const pad = "  ".repeat(depth);
  const m = node.raw;
  console.log(
    `${pad}${node.position || "ROOT"}: ${m.referralCode} (${m.userId?.name || "?"})  down=${m.totalDownlineCount || 0}`,
  );
  if (depth === maxDepth) {
    if (node.left || node.right) console.log(`${pad}  (children truncated)`);
    return;
  }
  printTree(node.left, depth + 1, maxDepth);
  printTree(node.right, depth + 1, maxDepth);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const root = await MlmMembership.findOne({
    referralCode: codeArg.toUpperCase(),
  })
    .populate("userId", "name phone userId")
    .lean();
  if (!root) {
    console.error(`No membership with referralCode=${codeArg}`);
    process.exit(1);
  }

  const { tree, drift, totalDescendants, renderedCount, orphanedCount } =
    await buildBinaryTreeBottomUp({ rootMembership: root, depthLeft: 50 });
  const actualCount = countNodes(tree);

  console.log(`Root: ${root.referralCode} (${root.userId?.name})`);
  console.log(`Total descendants (sponsorChain): ${totalDescendants}`);
  console.log(`Bottom-up rendered: ${renderedCount}`);
  console.log(`Tree-walk node count: ${actualCount}`);
  console.log(`Orphaned (unreachable via bottom-up): ${orphanedCount}`);
  console.log(`Drift entries: ${drift.length}`);

  console.log("\nFirst 4 levels of the rebuilt tree:");
  printTree(tree, 0, 4);

  // Verify leg classification of direct referrals
  const directs = await MlmMembership.find({
    sponsorId: root.userId._id,
    status: {
      $in: [
        MLM_MEMBERSHIP_STATUS.ACTIVE,
        MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
      ],
    },
  })
    .populate("userId", "name")
    .lean();
  const legMap = await classifyDirectReferralsByLegUnderRoot({
    rootMembership: root,
    directReferrals: directs,
  });
  const leftCount = directs.filter((d) => legMap.get(String(d._id)) === "L").length;
  const rightCount = directs.filter((d) => legMap.get(String(d._id)) === "R").length;
  const unknownCount = directs.length - leftCount - rightCount;
  console.log(
    `\nDirect referrals: ${directs.length} (L=${leftCount}, R=${rightCount}, unknown=${unknownCount})`,
  );
  console.log(
    `Counter says:    leftLegDirectCount=${root.leftLegDirectCount}, rightLegDirectCount=${root.rightLegDirectCount}`,
  );

  if (drift.length) {
    console.log("\nDrift sample:");
    for (const d of drift.slice(0, 10)) {
      console.log(`  - ${JSON.stringify(d)}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
