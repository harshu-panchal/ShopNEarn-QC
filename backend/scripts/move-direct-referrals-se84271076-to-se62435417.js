/**
 * Move every CURRENT direct referral of SE84271076 to SE62435417.
 *
 * Binary placement is never changed.
 *
 * Usage:
 *   node scripts/move-direct-referrals-se84271076-to-se62435417.js
 *   node scripts/move-direct-referrals-se84271076-to-se62435417.js --commit
 *
 * Safety:
 * - dry-run by default
 * - idempotent: only rows whose sponsorId is still SE84271076 are selected
 * - sponsor rewrites + descendant sponsor-chain rebuild run transactionally
 * - direct/downline counters are recomputed from source data
 * - final checksums verify no direct referrals remain under the old sponsor
 */
import "dotenv/config";
import mongoose from "mongoose";

import "../app/models/customer.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import { MLM_DEFAULTS, MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";

const OLD_SPONSOR_CODE = "SE84271076";
const NEW_SPONSOR_CODE = "SE62435417";
const COMMIT = process.argv.includes("--commit");

function fail(message) {
  throw new Error(message);
}

async function buildSponsorChain(sponsorMembership) {
  const cfg = await getMlmConfig();
  const maxDepth =
    Number(cfg.sponsorChainMaxDepth) || MLM_DEFAULTS.sponsorChainMaxDepth;
  const chain = [sponsorMembership.userId];
  for (const userId of sponsorMembership.sponsorChain || []) {
    if (chain.length >= maxDepth) break;
    chain.push(userId);
  }
  return chain;
}

async function rebuildChainsBreadthFirst(rootUserIds, { session }) {
  const queue = [...rootUserIds];
  const visited = new Set();
  let rebuilt = 0;

  while (queue.length > 0) {
    const userId = queue.shift();
    const key = String(userId);
    if (visited.has(key)) fail(`Sponsor cycle detected at ${key}`);
    visited.add(key);

    const member = await MlmMembership.findOne({ userId }, null, { session });
    if (!member) continue;

    const sponsor = member.sponsorId
      ? await MlmMembership.findOne(
          { userId: member.sponsorId },
          null,
          { session },
        )
      : null;
    member.sponsorChain = sponsor ? await buildSponsorChain(sponsor) : [];
    await member.save({ session });
    rebuilt += 1;

    const children = await MlmMembership.find(
      { sponsorId: member.userId },
      { userId: 1 },
      { session },
    ).lean();
    queue.push(...children.map((child) => child.userId));
  }

  return rebuilt;
}

