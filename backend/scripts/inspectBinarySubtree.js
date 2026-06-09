/**
 * Read-only — prints the full binary subtree rooted at a given
 * referral code so an operator can preview exactly which rows a
 * bulk-delete (or any other subtree-scoped operation) would touch.
 *
 * Uses BOTTOM-UP traversal (binaryParentId BFS) so it tolerates
 * stale top-down pointers — the print matches what the genealogy
 * canvas actually renders.
 *
 * Usage:
 *   node scripts/inspectBinarySubtree.js <referralCode>
 *
 * For each member in the subtree it prints:
 *   - referralCode | name | status | binaryPosition under parent
 *   - whether the member has direct referrals (sponsor-level) that
 *     live OUTSIDE the subtree (those would need sponsor-remap on
 *     a bulk delete)
 *   - pending withdrawal count / wallet balance
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import MlmWithdrawalRequest from "../app/models/mlmWithdrawalRequest.js";
import "../app/models/customer.js";
import { MLM_WITHDRAWAL_STATUS } from "../app/constants/mlm.js";

const code = process.argv[2];
if (!code) {
  console.error("usage: node scripts/inspectBinarySubtree.js <referralCode>");
  process.exit(2);
}

async function bfsBinarySubtree(rootUserId, session) {
  const visited = new Set([String(rootUserId)]);
  const order = [String(rootUserId)];
  let frontier = [String(rootUserId)];
  while (frontier.length) {
    const children = await MlmMembership.find(
      { binaryParentId: { $in: frontier } },
      { userId: 1, binaryParentId: 1, binaryPosition: 1 },
      session ? { session } : {},
    ).lean();
    const next = [];
    for (const c of children) {
      const cid = String(c.userId);
      if (visited.has(cid)) continue;
      visited.add(cid);
      next.push(cid);
      order.push(cid);
    }
    frontier = next;
  }
  return order;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });

  const root = await MlmMembership.findOne({ referralCode: code.toUpperCase() })
    .populate("userId", "name email phone walletBalance")
    .lean();
  if (!root) {
    console.error(`No membership with referralCode=${code}`);
    process.exit(1);
  }

  console.log("\nROOT:");
  console.log(`  ${root.userId?.name} [${root.referralCode}]`);
  console.log(`  status=${root.status} planType=${root.planType} deletedAt=${root.deletedAt || "—"}`);
  console.log(`  binaryParentId=${root.binaryParentId} position=${root.binaryPosition}`);

  // Find the parent so we know whose child pointer needs clearing
  // if a bulk delete is committed.
  let parent = null;
  if (root.binaryParentId) {
    parent = await MlmMembership.findOne({ userId: root.binaryParentId })
      .populate("userId", "name")
      .lean();
  }
  console.log(
    `  parent: ${parent ? `${parent.userId?.name} [${parent.referralCode}] uid=${parent.userId?._id}` : "(none — root of tree)"}`,
  );

  const userIds = await bfsBinarySubtree(root.userId._id);
  const userObjectIds = userIds.map((u) => new mongoose.Types.ObjectId(u));
  const members = await MlmMembership.find({ userId: { $in: userObjectIds } })
    .populate("userId", "name email phone walletBalance isVerified")
    .lean();

  const memberByUid = new Map(members.map((m) => [String(m.userId._id), m]));

  console.log(`\nSUBTREE COUNT (including root): ${members.length}`);
  console.log(
    `  active=${members.filter((m) => m.status === "active").length}` +
      ` registered_unpaid=${members.filter((m) => m.status === "registered_unpaid").length}` +
      ` other=${members.filter((m) => !["active", "registered_unpaid"].includes(m.status)).length}`,
  );

  // ----- Per-member detail (in BFS order) -----
  console.log("\nSUBTREE DETAIL (BFS from root):");
  for (let i = 0; i < userIds.length; i += 1) {
    const m = memberByUid.get(userIds[i]);
    if (!m) continue;
    const wallet = m.userId?.walletBalance || 0;
    const tag = `[${m.referralCode}]`.padEnd(11);
    const name = (m.userId?.name || "?").padEnd(28);
    const pos = m.binaryPosition || "-";
    console.log(
      `  ${String(i + 1).padStart(3)}. ${tag} ${name} pos=${pos} status=${m.status.padEnd(18)} wallet=₹${wallet}`,
    );
  }

  // ----- Pending withdrawals across the subtree -----
  const withdrawals = await MlmWithdrawalRequest.find({
    userId: { $in: userObjectIds },
    status: MLM_WITHDRAWAL_STATUS.PENDING,
  }).lean();
  console.log(`\nPENDING WITHDRAWALS in subtree: ${withdrawals.length}`);
  if (withdrawals.length) {
    for (const w of withdrawals) {
      const m = memberByUid.get(String(w.userId));
      console.log(`  - ${m?.userId?.name || w.userId} amount=₹${w.amount} id=${w._id}`);
    }
  }

  // ----- Direct referrals (sponsorship) of subtree members that
  //       live OUTSIDE the subtree. These would become orphans on
  //       bulk delete and need a sponsor-remap decision. -----
  const outsideOrphans = await MlmMembership.find({
    sponsorId: { $in: userObjectIds },
    userId: { $nin: userObjectIds },
  })
    .populate("userId", "name")
    .lean();
  console.log(
    `\nOUTSIDE-SUBTREE DIRECT REFERRALS (would lose their sponsor): ${outsideOrphans.length}`,
  );
  if (outsideOrphans.length) {
    for (const o of outsideOrphans) {
      const s = memberByUid.get(String(o.sponsorId));
      console.log(
        `  - ${o.userId?.name} [${o.referralCode}] sponsored by ${s?.userId?.name || o.sponsorId}`,
      );
    }
  }

  // ----- Total wallet money tied up in the subtree -----
  const totalWallet = members.reduce(
    (sum, m) => sum + (m.userId?.walletBalance || 0),
    0,
  );
  console.log(`\nTOTAL WALLET BALANCE in subtree: ₹${totalWallet.toLocaleString("en-IN")}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
