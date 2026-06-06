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
import {
  approveManualJoiningPayment,
  rejectManualJoiningPayment,
} from "../../services/mlm/mlmJoiningPaymentService.js";
import { adminActivateMembership } from "../../services/mlm/mlmActivationService.js";
import MlmJoiningPayment from "../../models/mlmJoiningPayment.js";
import Customer from "../../models/customer.js";
import { PAYMENT_STATUS } from "../../constants/payment.js";
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
      .populate("userId", "name phone email mlm userId")
      .lean();

    if (req.query.q) {
      const needle = String(req.query.q).toLowerCase();
      items = items.filter((row) => {
        const u = row.userId || {};
        // Phase 7 (PO-request): also match the customer's public
        // User ID so admins can paste it from a support ticket.
        return `${u.name || ""} ${u.phone || ""} ${u.email || ""} ${u.userId || ""} ${row.referralCode || ""}`
          .toLowerCase()
          .includes(needle);
      });
    }

    // Customer-MLM-rebuild Phase 10 — enrich rows with sponsor name +
    // referral code so the admin table can show "sponsor" without a
    // second round-trip. We do this in JS after the main query to keep
    // the index-friendly sort path.
    const sponsorIds = Array.from(
      new Set(
        items
          .map((m) => m.sponsorId)
          .filter(Boolean)
          .map((id) => String(id)),
      ),
    );
    let sponsorMap = new Map();
    if (sponsorIds.length > 0) {
      const sponsors = await MlmMembership.find({
        userId: { $in: sponsorIds },
      })
        .select({ userId: 1, referralCode: 1 })
        .populate("userId", "name phone userId")
        .lean();
      sponsorMap = new Map(
        sponsors.map((s) => [String(s.userId?._id || s.userId), s]),
      );
    }
    items = items.map((row) => ({
      ...row,
      sponsor: row.sponsorId
        ? (() => {
            const sp = sponsorMap.get(String(row.sponsorId));
            if (!sp) return null;
            return {
              name: sp.userId?.name || null,
              phone: sp.userId?.phone || null,
              userId: sp.userId?.userId || null,
              referralCode: sp.referralCode || null,
            };
          })()
        : null,
    }));

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
      .populate("userId", "name phone email mlm walletBalance userId")
      .lean();
    if (!membership) return handleResponse(res, 404, "Member not found");

    const memberUserId = membership.userId._id || membership.userId;

    const [
      directReferrals,
      commissionHistory,
      withdrawals,
      sponsorMembership,
      heldBonusEvents,
    ] = await Promise.all([
      MlmMembership.find({ sponsorId: memberUserId })
        .populate("userId", "name phone email userId")
        .lean(),
      MlmCommissionEvent.find({ recipientId: memberUserId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      MlmWithdrawalRequest.find({ userId: memberUserId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      membership.sponsorId
        ? MlmMembership.findOne({ userId: membership.sponsorId })
            .select({ userId: 1, referralCode: 1, planType: 1, status: 1 })
            .populate("userId", "name phone email userId")
            .lean()
        : null,
      // Customer-MLM-rebuild Phase 10 — held pair bonuses sitting on
      // this member's sponsor, owed because this member is still
      // REGISTERED_UNPAID. Surfaced so admins can quickly see why a
      // sponsor's earnings panel reports a "held" total.
      MlmCommissionEvent.find({
        bonusType: "BINARY_PAIR_MATCH",
        status: "held_awaiting_downline_activation",
        $or: [
          { "meta.leftContributorUserId": memberUserId },
          { "meta.rightContributorUserId": memberUserId },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(25)
        .lean(),
    ]);

    return handleResponse(res, 200, "Member detail", {
      membership,
      directReferrals,
      commissionHistory,
      withdrawals,
      sponsor: sponsorMembership
        ? {
            membershipId: sponsorMembership._id,
            name: sponsorMembership.userId?.name || null,
            phone: sponsorMembership.userId?.phone || null,
            email: sponsorMembership.userId?.email || null,
            userId: sponsorMembership.userId?.userId || null,
            referralCode: sponsorMembership.referralCode || null,
            planType: sponsorMembership.planType || null,
            status: sponsorMembership.status || null,
          }
        : null,
      heldBonusEvents,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/admin/mlm/members/:id/approve
 *
 * Customer-MLM-rebuild Phase 7 (PO-request): admin-initiated Plan A
 * activation, bypassing the joining-payment flow entirely.
 *
 * Use case: support agent confirms a customer should be activated
 * for free (gift / promo / KYC reconciliation / etc.). The customer
 * goes from REGISTERED_UNPAID → ACTIVE without any wallet seed
 * (admin can grant that separately via the Manual Wallet Adjustment
 * panel).
 *
 * Idempotent: re-running on an ACTIVE row returns 200 + skipped.
 * Refuses to approve SUSPENDED / TERMINATED rows.
 */
export const approveMlmMember = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    const result = await adminActivateMembership({
      membershipId: req.params.id,
      adminId: req.user?.id,
      reason,
    });

    // Invalidate any cached admin listings / member detail reads
    // (best-effort — caches that don't exist are no-ops).
    try {
      await invalidate(`/admin/mlm/members`);
      await invalidate(`/admin/mlm/members/${req.params.id}`);
    } catch (_) {
      /* non-fatal */
    }

    if (result.skipped) {
      return handleResponse(
        res,
        200,
        "Member is already active.",
        { skipped: true, reason: result.reason },
      );
    }

    return handleResponse(res, 200, "Member approved for Plan A", {
      activated: true,
      releasedHeldBonusCount: result.releasedEvents?.length || 0,
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message,
      error.code ? { code: error.code } : {},
    );
  }
};

/**
 * GET /api/admin/mlm/members/:id/downline?depth=<n>
 *
 * Build the BINARY PLACEMENT tree (Plan A's left/right genealogy)
 * rooted at the given member.
 *
 * Depth semantics:
 *   - omitted / 0 / non-positive → returns the FULL downline tree
 *     (capped at `MAX_TREE_DEPTH = 50` as a runaway safety bound)
 *   - positive integer           → clamped to [1, MAX_TREE_DEPTH]
 *
 * Each node has at most two children, returned on the shape
 * `{ left, right }` so the UI can render proper left/right legs
 * instead of a flat list of sponsor referrals.
 *
 * Note: this intentionally walks `binaryLeftChildId` /
 * `binaryRightChildId`, NOT `sponsorId`. A sponsor's referrals can
 * spill over the binary tree (e.g. all 4 of vini's referrals end
 * up in the same leg), so the sponsor view collapses into a flat
 * list at depth 1 and is misleading. The binary view is the one
 * that actually drives pair-match earnings and correctly renders
 * each member's two-child structure.
 */
export const getMlmMemberDownlineTree = async (req, res) => {
  try {
    // See the doc-comment above for depth semantics. `0` or any
    // non-positive value means "fetch the whole downline up to the
    // safety cap"; positive values are clamped to that cap.
    const MAX_TREE_DEPTH = 50;
    const rawDepth = parseInt(req.query.depth, 10);
    const depth = Number.isFinite(rawDepth) && rawDepth > 0
      ? Math.min(rawDepth, MAX_TREE_DEPTH)
      : MAX_TREE_DEPTH;
    const membership = await MlmMembership.findById(req.params.id)
      .populate("userId", "name phone email userId")
      .lean();
    if (!membership) return handleResponse(res, 404, "Member not found");

    const tree = await buildBinaryDownlineTree(membership, depth, null);
    return handleResponse(res, 200, "Downline tree", {
      depth,
      tree,
      rootMembershipId: String(membership._id),
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * Recursive binary-tree walker. Returns a node shaped as
 *   { ...meta, position, left: <node|null>, right: <node|null> }
 * `position` is the position THIS node occupies under its parent
 * ("L"/"R"/null for root) — the UI uses it for per-row labels.
 *
 * Per-node payload mirrors the customer-side `buildCustomerBinaryTree`
 * so the same `GenealogyTreeCanvas` component (shared in
 * `frontend/src/shared/components/mlm/`) can render either tree with
 * an identical tooltip. The User document's `userId` (public-facing
 * SE-prefixed ID) is populated so the tooltip's "User ID" row reads
 * the human-facing identifier directly without an extra round-trip.
 */
async function buildBinaryDownlineTree(rootMembership, depthLeft, position) {
  const u = rootMembership.userId || {};
  const node = {
    _id: rootMembership._id,
    userId: rootMembership.userId,
    name: u?.name || null,
    phone: u?.phone || null,
    publicUserId: u?.userId || null,
    referralCode: rootMembership.referralCode,
    planType: rootMembership.planType,
    status: rootMembership.status,
    position,
    joinedAt: rootMembership.joinedAt || null,
    planAJoinedAt: rootMembership.planAJoinedAt || null,
    directReferralsCount: rootMembership.directReferralsCount || 0,
    totalDownlineCount: rootMembership.totalDownlineCount || 0,
    leftLegDirectCount: rootMembership.leftLegDirectCount || 0,
    rightLegDirectCount: rootMembership.rightLegDirectCount || 0,
    pairsCompleted: rootMembership.pairsCompleted || 0,
    lifetimePlanAEarnings: rootMembership.lifetimePlanAEarnings || 0,
    lifetimePlanBEarnings: rootMembership.lifetimePlanBEarnings || 0,
    left: null,
    right: null,
  };
  if (depthLeft <= 0) return node;

  const [leftChild, rightChild] = await Promise.all([
    rootMembership.binaryLeftChildId
      ? MlmMembership.findOne({ userId: rootMembership.binaryLeftChildId })
          .populate("userId", "name phone userId")
          .lean()
      : null,
    rootMembership.binaryRightChildId
      ? MlmMembership.findOne({ userId: rootMembership.binaryRightChildId })
          .populate("userId", "name phone userId")
          .lean()
      : null,
  ]);

  if (leftChild) {
    node.left = await buildBinaryDownlineTree(leftChild, depthLeft - 1, "L");
  }
  if (rightChild) {
    node.right = await buildBinaryDownlineTree(rightChild, depthLeft - 1, "R");
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

/* ───────── Manual-QR joining payment review queue (Phase X) ───────── */

const JOINING_REVIEW_STATUS_OPTIONS = Object.freeze([
  PAYMENT_STATUS.CREATED, // proof not yet submitted
  PAYMENT_STATUS.PENDING_REVIEW,
  PAYMENT_STATUS.CAPTURED, // approved
  PAYMENT_STATUS.FAILED, // rejected
]);

/**
 * GET /api/admin/mlm/joining-reviews?status=&q=&page=&limit=
 *
 * Lists manual-QR joining payments for admin review. Default status
 * filter is `PENDING_REVIEW`; pass `?status=ALL` to drop the filter.
 * `q` matches the customer's name or phone, or the submitted
 * transaction id (case-insensitive substring).
 */
export const listJoiningReviews = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      100,
    );
    const skip = (page - 1) * limit;

    const requestedStatus = String(req.query.status || "").toUpperCase();
    const filter = { paymentMode: "manual_qr" };
    if (requestedStatus && requestedStatus !== "ALL") {
      if (!JOINING_REVIEW_STATUS_OPTIONS.includes(requestedStatus)) {
        return handleResponse(res, 400, "Invalid status filter");
      }
      filter.status = requestedStatus;
    } else if (!requestedStatus) {
      filter.status = PAYMENT_STATUS.PENDING_REVIEW;
    }

    let cursor = MlmJoiningPayment.find(filter)
      .sort({
        // Surface unsubmitted/under-review first; admin queue is
        // append-friendly. Falling back to createdAt desc keeps
        // history pages stable.
        updatedAt: -1,
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean();

    let items = await cursor;
    const customerIds = [...new Set(items.map((p) => String(p.customer)))];
    const customers = customerIds.length
      ? await Customer.find(
          { _id: { $in: customerIds } },
          { name: 1, phone: 1, email: 1 },
        ).lean()
      : [];
    const customerMap = new Map(customers.map((c) => [String(c._id), c]));

    let total = await MlmJoiningPayment.countDocuments(filter);

    // q = phone / name / txnId substring. Done in-memory after the
    // page slice because the customer name lives on a different
    // collection and txnId is on a nested sub-doc; for the expected
    // queue size (tens to a few hundred PENDING) this is fine.
    if (req.query.q) {
      const needle = String(req.query.q).trim().toLowerCase();
      items = items.filter((row) => {
        const c = customerMap.get(String(row.customer)) || {};
        const txn = row.manualPaymentDetails?.transactionId || "";
        return (
          (c.name || "").toLowerCase().includes(needle) ||
          (c.phone || "").toLowerCase().includes(needle) ||
          (c.email || "").toLowerCase().includes(needle) ||
          txn.toLowerCase().includes(needle)
        );
      });
    }

    const enriched = items.map((row) => {
      const c = customerMap.get(String(row.customer)) || {};
      return {
        _id: row._id,
        paymentId: String(row._id),
        customer: {
          id: String(row.customer),
          name: c.name || null,
          phone: c.phone || null,
          email: c.email || null,
        },
        sponsorReferralCode: row.sponsorReferralCodeSnapshot || null,
        amount: row.joiningPriceSnapshot,
        shoppingCredit: row.shoppingCreditSnapshot,
        status: row.status,
        paymentMode: row.paymentMode,
        transactionId: row.manualPaymentDetails?.transactionId || null,
        screenshotUrl: row.manualPaymentDetails?.screenshotUrl || null,
        paidAmount: row.manualPaymentDetails?.paidAmount || null,
        submittedAt: row.manualPaymentDetails?.submittedAt || null,
        reviewedAt: row.reviewedAt || null,
        reviewedBy: row.reviewedBy ? String(row.reviewedBy) : null,
        adminRemarks: row.adminRemarks || null,
        failureReason: row.failureReason || null,
        activationApplied: !!row.activationApplied,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return handleResponse(res, 200, "Joining reviews", {
      items: enriched,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** POST /api/admin/mlm/joining-reviews/:id/approve */
export const approveJoiningReview = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const { adminRemarks } = req.body || {};
    const payment = await approveManualJoiningPayment({
      paymentId: req.params.id,
      adminId,
      adminRemarks,
    });
    return handleResponse(res, 200, "Payment approved", {
      paymentId: String(payment._id),
      status: payment.status,
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 400,
      error.message,
      error.code ? { code: error.code } : undefined,
    );
  }
};

/** POST /api/admin/mlm/joining-reviews/:id/reject */
export const rejectJoiningReview = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const { reason } = req.body || {};
    const payment = await rejectManualJoiningPayment({
      paymentId: req.params.id,
      adminId,
      reason,
    });
    return handleResponse(res, 200, "Payment rejected", {
      paymentId: String(payment._id),
      status: payment.status,
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 400,
      error.message,
      error.code ? { code: error.code } : undefined,
    );
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
