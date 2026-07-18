import mongoose from "mongoose";
import MlmMembership from "../../models/mlmMembership.js";
import MlmWithdrawalRequest from "../../models/mlmWithdrawalRequest.js";
import {
  MLM_DEFAULTS,
  MLM_MEMBERSHIP_STATUS,
  MLM_WITHDRAWAL_STATUS,
} from "../../constants/mlm.js";
import { getMlmConfig } from "./mlmConfigService.js";
import { syncCustomerMlmProjection } from "./mlmMembershipService.js";

function makeError(message, statusCode = 400, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function normalizeLeg(leg) {
  const v = String(leg || "").trim().toUpperCase();
  if (v !== "L" && v !== "R") {
    throw makeError("Leg must be L or R.", 422, "LEG_INVALID");
  }
  return v;
}

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

async function collectBinarySubtreeUserIds(rootUserId, { session } = {}) {
  const aggResult = await MlmMembership.aggregate([
    { $match: { userId: rootUserId } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
      },
    },
  ]).session(session || null);

  const ids = new Set([String(rootUserId)]);
  for (const row of aggResult[0]?.descendants || []) {
    ids.add(String(row.userId));
  }
  return ids;
}

async function countUnilevelSubtree(userId, { session } = {}) {
  const rows = await MlmMembership.find(
    {
      $or: [{ userId }, { sponsorChain: userId }],
    },
    { status: 1 },
    session ? { session } : {},
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

async function findBottomUpOccupant(parentUserId, leg, { session } = {}) {
  return MlmMembership.findOne(
    {
      binaryParentId: parentUserId,
      binaryPosition: leg,
      deletedAt: null,
    },
    null,
    session ? { session } : {},
  )
    .populate("userId", "name")
    .lean();
}

function memberLabel(m) {
  if (!m) return "Unknown";
  const name =
    (typeof m.userId === "object" && m.userId?.name) || m.name || "Member";
  const code = m.referralCode || "";
  return code ? `${name} [${code}]` : name;
}

async function loadMoveContext({
  membershipId,
  newParentMembershipId,
  leg,
  changeSponsorToNewParent,
}) {
  if (!mongoose.isValidObjectId(membershipId)) {
    throw makeError("Invalid member id.", 400, "MEMBER_INVALID");
  }
  if (!mongoose.isValidObjectId(newParentMembershipId)) {
    throw makeError("Invalid destination parent id.", 400, "PARENT_INVALID");
  }

  const normalizedLeg = normalizeLeg(leg);

  const [member, newParent] = await Promise.all([
    MlmMembership.findById(membershipId)
      .populate("userId", "name")
      .lean(),
    MlmMembership.findById(newParentMembershipId)
      .populate("userId", "name")
      .lean(),
  ]);

  if (!member || member.deletedAt) {
    throw makeError("Member not found or deleted.", 404, "MEMBER_NOT_FOUND");
  }
  if (!newParent || newParent.deletedAt) {
    throw makeError("Destination parent not found or deleted.", 404, "PARENT_NOT_FOUND");
  }

  const memberUserId = String(member.userId?._id || member.userId);
  const newParentUserId = String(newParent.userId?._id || newParent.userId);

  if (String(member._id) === String(newParent._id)) {
    throw makeError("Cannot move a member under themselves.", 422, "SELF_PARENT");
  }

  const subtreeIds = await collectBinarySubtreeUserIds(member.userId?._id || member.userId);
  if (subtreeIds.has(newParentUserId)) {
    throw makeError(
      "Destination parent is inside the member's binary subtree (would create a cycle).",
      422,
      "CYCLE",
    );
  }

  if (!member.binaryParentId) {
    const hasBinaryChildren =
      member.binaryLeftChildId || member.binaryRightChildId;
    if (hasBinaryChildren) {
      throw makeError(
        "Moving a binary root that still has children is not supported in v1.",
        422,
        "ROOT_WITH_CHILDREN",
      );
    }
  }

  const sameParent =
    String(member.binaryParentId || "") === newParentUserId &&
    member.binaryPosition === normalizedLeg;
  if (sameParent) {
    throw makeError("Member is already in that slot.", 422, "SAME_SLOT");
  }

  const occupant = await findBottomUpOccupant(
    newParent.userId?._id || newParent.userId,
    normalizedLeg,
  );
  if (occupant && String(occupant.userId?._id || occupant.userId) !== memberUserId) {
    throw makeError(
      `Target ${normalizedLeg === "L" ? "left" : "right"} slot is occupied by ${memberLabel(occupant)}.`,
      409,
      "SLOT_TAKEN",
    );
  }

  let oldParent = null;
  if (member.binaryParentId) {
    oldParent = await MlmMembership.findOne({
      userId: member.binaryParentId,
    })
      .populate("userId", "name")
      .lean();
  }

  const willChangeSponsor =
    Boolean(changeSponsorToNewParent) &&
    String(member.sponsorId || "") !== newParentUserId;

  if (changeSponsorToNewParent && subtreeIds.has(newParentUserId)) {
    throw makeError(
      "Cannot set sponsor to a member inside the moved binary subtree.",
      422,
      "SPONSOR_IN_SUBTREE",
    );
  }

  if (willChangeSponsor && !member.sponsorId) {
    // First-time sponsor assignment via move is allowed.
  }

  const binaryAncestors = [];
  let cursor = newParent;
  const seen = new Set();
  while (cursor && !seen.has(String(cursor._id))) {
    seen.add(String(cursor._id));
    binaryAncestors.push({
      membershipId: String(cursor._id),
      referralCode: cursor.referralCode,
      name: memberLabel(cursor),
    });
    if (!cursor.binaryParentId) break;
    cursor = await MlmMembership.findOne({ userId: cursor.binaryParentId }).lean();
  }

  const subtreeSize = subtreeIds.size;
  const unilevelSubtree = willChangeSponsor
    ? await countUnilevelSubtree(member.userId?._id || member.userId)
    : null;

  const validUserIds = [...subtreeIds].filter((id) => mongoose.isValidObjectId(id));
  const pendingWithdrawals =
    validUserIds.length > 0
      ? await MlmWithdrawalRequest.countDocuments({
          userId: { $in: validUserIds },
          status: {
            $in: [MLM_WITHDRAWAL_STATUS.PENDING, MLM_WITHDRAWAL_STATUS.APPROVED],
          },
        })
      : 0;

  const warnings = [
    "Past wallet credits and commission events are not automatically adjusted.",
  ];
  if (willChangeSponsor) {
    warnings.push(
      "Changing the unilevel sponsor does not transfer historical signup or activation bonuses.",
    );
  }
  if (pendingWithdrawals > 0) {
    warnings.push(
      `${pendingWithdrawals} pending withdrawal request(s) in the moved subtree may block earnings recalc.`,
    );
  }

  const recommendedJobIds = ["backfill-binary-team-pair-counts"];
  if (willChangeSponsor) {
    recommendedJobIds.unshift("backfill-leg-direct-counts");
    recommendedJobIds.push("recalculate-downline-counters");
  } else {
    recommendedJobIds.unshift("backfill-leg-direct-counts");
  }

  return {
    member,
    newParent,
    oldParent,
    leg: normalizedLeg,
    memberUserId,
    newParentUserId,
    subtreeIds,
    subtreeSize,
    willChangeSponsor,
    unilevelSubtree,
    binaryAncestors,
    warnings,
    recommendedJobIds,
    before: {
      binaryParent: oldParent
        ? {
            membershipId: String(oldParent._id),
            name: memberLabel(oldParent),
            leg: member.binaryPosition,
          }
        : null,
      sponsorId: member.sponsorId ? String(member.sponsorId) : null,
    },
    after: {
      binaryParent: {
        membershipId: String(newParent._id),
        name: memberLabel(newParent),
        leg: normalizedLeg,
      },
      sponsorId: changeSponsorToNewParent ? newParentUserId : member.sponsorId
        ? String(member.sponsorId)
        : null,
    },
  };
}

export async function previewBinaryMove({
  membershipId,
  newParentMembershipId,
  leg,
  changeSponsorToNewParent = false,
}) {
  const ctx = await loadMoveContext({
    membershipId,
    newParentMembershipId,
    leg,
    changeSponsorToNewParent,
  });

  return {
    member: {
      membershipId: String(ctx.member._id),
      referralCode: ctx.member.referralCode,
      name: memberLabel(ctx.member),
      status: ctx.member.status,
    },
    destination: {
      membershipId: String(ctx.newParent._id),
      referralCode: ctx.newParent.referralCode,
      name: memberLabel(ctx.newParent),
      leg: ctx.leg,
    },
    before: ctx.before,
    after: ctx.after,
    subtreeSize: ctx.subtreeSize,
    willChangeSponsor: ctx.willChangeSponsor,
    binaryAncestorsAffected: ctx.binaryAncestors,
    unilevelSubtree: ctx.unilevelSubtree,
    warnings: ctx.warnings,
    recommendedJobIds: ctx.recommendedJobIds,
  };
}

export async function executeBinaryMove({
  membershipId,
  newParentMembershipId,
  leg,
  changeSponsorToNewParent = false,
  adminId = null,
  reason = null,
}) {
  const preflight = await loadMoveContext({
    membershipId,
    newParentMembershipId,
    leg,
    changeSponsorToNewParent,
  });

  const session = await mongoose.startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      const member = await MlmMembership.findById(membershipId).session(session);
      const newParent = await MlmMembership.findById(newParentMembershipId).session(
        session,
      );
      if (!member || !newParent) {
        throw makeError("Member or parent not found.", 404, "NOT_FOUND");
      }

      const memberUserId = member.userId;
      const newParentUserId = newParent.userId;
      const normalizedLeg = preflight.leg;

      const occupant = await MlmMembership.findOne(
        {
          binaryParentId: newParentUserId,
          binaryPosition: normalizedLeg,
          deletedAt: null,
        },
        null,
        { session },
      );
      if (occupant && String(occupant.userId) !== String(memberUserId)) {
        throw makeError(
          "Target slot was just filled by someone else. Please refresh.",
          409,
          "SLOT_RACE",
        );
      }

      if (member.binaryParentId) {
        const oldParent = await MlmMembership.findOne(
          { userId: member.binaryParentId },
          null,
          { session },
        );
        if (oldParent) {
          if (
            member.binaryPosition === "L" &&
            String(oldParent.binaryLeftChildId) === String(memberUserId)
          ) {
            oldParent.binaryLeftChildId = null;
          }
          if (
            member.binaryPosition === "R" &&
            String(oldParent.binaryRightChildId) === String(memberUserId)
          ) {
            oldParent.binaryRightChildId = null;
          }
          await oldParent.save({ session });
        }
      }

      member.binaryParentId = newParentUserId;
      member.binaryParentMembershipId = newParent._id;
      member.binaryPosition = normalizedLeg;
      member.updatedBy = adminId || null;
      await member.save({ session });

      if (normalizedLeg === "L") {
        newParent.binaryLeftChildId = memberUserId;
      } else {
        newParent.binaryRightChildId = memberUserId;
      }
      await newParent.save({ session });

      if (preflight.willChangeSponsor) {
        const oldSponsorUserId = member.sponsorId;
        const stats = preflight.unilevelSubtree;

        member.sponsorId = newParentUserId;
        member.sponsorMembershipId = newParent._id;
        member.sponsorChain = await buildSponsorChain(newParent, { session });
        await member.save({ session });

        await rebuildSponsorChainsFrom(memberUserId, { session });

        if (oldSponsorUserId) {
          await MlmMembership.updateOne(
            { userId: oldSponsorUserId },
            {
              $inc: {
                directReferralsCount: -1,
                totalDownlineCount: -(stats?.total || 0),
                activeDownlineCount: -(stats?.active || 0),
                inactiveDownlineCount: -(stats?.inactive || 0),
              },
            },
            { session },
          );
        }

        await MlmMembership.updateOne(
          { userId: newParentUserId },
          { $inc: { directReferralsCount: 1 } },
          { session },
        );

        await syncCustomerMlmProjection(memberUserId, { session });
        await syncCustomerMlmProjection(newParentUserId, { session });
        if (oldSponsorUserId) {
          await syncCustomerMlmProjection(oldSponsorUserId, { session });
        }
      }

      result = {
        membershipId: String(member._id),
        movedTo: {
          parentMembershipId: String(newParent._id),
          leg: normalizedLeg,
        },
        sponsorChanged: preflight.willChangeSponsor,
        recommendedJobIds: preflight.recommendedJobIds,
      };
    });
  } finally {
    await session.endSession();
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "mlm_binary_move",
      adminId,
      reason: reason || null,
      membershipId,
      newParentMembershipId,
      leg: preflight.leg,
      changeSponsorToNewParent,
      result,
    }),
  );

  return {
    ...result,
    preview: await previewBinaryMove({
      membershipId,
      newParentMembershipId,
      leg: preflight.leg,
      changeSponsorToNewParent,
    }).catch(() => null),
  };
}
