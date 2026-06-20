/**
 * Reparent Abdulwahab's unilevel sponsor from Abdulmustakim to Yasminbanu
 * so he appears in Yasmin's "Direct Referrals" list (sponsorId query).
 *
 * Binary placement (Yasmin.R) is unchanged — only sponsorId / sponsorChain /
 * direct-referral counters are updated.
 *
 * Usage:
 *   node scripts/reparentAbdulwahabSponsor.js
 *   node scripts/reparentAbdulwahabSponsor.js --commit
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js";
import { MLM_MEMBERSHIP_STATUS, MLM_DEFAULTS } from "../app/constants/mlm.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";

const COMMIT = process.argv.includes("--commit");

const PLAYERS = {
  yasminbanu: "SE8P8JS4GC",
  abdulwahab: "SEUJMP3M85",
  abdulmustakim: "SE2CXE6WVG",
};

async function buildSponsorChain(sponsorMembership, { session } = {}) {
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

async function rebuildSponsorChainsFrom(userId, { session }) {
  const member = await MlmMembership.findOne({ userId }, null, { session });
  if (!member) return;

  if (member.sponsorId) {
    const sponsor = await MlmMembership.findOne(
      { userId: member.sponsorId },
      null,
      { session },
    );
    member.sponsorChain = await buildSponsorChain(sponsor, { session });
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

async function countSubtree(userId) {
  const rows = await MlmMembership.find(
    {
      $or: [{ userId }, { sponsorChain: userId }],
    },
    { status: 1 },
  ).lean();

  let active = 0;
  let inactive = 0;
  for (const row of rows) {
    if (row.status === MLM_MEMBERSHIP_STATUS.ACTIVE) active += 1;
    else if (row.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID) {
      inactive += 1;
    }
  }
  return { total: rows.length, active, inactive };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [yasminbanu, abdulwahab, abdulmustakim] = await Promise.all([
        MlmMembership.findOne({ referralCode: PLAYERS.yasminbanu }, null, {
          session,
        }).populate("userId", "name"),
        MlmMembership.findOne({ referralCode: PLAYERS.abdulwahab }, null, {
          session,
        }).populate("userId", "name"),
        MlmMembership.findOne({ referralCode: PLAYERS.abdulmustakim }, null, {
          session,
        }).populate("userId", "name"),
      ]);

      if (!yasminbanu || !abdulwahab || !abdulmustakim) {
        throw new Error("One or more members not found.");
      }

      const yasminUid = yasminbanu.userId._id;
      const abdulwahabUid = abdulwahab.userId._id;
      const abdulmustakimUid = abdulmustakim.userId._id;

      console.log("\n--- BEFORE ---");
      console.log(
        `Abdulwahab sponsorId=${abdulwahab.sponsorId} (expect Abdulmustakim ${abdulmustakimUid})`,
      );
      console.log(
        `Yasmin directReferralsCount=${yasminbanu.directReferralsCount}`,
      );
      console.log(
        `Abdulmustakim directReferralsCount=${abdulmustakim.directReferralsCount}`,
      );

      if (
        String(abdulwahab.sponsorId) === String(yasminUid) &&
        String(abdulwahab.sponsorMembershipId) === String(yasminbanu._id)
      ) {
        console.log("\nAlready reparented — Abdulwahab is Yasmin's direct referral.");
        if (!COMMIT) {
          const dryRun = new Error("__DRY_RUN_ABORT__");
          dryRun.dryRun = true;
          throw dryRun;
        }
        return;
      }

      if (String(abdulwahab.sponsorId) !== String(abdulmustakimUid)) {
        throw new Error(
          `Unexpected sponsor ${abdulwahab.sponsorId}; expected Abdulmustakim ${abdulmustakimUid}.`,
        );
      }

      const subtree = await countSubtree(abdulwahabUid);
      console.log(
        `\nSubtree to move: ${subtree.total} members (${subtree.active} active, ${subtree.inactive} inactive)`,
      );

      abdulwahab.sponsorId = yasminUid;
      abdulwahab.sponsorMembershipId = yasminbanu._id;
      abdulwahab.sponsorChain = await buildSponsorChain(yasminbanu, {
        session,
      });
      await abdulwahab.save({ session });

      await rebuildSponsorChainsFrom(abdulwahabUid, { session });

      await MlmMembership.updateOne(
        { userId: abdulmustakimUid },
        {
          $inc: {
            directReferralsCount: -1,
            totalDownlineCount: -subtree.total,
            activeDownlineCount: -subtree.active,
            inactiveDownlineCount: -subtree.inactive,
          },
        },
        { session },
      );

      await MlmMembership.updateOne(
        { userId: yasminUid },
        { $inc: { directReferralsCount: 1 } },
        { session },
      );

      await syncCustomerMlmProjection(abdulwahabUid, { session });
      await syncCustomerMlmProjection(yasminUid, { session });
      await syncCustomerMlmProjection(abdulmustakimUid, { session });

      const yasminDirects = await MlmMembership.find(
        { sponsorId: yasminUid },
        null,
        { session },
      )
        .populate("userId", "name")
        .lean();

      console.log("\n--- AFTER (pending commit) ---");
      console.log(`Yasmin directReferralsCount → ${yasminbanu.directReferralsCount + 1}`);
      console.log(`Abdulmustakim directReferralsCount → ${abdulmustakim.directReferralsCount - 1}`);
      console.log(
        "Yasmin directs:",
        yasminDirects
          .map((d) => d.userId?.name || d.referralCode)
          .sort()
          .join(", "),
      );
      console.log(
        `Abdulwahab listed under Yasmin: ${yasminDirects.some((d) => String(d.userId?._id) === String(abdulwahabUid))}`,
      );

      if (!COMMIT) {
        const dryRun = new Error("__DRY_RUN_ABORT__");
        dryRun.dryRun = true;
        throw dryRun;
      }
    });

    if (COMMIT) {
      console.log("\nCommitted. Abdulwahab is Yasmin's direct unilevel referral.");
    }
  } catch (err) {
    if (err.dryRun) {
      console.log("\nDry-run OK. Re-run with --commit to persist.");
    } else {
      console.error("\nERROR:", err);
      process.exitCode = 1;
    }
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
