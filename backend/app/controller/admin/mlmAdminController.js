import mongoose from "mongoose";
import handleResponse from "../../utils/helper.js";
import Setting from "../../models/setting.js";
import MlmMembership from "../../models/mlmMembership.js";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import MlmWithdrawalRequest from "../../models/mlmWithdrawalRequest.js";
import MlmRewardMilestone from "../../models/mlmRewardMilestone.js";
import {
  ALL_MLM_MILESTONE_REWARD_TYPES,
  ALL_MLM_MILESTONE_TYPES,
  ALL_MLM_PLAN_TYPES,
  ALL_MLM_WITHDRAWAL_STATUSES,
  MLM_BONUS_TYPE,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { LEDGER_TRANSACTION_TYPE, OWNER_TYPE } from "../../constants/finance.js";
import {
  approveWithdrawalRequest,
  listWithdrawalsForAdmin,
  rejectWithdrawalRequest,
} from "../../services/mlm/mlmWithdrawalService.js";
import { creditWallet, debitWallet } from "../../services/finance/walletService.js";
import { invalidate } from "../../services/cacheService.js";
import {
  updateMlmSettingsSchema,
  validateMlmSchema,
} from "../../validation/mlmValidation.js";
import {
  getMembershipByUserId,
  syncCustomerMlmProjection,
} from "../../services/mlm/mlmMembershipService.js";
import { getMlmConfig } from "../../services/mlm/mlmConfigService.js";
import { verifyMlmMemberWallet } from "../../jobs/mlmWalletLedgerVerifierJob.js";

/**
 * GET /api/admin/mlm/dashboard
 * Top-level KPIs for the MLM module: member counts, lifetime payouts,
 * pending withdrawals, and today's daily-cap usage.
 */
export const getMlmDashboard = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalMembers,
      planACount,
      planBCount,
      totalLifetimePayouts,
      pendingWithdrawals,
      pendingWithdrawalsAmount,
      todayCreditedAgg,
      todayCappedRolloverAgg,
      activeMembersTodayCap,
      pendingClawbackAgg,
    ] = await Promise.all([
      MlmMembership.countDocuments({}),
      MlmMembership.countDocuments({ planType: MLM_PLAN_TYPE.A }),
      MlmMembership.countDocuments({ planType: MLM_PLAN_TYPE.B }),
      MlmCommissionEvent.aggregate([
        { $match: { status: "credited" } },
        { $group: { _id: null, total: { $sum: "$cappedAmount" } } },
      ]),
      MlmWithdrawalRequest.countDocuments({ status: "pending" }),
      MlmWithdrawalRequest.aggregate([
        { $match: { status: "pending" } },
        { $group: { _id: null, total: { $sum: "$netPayoutAmount" } } },
      ]),
      MlmCommissionEvent.aggregate([
        {
          $match: {
            status: "credited",
            createdAt: { $gte: todayStart },
          },
        },
        { $group: { _id: null, total: { $sum: "$cappedAmount" }, count: { $sum: 1 } } },
      ]),
      MlmCommissionEvent.aggregate([
        {
          $match: {
            status: "capped_rollover",
            rolledOverAt: { $exists: false },
            rolloverAmount: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: "$rolloverAmount" }, count: { $sum: 1 } } },
      ]),
      // Phase 3: today's cap usage aggregate for the dashboard widget.
      MlmMembership.aggregate([
        { $match: { "dailyCapTracker.usedAmount": { $gt: 0 } } },
        {
          $group: {
            _id: null,
            usedToday: { $sum: "$dailyCapTracker.usedAmount" },
            activeMembers: { $sum: 1 },
          },
        },
      ]),
      // Phase 3: outstanding clawbacks awaiting reconciliation.
      MlmCommissionEvent.aggregate([
        {
          $match: {
            clawbackAt: { $exists: true },
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        },
        { $group: { _id: null, total: { $sum: "$clawbackAmount" }, count: { $sum: 1 } } },
      ]),
    ]);

    return handleResponse(res, 200, "MLM dashboard", {
      totalMembers,
      planACount,
      planBCount,
      totalLifetimePayouts: totalLifetimePayouts[0]?.total || 0,
      pendingWithdrawals,
      pendingWithdrawalsAmount: pendingWithdrawalsAmount[0]?.total || 0,
      today: {
        creditedToday: todayCreditedAgg[0]?.total || 0,
        creditedEventsToday: todayCreditedAgg[0]?.count || 0,
        capUsedToday: activeMembersTodayCap[0]?.usedToday || 0,
        activeMembersHittingCap: activeMembersTodayCap[0]?.activeMembers || 0,
      },
      capRollover: {
        pendingAmount: todayCappedRolloverAgg[0]?.total || 0,
        pendingEvents: todayCappedRolloverAgg[0]?.count || 0,
      },
      clawback: {
        last30Days: pendingClawbackAgg[0]?.total || 0,
        events: pendingClawbackAgg[0]?.count || 0,
      },
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * GET /api/admin/mlm/members?page=&limit=&q=&planType=&status=
 */
export const listMlmMembers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.planType && ALL_MLM_PLAN_TYPES.includes(req.query.planType)) {
      query.planType = req.query.planType;
    }
    if (req.query.status) query.status = req.query.status;

    let items = await MlmMembership.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name phone email mlm")
      .lean();

    if (req.query.q) {
      const needle = String(req.query.q).toLowerCase();
      items = items.filter((row) => {
        const u = row.userId || {};
        return `${u.name || ""} ${u.phone || ""} ${u.email || ""} ${row.referralCode || ""}`
          .toLowerCase()
          .includes(needle);
      });
    }

    const total = await MlmMembership.countDocuments(query);

    return handleResponse(res, 200, "MLM members", {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/admin/mlm/members/:id */
export const getMlmMemberDetail = async (req, res) => {
  try {
    const membership = await MlmMembership.findById(req.params.id)
      .populate("userId", "name phone email mlm walletBalance")
      .lean();
    if (!membership) return handleResponse(res, 404, "Member not found");

    const [directReferrals, commissionHistory, withdrawals] = await Promise.all([
      MlmMembership.find({ sponsorId: membership.userId._id || membership.userId })
        .populate("userId", "name phone")
        .lean(),
      MlmCommissionEvent.find({ recipientId: membership.userId._id || membership.userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      MlmWithdrawalRequest.find({ userId: membership.userId._id || membership.userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    return handleResponse(res, 200, "Member detail", {
      membership,
      directReferrals,
      commissionHistory,
      withdrawals,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * GET /api/admin/mlm/members/:id/downline?depth=4
 *
 * Phase 2: build a recursive downline tree for the given member up to
 * `depth` levels (default 4, max 6). Each node carries the member's
 * referral code, plan type, direct count, lifetime earnings, and an
 * `children` array. Designed for the admin member-detail downline
 * visualisation; bounded by `depth` to keep payload size sane.
 */
export const getMlmMemberDownlineTree = async (req, res) => {
  try {
    const depth = Math.min(Math.max(parseInt(req.query.depth, 10) || 4, 1), 6);
    const membership = await MlmMembership.findById(req.params.id)
      .populate("userId", "name phone email")
      .lean();
    if (!membership) return handleResponse(res, 404, "Member not found");

    const tree = await buildDownlineTree(membership, depth);
    return handleResponse(res, 200, "Downline tree", { depth, tree });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

async function buildDownlineTree(rootMembership, depthLeft) {
  const node = {
    _id: rootMembership._id,
    userId: rootMembership.userId?._id || rootMembership.userId,
    name: rootMembership.userId?.name || null,
    phone: rootMembership.userId?.phone || null,
    referralCode: rootMembership.referralCode,
    planType: rootMembership.planType,
    status: rootMembership.status,
    directReferralsCount: rootMembership.directReferralsCount || 0,
    totalDownlineCount: rootMembership.totalDownlineCount || 0,
    lifetimePlanAEarnings: rootMembership.lifetimePlanAEarnings || 0,
    lifetimePlanBEarnings: rootMembership.lifetimePlanBEarnings || 0,
    children: [],
  };
  if (depthLeft <= 0) return node;

  const rootUserId = rootMembership.userId?._id || rootMembership.userId;
  const children = await MlmMembership.find({ sponsorId: rootUserId })
    .sort({ createdAt: 1 })
    .populate("userId", "name phone")
    .lean();

  for (const child of children) {
    node.children.push(await buildDownlineTree(child, depthLeft - 1));
  }
  return node;
}

/** GET /api/admin/mlm/withdrawals */
export const listAdminWithdrawals = async (req, res) => {
  try {
    const status = req.query.status && ALL_MLM_WITHDRAWAL_STATUSES.includes(req.query.status)
      ? req.query.status
      : undefined;
    const result = await listWithdrawalsForAdmin({
      page: req.query.page,
      limit: req.query.limit,
      status,
      q: req.query.q,
    });
    return handleResponse(res, 200, "Withdrawal queue", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** POST /api/admin/mlm/withdrawals/:id/approve */
export const approveWithdrawal = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const { payoutReference, adminRemarks } = req.body || {};
    const request = await approveWithdrawalRequest({
      requestId: req.params.id,
      adminId,
      payoutReference,
      adminRemarks,
    });
    return handleResponse(res, 200, "Withdrawal approved", { id: request._id });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** POST /api/admin/mlm/withdrawals/:id/reject */
export const rejectWithdrawal = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return handleResponse(res, 400, "Rejection reason is required");
    }
    const request = await rejectWithdrawalRequest({
      requestId: req.params.id,
      adminId,
      reason: String(reason).trim(),
    });
    return handleResponse(res, 200, "Withdrawal rejected", { id: request._id });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** GET /api/admin/mlm/settings — returns the merged MLM rate sheet */
export const getMlmSettings = async (req, res) => {
  try {
    const cfg = await getMlmConfig();
    return handleResponse(res, 200, "MLM settings", cfg);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** PUT /api/admin/mlm/settings */
export const updateMlmSettings = async (req, res) => {
  try {
    const payload = validateMlmSchema(updateMlmSettingsSchema, req.body || {});
    const tenantId = req.tenantId ?? null;
    const filter = tenantId
      ? { tenantId }
      : { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] };

    const toSet = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue;
      toSet[`mlm.${k}`] = v;
    }
    if (Object.keys(toSet).length === 0) {
      return handleResponse(res, 200, "Settings unchanged", await getMlmConfig());
    }
    await Setting.findOneAndUpdate(filter, { $set: toSet }, { upsert: true, new: true });
    await invalidate("cache:platform:settings:*");
    return handleResponse(res, 200, "MLM settings updated", await getMlmConfig());
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/* ───────── MLM Reward Milestones (Phase 4) — admin CRUD ───────── */

/** GET /api/admin/mlm/milestone-rules */
export const listMilestoneRules = async (req, res) => {
  try {
    const items = await MlmRewardMilestone.find({})
      .sort({ active: -1, milestoneType: 1, threshold: 1 })
      .lean();
    return handleResponse(res, 200, "Milestone rules", { items });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** POST /api/admin/mlm/milestone-rules */
export const createMilestoneRule = async (req, res) => {
  try {
    const payload = sanitizeMilestonePayload(req.body || {});
    if (!ALL_MLM_MILESTONE_TYPES.includes(payload.milestoneType)) {
      return handleResponse(res, 400, "Invalid milestoneType");
    }
    if (!ALL_MLM_MILESTONE_REWARD_TYPES.includes(payload.rewardType)) {
      return handleResponse(res, 400, "Invalid rewardType");
    }
    const doc = await MlmRewardMilestone.create(payload);
    return handleResponse(res, 201, "Milestone created", doc);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** PUT /api/admin/mlm/milestone-rules/:id */
export const updateMilestoneRule = async (req, res) => {
  try {
    const payload = sanitizeMilestonePayload(req.body || {});
    const doc = await MlmRewardMilestone.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true },
    );
    if (!doc) return handleResponse(res, 404, "Milestone not found");
    return handleResponse(res, 200, "Milestone updated", doc);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** DELETE /api/admin/mlm/milestone-rules/:id — soft delete */
export const deleteMilestoneRule = async (req, res) => {
  try {
    const doc = await MlmRewardMilestone.findById(req.params.id);
    if (!doc) return handleResponse(res, 404, "Milestone not found");
    doc.deletedAt = new Date();
    doc.deletedBy = req.user?.id || null;
    doc.active = false;
    await doc.save();
    return handleResponse(res, 200, "Milestone deleted", { id: doc._id });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

function sanitizeMilestonePayload(raw) {
  const out = {};
  const passthrough = [
    "name",
    "milestoneType",
    "threshold",
    "rewardType",
    "rewardAmount",
    "couponId",
    "planRequired",
    "active",
  ];
  for (const k of passthrough) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  if (out.threshold !== undefined) out.threshold = Number(out.threshold) || 0;
  if (out.rewardAmount !== undefined) out.rewardAmount = Number(out.rewardAmount) || 0;
  if (out.active !== undefined) out.active = !!out.active;
  if (out.couponId === "") out.couponId = null;
  if (out.planRequired && !["A", "B", "ANY"].includes(out.planRequired)) {
    out.planRequired = "ANY";
  }
  return out;
}

/**
 * POST /api/admin/mlm/members/:id/adjust-wallet
 * Manual wallet adjustment by an admin — credits or debits the
 * customer's earnings wallet with a paired ledger entry + audit row.
 * Phase 1 is intentionally minimal; Phase 5 builds the full
 * compensation tool around this.
 */
export const adjustMemberWallet = async (req, res) => {
  try {
    const { amount, direction, reason, bucket = "earnings" } = req.body || {};
    if (!amount || Number(amount) <= 0) {
      return handleResponse(res, 400, "Amount must be greater than 0");
    }
    if (!["CREDIT", "DEBIT"].includes(String(direction).toUpperCase())) {
      return handleResponse(res, 400, "direction must be CREDIT or DEBIT");
    }
    if (!reason || !String(reason).trim()) {
      return handleResponse(res, 400, "reason is required");
    }
    const membership = await MlmMembership.findById(req.params.id);
    if (!membership) return handleResponse(res, 404, "Member not found");

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.MANUAL_ADJUSTMENT}-${req.params.id}-${Date.now()}`;
    const session = await mongoose.startSession();
    try {
      let event;
      await session.withTransaction(async () => {
        const args = {
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: membership.userId,
          amount: Number(amount),
          bucket: ["available", "pending", "shopping", "earnings"].includes(bucket)
            ? bucket
            : "earnings",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
          ledgerReference: idempotencyKey,
          ledgerDescription: `Manual admin adjustment: ${reason}`,
          idempotencyKey,
          metadata: {
            adminId: req.user?.id ? String(req.user.id) : null,
            reason: String(reason).trim(),
          },
          syncUserWalletBalance: bucket === "available",
        };
        if (String(direction).toUpperCase() === "CREDIT") {
          event = await creditWallet(args);
        } else {
          event = await debitWallet(args);
        }
        // Audit row in MlmCommissionEvent for visibility on the
        // member-detail page commission history.
        await MlmCommissionEvent.create(
          [
            {
              recipientId: membership.userId,
              recipientMembershipId: membership._id,
              sourceUserId: req.user?.id || null,
              bonusType: MLM_BONUS_TYPE.MANUAL_ADJUSTMENT,
              planType: membership.planType,
              level: null,
              baseAmount: 0,
              ratePercent: null,
              bonusAmount: Number(amount),
              cappedAmount: String(direction).toUpperCase() === "CREDIT" ? Number(amount) : -Number(amount),
              rolloverAmount: 0,
              walletBucket: args.bucket,
              ledgerEntryId: event?.ledgerEntry?._id || null,
              status: "credited",
              idempotencyKey,
              description: `Manual admin adjustment: ${reason}`,
              meta: { adminId: req.user?.id ? String(req.user.id) : null, direction: String(direction).toUpperCase() },
            },
          ],
          { session },
        );
        await syncCustomerMlmProjection(membership.userId, { session });
      });
      return handleResponse(res, 200, "Wallet adjusted", { idempotencyKey });
    } finally {
      session.endSession();
    }
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/**
 * GET /api/admin/mlm/members/:id/wallet-verification
 * On-demand reconciliation between the member's Wallet buckets and
 * the LedgerEntry journal. Returns `{ drift, breakdown, ledger }`.
 * Read-only.
 */
export const verifyMemberWalletEndpoint = async (req, res) => {
  try {
    const membership = await MlmMembership.findById(req.params.id).select({ userId: 1 }).lean();
    if (!membership) return handleResponse(res, 404, "Member not found");
    const result = await verifyMlmMemberWallet(membership.userId);
    if (!result) return handleResponse(res, 404, "Wallet not found");
    return handleResponse(res, 200, "Verification complete", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};