async function recomputeNetworkCounters() {
  const [directRows, downlineRows] = await Promise.all([
    MlmMembership.aggregate([
      { $match: { sponsorId: { $ne: null } } },
      { $group: { _id: "$sponsorId", count: { $sum: 1 } } },
    ]),
    MlmMembership.aggregate([
      { $unwind: "$sponsorChain" },
      {
        $group: {
          _id: "$sponsorChain",
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [
                { $eq: ["$status", MLM_MEMBERSHIP_STATUS.ACTIVE] },
                1,
                0,
              ],
            },
          },
          inactive: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$status",
                    MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const directByUser = new Map(
    directRows.map((row) => [String(row._id), row.count]),
  );
  const downlineByUser = new Map(
    downlineRows.map((row) => [String(row._id), row]),
  );
  const members = await MlmMembership.find({}, { userId: 1 }).lean();

  const operations = members.map((member) => {
    const key = String(member.userId);
    const downline = downlineByUser.get(key);
    return {
      updateOne: {
        filter: { _id: member._id },
        update: {
          $set: {
            directReferralsCount: directByUser.get(key) || 0,
            totalDownlineCount: downline?.total || 0,
            activeDownlineCount: downline?.active || 0,
            inactiveDownlineCount: downline?.inactive || 0,
          },
        },
      },
    };
  });

  if (operations.length > 0) {
    await MlmMembership.bulkWrite(operations);
  }
  return operations.length;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const [oldSponsorUser, newSponsorUser] = await Promise.all([
    Customer.findOne({ userId: OLD_SPONSOR_CODE })
      .select("_id name userId")
      .lean(),
    Customer.findOne({ userId: NEW_SPONSOR_CODE })
      .select("_id name userId")
      .lean(),
  ]);
  if (!oldSponsorUser || !newSponsorUser) {
    fail("Old or new sponsor account was not found.");
  }

  const [oldSponsor, newSponsor] = await Promise.all([
    MlmMembership.findOne({ userId: oldSponsorUser._id }).lean(),
    MlmMembership.findOne({ userId: newSponsorUser._id }).lean(),
  ]);
  if (!oldSponsor || !newSponsor) {
    fail("Old or new sponsor membership was not found.");
  }

  const referrals = await MlmMembership.find({
    sponsorId: oldSponsorUser._id,
  })
    .populate("userId", "name userId")
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  console.log(
    JSON.stringify(
      {
        mode: COMMIT ? "COMMIT" : "DRY_RUN",
        oldSponsor: {
          name: oldSponsorUser.name,
          userId: oldSponsorUser.userId,
          membershipId: String(oldSponsor._id),
        },
        newSponsor: {
          name: newSponsorUser.name,
          userId: newSponsorUser.userId,
          membershipId: String(newSponsor._id),
        },
        directReferralsToMove: referrals.length,
        referrals: referrals.map((member) => ({
          membershipId: String(member._id),
          name: member.userId?.name || null,
          userId: member.userId?.userId || null,
          binaryParentId: member.binaryParentId
            ? String(member.binaryParentId)
            : null,
          binaryPosition: member.binaryPosition || null,
        })),
      },
      null,
      2,
    ),
  );

  if (!COMMIT) {
    console.log("\nDry-run only. No data changed.");
    return;
  }

  let rebuiltChains = 0;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const currentNewSponsor = await MlmMembership.findById(
        newSponsor._id,
      ).session(session);
      if (!currentNewSponsor) fail("New sponsor disappeared.");

      const referralIds = referrals.map((member) => member._id);
      if (referralIds.length === 0) return;

      const updateResult = await MlmMembership.updateMany(
        {
          _id: { $in: referralIds },
          sponsorId: oldSponsorUser._id,
        },
        {
          $set: {
            sponsorId: newSponsorUser._id,
            sponsorMembershipId: currentNewSponsor._id,
          },
        },
        { session },
      );
      if (updateResult.modifiedCount !== referralIds.length) {
        fail(
          `Concurrent change detected: expected ${referralIds.length}, updated ${updateResult.modifiedCount}.`,
        );
      }

      rebuiltChains = await rebuildChainsBreadthFirst(
        referrals.map((member) => member.userId?._id || member.userId),
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  const countersRecomputed = await recomputeNetworkCounters();

  await Promise.all([
    syncCustomerMlmProjection(oldSponsorUser._id),
    syncCustomerMlmProjection(newSponsorUser._id),
    ...referrals.map((member) =>
      syncCustomerMlmProjection(member.userId?._id || member.userId),
    ),
  ]);

  const [oldDirectResidue, newDirectCount, binaryChanges] = await Promise.all([
    MlmMembership.countDocuments({ sponsorId: oldSponsorUser._id }),
    MlmMembership.countDocuments({ sponsorId: newSponsorUser._id }),
    Promise.all(
      referrals.map(async (before) => {
        const after = await MlmMembership.findById(before._id)
          .select("binaryParentId binaryPosition")
          .lean();
        return (
          String(after?.binaryParentId || "") !==
            String(before.binaryParentId || "") ||
          after?.binaryPosition !== before.binaryPosition
        );
      }),
    ),
  ]);

  if (oldDirectResidue !== 0) {
    fail(`Checksum failed: ${oldDirectResidue} direct referrals remain.`);
  }
  if (binaryChanges.some(Boolean)) {
    fail("Checksum failed: at least one binary placement changed.");
  }

  console.log(
    JSON.stringify(
      {
        status: "SUCCESS",
        moved: referrals.length,
        rebuiltSponsorChains: rebuiltChains,
        countersRecomputed,
        oldSponsorDirectReferrals: oldDirectResidue,
        newSponsorDirectReferrals: newDirectCount,
        binaryPlacementChanges: 0,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
