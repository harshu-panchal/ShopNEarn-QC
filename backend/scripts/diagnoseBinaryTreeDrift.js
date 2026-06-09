/**
 * Diagnostic — compare the bottom-up binary tree (built from
 * `binaryParentId` + `binaryPosition`) against the top-down tree
 * (built from `binaryLeftChildId` / `binaryRightChildId`) for a
 * given root membership.
 *
 * Usage:
 *   node scripts/diagnoseBinaryTreeDrift.js <referralCode>
 *
 * The two pictures SHOULD be identical. Any drift is a data
 * integrity bug — either a placement that bumped `binaryParentId`
 * without re-saving the parent's child pointer, or the reverse.
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js"; // register User model

const codeArg = process.argv[2];
if (!codeArg) {
  console.error("usage: node scripts/diagnoseBinaryTreeDrift.js <referralCode>");
  process.exit(2);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });

  const root = await MlmMembership.findOne({
    referralCode: codeArg.toUpperCase(),
  })
    .populate("userId", "name phone userId")
    .lean();
  if (!root) {
    console.error(`No membership with referralCode=${codeArg}`);
    process.exit(1);
  }

  console.log("ROOT:", {
    referralCode: root.referralCode,
    name: root.userId?.name,
    userId: String(root.userId?._id),
    binaryLeftChildId: root.binaryLeftChildId
      ? String(root.binaryLeftChildId)
      : null,
    binaryRightChildId: root.binaryRightChildId
      ? String(root.binaryRightChildId)
      : null,
    leftLegDirectCount: root.leftLegDirectCount,
    rightLegDirectCount: root.rightLegDirectCount,
  });

  const descendants = await MlmMembership.find({
    sponsorChain: root.userId._id,
  })
    .populate("userId", "name phone userId")
    .lean();

  console.log(`\nDownline size (sponsorChain): ${descendants.length}`);

  const directReferrals = descendants.filter(
    (d) => String(d.sponsorId) === String(root.userId._id),
  );
  console.log(`Direct referrals (sponsorId=root): ${directReferrals.length}`);

  // ----- TOP-DOWN walk (current production logic) -----
  const idToMembership = new Map(
    descendants.map((d) => [String(d.userId._id), d]),
  );
  idToMembership.set(String(root.userId._id), root);

  const topDownReached = new Set();
  async function walkTopDown(node, depth, leg) {
    if (!node) return;
    topDownReached.add(String(node.userId._id));
    if (depth <= 0) return;
    if (node.binaryLeftChildId) {
      const left = idToMembership.get(String(node.binaryLeftChildId));
      await walkTopDown(left, depth - 1, leg || "L");
    }
    if (node.binaryRightChildId) {
      const right = idToMembership.get(String(node.binaryRightChildId));
      await walkTopDown(right, depth - 1, leg || "R");
    }
  }
  await walkTopDown(root, 20, null);
  console.log(
    `\nTop-down (binaryLeftChildId/binaryRightChildId) reached: ${topDownReached.size} nodes (incl root)`,
  );

  // ----- BOTTOM-UP walk (proposed fix) -----
  const childrenByParent = new Map();
  for (const d of descendants) {
    if (!d.binaryParentId) continue;
    const key = String(d.binaryParentId);
    if (!childrenByParent.has(key))
      childrenByParent.set(key, { L: null, R: null });
    const slot = childrenByParent.get(key);
    if (d.binaryPosition === "L") {
      if (slot.L) {
        console.log(
          `  ! DUPLICATE LEFT child for parent ${key}: ${slot.L.referralCode} vs ${d.referralCode}`,
        );
      } else {
        slot.L = d;
      }
    } else if (d.binaryPosition === "R") {
      if (slot.R) {
        console.log(
          `  ! DUPLICATE RIGHT child for parent ${key}: ${slot.R.referralCode} vs ${d.referralCode}`,
        );
      } else {
        slot.R = d;
      }
    }
  }

  const bottomUpReached = new Set();
  function walkBottomUp(node, depth) {
    if (!node) return;
    bottomUpReached.add(String(node.userId._id));
    if (depth <= 0) return;
    const slot = childrenByParent.get(String(node.userId._id));
    if (!slot) return;
    if (slot.L) walkBottomUp(slot.L, depth - 1);
    if (slot.R) walkBottomUp(slot.R, depth - 1);
  }
  walkBottomUp(root, 20);
  console.log(
    `Bottom-up (binaryParentId/binaryPosition) reached: ${bottomUpReached.size} nodes (incl root)`,
  );

  // ----- Diff -----
  const missingFromTopDown = [...bottomUpReached].filter(
    (id) => !topDownReached.has(id),
  );
  const missingFromBottomUp = [...topDownReached].filter(
    (id) => !bottomUpReached.has(id),
  );
  console.log(
    `\nMissing from TOP-DOWN (orphaned by stale child pointers): ${missingFromTopDown.length}`,
  );
  for (const id of missingFromTopDown) {
    const m = idToMembership.get(id);
    if (!m) continue;
    const parent = idToMembership.get(String(m.binaryParentId));
    console.log(
      `  - ${m.referralCode} (${m.userId?.name}) — binaryParent=${parent?.referralCode || m.binaryParentId} position=${m.binaryPosition}` +
        `   parent.binaryLeftChildId=${parent?.binaryLeftChildId ? String(parent.binaryLeftChildId).slice(-6) : "null"}` +
        `   parent.binaryRightChildId=${parent?.binaryRightChildId ? String(parent.binaryRightChildId).slice(-6) : "null"}`,
    );
  }
  console.log(
    `\nMissing from BOTTOM-UP (broken binaryParentId linkage): ${missingFromBottomUp.length}`,
  );
  for (const id of missingFromBottomUp) {
    const m = idToMembership.get(id);
    if (!m) continue;
    console.log(
      `  - ${m.referralCode} (${m.userId?.name}) — binaryParentId=${m.binaryParentId || "null"} binaryPosition=${m.binaryPosition || "null"}`,
    );
  }

  // ----- Direct-referral leg classification: local position vs subtree-walk -----
  console.log(`\nDirect-referral leg classification:`);
  const parentByUser = new Map();
  for (const d of descendants) {
    parentByUser.set(String(d.userId._id), {
      parent: d.binaryParentId ? String(d.binaryParentId) : null,
      position: d.binaryPosition || null,
    });
  }
  const rootIdStr = String(root.userId._id);
  for (const ref of directReferrals) {
    const refUid = String(ref.userId._id);
    // Subtree walk.
    let cursor = refUid;
    let actualLeg = null;
    for (let i = 0; i < 50; i++) {
      const link = parentByUser.get(cursor);
      if (!link || !link.parent) break;
      if (link.parent === rootIdStr) {
        actualLeg = link.position;
        break;
      }
      cursor = link.parent;
    }
    const localLeg = ref.binaryPosition || null;
    const flag = actualLeg && localLeg && actualLeg !== localLeg ? "  <- MISMATCH" : "";
    console.log(
      `  - ${ref.referralCode} (${ref.userId?.name}) localBinaryPosition=${localLeg} actualLegOfRoot=${actualLeg}${flag}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
