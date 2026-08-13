import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import { MLM_DEFAULTS, MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";

const MEMBER_PUBLIC = "SE74126386";
const OLD_SPONSOR_PUBLIC = "SE19356174";
const NEW_SPONSOR_PUBLIC = "SE22899251";

async function buildSponsorChain(sponsorMembership, session = null) {
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

async function countUnilevelSubtree(userId, session = null) {
  let query = MlmMembership.find(
    { $or: [{ userId }, { sponsorChain: userId }] },
    { status: 1 },
  );
  if (session) query = query.session(session);
  const rows = await query.lean();

  let active = 0;
  let inactive = 0;
  for (const row of rows) {
    if (row.status === MLM_MEMBERSHIP_STATUS.ACTIVE) active += 1;
    else if (row.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID) inactive += 1;
  }
  return { total: rows.length, active, inactive };
}

async function rebuildSponsorChainsFrom(userId, session = null) {
  let q = MlmMembership.findOne({ userId });
  if (session) q = q.session(session);
  const member = await q;
  if (!member) return;

  if (member.sponsorId) {
    let sq = MlmMembership.findOne({ userId: member.sponsorId });
    if (session) sq = sq.session(session);
    const sponsor = await sq;
    member.sponsorChain = await buildSponsorChain(sponsor, session);
  } else {
    member.sponsorChain = [];
  }
  if (session) await member.save({ session });
  else await member.save();

  let dq = MlmMembership.find({ sponsorId: userId });
  if (session) dq = dq.session(session);
  const directs = await dq;

  for (const direct of directs) {
    await rebuildSponsorChainsFrom(direct.userId, session);
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI is missing in environment");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.\n");

  const [memberUser, oldSponsorUser, newSponsorUser] = await Promise.all([
    Customer.findOne({ userId: MEMBER_PUBLIC }).select("_id name userId").lean(),
    Customer.findOne({ userId: OLD_SPONSOR_PUBLIC }).select("_id name userId").lean(),
    Customer.findOne({ userId: NEW_SPONSOR_PUBLIC }).select("_id name userId").lean(),
  ]);

  if (!memberUser) {
    console.error(`Target Member ${MEMBER_PUBLIC} not found!`);
    process.exit(1);
  }
  if (!newSponsorUser) {
    console.error(`New Sponsor Target ${NEW_SPONSOR_PUBLIC} not found!`);
    process.exit(1);
  }

  const [member, newSponsor] = await Promise.all([
    MlmMembership.findOne({ userId: memberUser._id }).lean(),
    MlmMembership.findOne({ userId: newSponsorUser._id }).lean(),
  ]);

  if (!member || !newSponsor) {
    console.error("Missing MlmMembership document for member or new sponsor", { member, newSponsor });
    process.exit(1);
  }

  let currentSponsorUser = null;
  if (member.sponsorId) {
    currentSponsorUser = await Customer.findById(member.sponsorId).select("_id name userId").lean();
  }

  let binaryParentUser = null;
  if (member.binaryParentId) {
    binaryParentUser = await Customer.findById(member.binaryParentId).select("_id name userId").lean();
  }

  console.log("=== CURRENT STATE ===");
  console.log("Member:", {
    name: memberUser.name,
    userId: memberUser.userId,
    membershipId: String(member._id),
    currentSponsor: currentSponsorUser
      ? { name: currentSponsorUser.name, userId: currentSponsorUser.userId }
      : "None",
  });
  console.log("Genealogy Binary Position (UNTOUCHED):", {
    binaryParent: binaryParentUser ? `${binaryParentUser.name} (${binaryParentUser.userId})` : "Root",
    binaryPosition: member.binaryPosition || "N/A",
  });
  console.log("Expected Old Sponsor:", oldSponsorUser ? `${oldSponsorUser.name} (${oldSponsorUser.userId})` : OLD_SPONSOR_PUBLIC);
  console.log("New Sponsor Target:", `${newSponsorUser.name} (${newSponsorUser.userId})`);

  if (String(member.sponsorId) === String(newSponsorUser._id)) {
    console.log(`\nMember ${MEMBER_PUBLIC} is ALREADY sponsored by ${NEW_SPONSOR_PUBLIC}. Nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  // Cycle check
  const inSubtree = await MlmMembership.exists({
    userId: newSponsorUser._id,
    sponsorChain: memberUser._id,
  });
  if (inSubtree) {
    console.error("REFUSED: New sponsor is inside member's unilevel downline (cycle detected).");
    process.exit(1);
  }

  const stats = await countUnilevelSubtree(memberUser._id);
  console.log("\nUnilevel subtree size of member (incl self):", stats);

  console.log("\nApplying direct sponsor update (Binary Tree Position Remains Untouched)...");

  const runUpdate = async (session = null) => {
    let mq = MlmMembership.findById(member._id);
    let nsq = MlmMembership.findById(newSponsor._id);
    if (session) {
      mq = mq.session(session);
      nsq = nsq.session(session);
    }
    const m = await mq;
    const ns = await nsq;

    const oldSponsorUserId = m.sponsorId;

    // ONLY UPDATE SPONSORSHIP (leave binaryParentId and binaryPosition completely untouched)
    m.sponsorId = ns.userId;
    m.sponsorMembershipId = ns._id;
    m.sponsorChain = await buildSponsorChain(ns, session);
    
    if (session) await m.save({ session });
    else await m.save();

    await rebuildSponsorChainsFrom(m.userId, session);

    if (oldSponsorUserId) {
      const writeOpts = session ? { session } : {};
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
        writeOpts,
      );
    }

    const nsOpts = session ? { session } : {};
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
      nsOpts,
    );

    const syncOpts = session ? { session } : {};
    await syncCustomerMlmProjection(m.userId, syncOpts);
    await syncCustomerMlmProjection(ns.userId, syncOpts);
    if (oldSponsorUserId) {
      await syncCustomerMlmProjection(oldSponsorUserId, syncOpts);
    }
  };

  const session = await mongoose.startSession();
  try {
    try {
      await session.withTransaction(async () => {
        await runUpdate(session);
      });
    } catch (txnError) {
      console.warn("Transaction failed, running without transaction:", txnError.message);
      await runUpdate(null);
    }
  } finally {
    await session.endSession();
  }

  const after = await MlmMembership.findOne({ userId: memberUser._id }).lean();
  const afterSponsor = await Customer.findById(after.sponsorId).select("name userId").lean();
  let afterBinaryParentUser = null;
  if (after.binaryParentId) {
    afterBinaryParentUser = await Customer.findById(after.binaryParentId).select("_id name userId").lean();
  }

  console.log("\n=========================================");
  console.log("SUCCESS! Direct Sponsor Updated:");
  console.log(`Member: ${memberUser.name} (${MEMBER_PUBLIC})`);
  console.log(`New Direct Sponsor: ${afterSponsor?.name || "Unknown"} (${afterSponsor?.userId})`);
  console.log(`Binary Parent (UNTOUCHED): ${afterBinaryParentUser ? `${afterBinaryParentUser.name} (${afterBinaryParentUser.userId})` : "Root"} (${after.binaryPosition || "N/A"})`);
  console.log(`Sponsor Chain Depth: ${after.sponsorChain?.length || 0}`);
  console.log("=========================================\n");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
