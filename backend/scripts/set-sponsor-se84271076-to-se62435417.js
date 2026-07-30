/**
 * Inspect + optionally set sponsor of SE84271076 → SE62435417 (sponsor only).
 *
 *   node scripts/set-sponsor-se84271076-to-se62435417.js
 *   node scripts/set-sponsor-se84271076-to-se62435417.js --commit
 */
import "dotenv/config";
import mongoose from "mongoose";
import "../app/models/customer.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import { MLM_DEFAULTS, MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";

const MEMBER_PUBLIC = "SE84271076";
const NEW_SPONSOR_PUBLIC = "SE62435417";
const COMMIT = process.argv.includes("--commit");

async function buildSponsorChain(sponsorMembership) {
  if (!sponsorMembership) return [];
  const cfg = await getMlmConfig();
  const maxDepth =
    Number(cfg.sponsorChainMaxDepth) || MLM_DEFAULTS.sponsorChainMaxDepth;
  const chain = [sponsorMembership.userId];
  for (const upline of sponsorMembership.sponsorChain || []) {
    if (chain.length >= maxDepth) break;
    chain.push(upline);
  }
  return chain;
}

async function countUnilevelSubtree(userId) {
  const rows = await MlmMembership.find(
    { $or: [{ userId }, { sponsorChain: userId }] },
    { status: 1 },
  ).lean();
  let active = 0;
  let inactive = 0;
  for (const row of rows) {
    if (row.status === MLM_MEMBERSHIP_STATUS.ACTIVE) active += 1;
    else if (row.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID) inactive += 1;
  }
  return { total: rows.length, active, inactive };
}

async function rebuildSponsorChainsFrom(userId, { session }) {
  const member = await MlmMembership.findOne({ userId }, null, { session });
  if (!member) return;

  if (member.sponsorId) {
    const sponsor = await MlmMembership.findOne(
      { userId: member.sponsorId },
      null,
      { session },
    );
    member.sponsorChain = await buildSponsorChain(sponsor);
  } else {
    member.sponsorChain = [];
  }
  await member.save({ session });

  const directs = await MlmMembership.find({ sponsorId: userId }, null, {
    session,
  });
  for (const direct of directs) {
    await rebuildSponsorChainsFrom(direct.userId, { session });
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const [memberUser, sponsorUser] = await Promise.all([
    Customer.findOne({ userId: MEMBER_PUBLIC }).select("_id name userId").lean(),
    Customer.findOne({ userId: NEW_SPONSOR_PUBLIC })
      .select("_id name userId")
      .lean(),
  ]);

  if (!memberUser || !sponsorUser) {
    console.error("Missing user(s)", { memberUser, sponsorUser });
    process.exit(1);
  }

  const [member, newSponsor] = await Promise.all([
    MlmMembership.findOne({ userId: memberUser._id }).lean(),
    MlmMembership.findOne({ userId: sponsorUser._id }).lean(),
  ]);

  let oldSponsorUser = null;
  let oldSponsor = null;
  if (member?.sponsorId) {
    oldSponsorUser = await Customer.findById(member.sponsorId)
      .select("_id name userId")
      .lean();
    oldSponsor = await MlmMembership.findOne({ userId: member.sponsorId }).lean();
  }

  console.log("=== BEFORE ===");
  console.log("Member:", {
    name: memberUser.name,
    userId: memberUser.userId,
    membershipId: String(member._id),
    binaryParentId: String(member.binaryParentId || ""),
    binaryPosition: member.binaryPosition,
    sponsorId: String(member.sponsorId || ""),
    currentSponsor: oldSponsorUser
      ? { name: oldSponsorUser.name, userId: oldSponsorUser.userId }
      : null,
  });
  console.log("New sponsor target:", {
    name: sponsorUser.name,
    userId: sponsorUser.userId,
    membershipId: String(newSponsor._id),
  });

  // Safety: binary parent should already be the new sponsor (placement OK)
  if (String(member.binaryParentId) !== String(sponsorUser._id)) {
    console.warn(
      "WARNING: binaryParentId is NOT the new sponsor. You said placement is correct — verify:",
      {
        binaryParentId: String(member.binaryParentId || ""),
        newSponsorUserId: String(sponsorUser._id),
      },
    );
  }

  if (String(member.sponsorId) === String(sponsorUser._id)) {
    console.log("Already sponsored by", NEW_SPONSOR_PUBLIC, "— nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // Cycle check: new sponsor must not be in member's unilevel downline
  const inSubtree = await MlmMembership.exists({
    userId: sponsorUser._id,
    sponsorChain: memberUser._id,
  });
  if (inSubtree) {
    console.error("REFUSED: new sponsor is inside member's unilevel downline (cycle).");
    process.exit(1);
  }

  const stats = await countUnilevelSubtree(memberUser._id);
  console.log("Unilevel subtree of member (incl self):", stats);

  if (!COMMIT) {
    console.log("\nDry-run only. Pass --commit to apply sponsor change.");
    await mongoose.disconnect();
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const m = await MlmMembership.findById(member._id).session(session);
      const ns = await MlmMembership.findById(newSponsor._id).session(session);
      const oldSponsorUserId = m.sponsorId;

      m.sponsorId = ns.userId;
      m.sponsorMembershipId = ns._id;
      m.sponsorChain = await buildSponsorChain(ns);
      await m.save({ session });

      await rebuildSponsorChainsFrom(m.userId, { session });

      if (oldSponsorUserId) {
        await MlmMembership.updateOne(
          { userId: oldSponsorUserId },
          {
            $inc: {
              directReferralsCount: -1,
              totalDownlineCount: -(stats.total || 0),
              activeDownlineCount: -(stats.active || 0),
              inactiveDownlineCount: -(stats.inactive || 0),
            },
          },
          { session },
        );
      }

      await MlmMembership.updateOne(
        { userId: ns.userId },
        {
          $inc: {
            directReferralsCount: 1,
            totalDownlineCount: stats.total || 0,
            activeDownlineCount: stats.active || 0,
            inactiveDownlineCount: stats.inactive || 0,
          },
        },
        { session },
      );

      await syncCustomerMlmProjection(m.userId, { session });
      await syncCustomerMlmProjection(ns.userId, { session });
      if (oldSponsorUserId) {
        await syncCustomerMlmProjection(oldSponsorUserId, { session });
      }
    });
  } finally {
    await session.endSession();
  }

  const after = await MlmMembership.findOne({ userId: memberUser._id })
    .populate({ path: "sponsorId", select: "name userId", model: "User" })
    .lean();
  // sponsorId is ObjectId ref to User — populate may need Customer model name User
  const afterSponsor = await Customer.findById(after.sponsorId)
    .select("name userId")
    .lean();

  console.log("\n=== AFTER ===");
  console.log({
    member: MEMBER_PUBLIC,
    sponsor: afterSponsor
      ? { name: afterSponsor.name, userId: afterSponsor.userId }
      : null,
    sponsorMembershipId: String(after.sponsorMembershipId || ""),
    sponsorChainLen: (after.sponsorChain || []).length,
  });

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
