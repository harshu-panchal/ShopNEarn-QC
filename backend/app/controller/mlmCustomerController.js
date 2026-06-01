import mongoose from "mongoose";
import handleResponse from "../utils/helper.js";
import Wallet from "../models/wallet.js";
import MlmCommissionEvent from "../models/mlmCommissionEvent.js";
import { OWNER_TYPE } from "../constants/finance.js";
import {
  ALL_MLM_WITHDRAWAL_STATUSES,
  MLM_MEMBERSHIP_STATUS,
} from "../constants/mlm.js";
import {
  getDirectReferrals,
  getMembershipByUserId,
  getUplineChain,
} from "../services/mlm/mlmMembershipService.js";
import { getMlmConfig } from "../services/mlm/mlmConfigService.js";
import {
  cancelWithdrawalRequestByCustomer,
  createWithdrawalRequest,
  listWithdrawalsForCustomer,
} from "../services/mlm/mlmWithdrawalService.js";
import { initiateJoinPayment } from "../services/mlm/mlmJoinService.js";
import {
  createWithdrawalRequestSchema,
  validateMlmSchema,
} from "../validation/mlmValidation.js";

/**
 * GET /api/customer/mlm/membership
 * Returns the customer's membership row (or null) along with the live
 * wallet bucket breakdown and the public-facing MLM config snapshot.
 */
export const getMyMembership = async (req, res) => {
  try {
    const userId = req.user.id;
    const [membership, wallet, cfg] = await Promise.all([
      getMembershipByUserId(userId),
      Wallet.findOne(
        { ownerType: OWNER_TYPE.CUSTOMER, ownerId: userId },
        {
          availableBalance: 1,
          pendingBalance: 1,
          shoppingBalance: 1,
          earningsBalance: 1,
        },
      ).lean(),
      getMlmConfig(),
    ]);

    return handleResponse(res, 200, "MLM membership fetched", {
      enabled: !!cfg.enabled,
      isMember: !!membership,
      membership: membership
        ? {
            referralCode: membership.referralCode,
            planType: membership.planType,
            status: membership.status,
            joinedAt: membership.joinedAt,
            planAJoinedAt: membership.planAJoinedAt,
            planBJoinedAt: membership.planBJoinedAt,
            directReferralsCount: membership.directReferralsCount || 0,
            totalDownlineCount: membership.totalDownlineCount || 0,
            lifetimePlanAEarnings: membership.lifetimePlanAEarnings || 0,
            lifetimePlanBEarnings: membership.lifetimePlanBEarnings || 0,
            homeShoppingUnlocked: !!membership.homeShoppingUnlocked,
            homeShoppingClaimed: !!membership.homeShoppingClaimed,
            sponsorId: membership.sponsorId || null,
            payoutBeneficiary: membership.payoutBeneficiary || null,
            dailyCapTracker: membership.dailyCapTracker || null,
          }
        : null,
      wallet: {
        shoppingBalance: wallet?.shoppingBalance || 0,
        earningsBalance: wallet?.earningsBalance || 0,
        pendingBalance: wallet?.pendingBalance || 0,
        availableBalance: wallet?.availableBalance || 0,
      },
      config: {
        joiningPackagePrice: cfg.joiningPackagePrice,
        joiningPackageShoppingWalletCredit: cfg.joiningPackageShoppingWalletCredit,
        joiningPackageProductId: cfg.joiningPackageProductId,
        withdrawalMinAmount: cfg.withdrawalMinAmount,
        withdrawalAdminChargePercent: cfg.withdrawalAdminChargePercent,
        withdrawalGstOnAdminChargePercent: cfg.withdrawalGstOnAdminChargePercent,
        planBAutoUpgradeAtPlanALifetimeEarnings:
          cfg.planBAutoUpgradeAtPlanALifetimeEarnings,
        directReferralMilestones: cfg.directReferralMilestones,
        repurchaseBonusLevels: cfg.repurchaseBonusLevels,
        mentorRoyaltyLevels: cfg.mentorRoyaltyLevels,
        homeShoppingCommissions: cfg.homeShoppingCommissions,
        dailyEarningCap: cfg.dailyEarningCap,
      },
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/customer/mlm/referral-code — short read used by share buttons. */
export const getMyReferralCode = async (req, res) => {
  try {
    const membership = await getMembershipByUserId(req.user.id);
    if (!membership) {
      return handleResponse(res, 404, "You are not an MLM member yet");
    }
    return handleResponse(res, 200, "Referral code", {
      referralCode: membership.referralCode,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/customer/mlm/direct-referrals */
export const getMyDirectReferrals = async (req, res) => {
  try {
    const userId = req.user.id;
    const list = await getDirectReferrals(userId, {
      limit: parseInt(req.query.limit, 10) || 50,
    });
    const populated = await Promise.all(
      list.map(async (m) => {
        const customer = await mongoose
          .model("User")
          .findById(m.userId, { name: 1, phone: 1, email: 1 })
          .lean();
        return {
          userId: m.userId,
          name: customer?.name || null,
          phone: customer?.phone || null,
          joinedAt: m.joinedAt,
          planType: m.planType,
          directReferralsCount: m.directReferralsCount || 0,
          lifetimeEarnings:
            (m.lifetimePlanAEarnings || 0) + (m.lifetimePlanBEarnings || 0),
        };
      }),
    );
    return handleResponse(res, 200, "Direct referrals", { items: populated });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/customer/mlm/upline?depth=10 */
export const getMyUpline = async (req, res) => {
  try {
    const depth = Math.min(Math.max(parseInt(req.query.depth, 10) || 6, 1), 10);
    const chain = await getUplineChain(req.user.id, depth);
    const items = await Promise.all(
      chain.map(async (m, idx) => {
        const customer = await mongoose
          .model("User")
          .findById(m.userId, { name: 1 })
          .lean();
        return {
          level: idx + 1,
          userId: m.userId,
          name: customer?.name || null,
          planType: m.planType,
          referralCode: m.referralCode,
        };
      }),
    );
    return handleResponse(res, 200, "Upline chain", { items });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/customer/mlm/earnings-summary */
export const getEarningsSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const membership = await getMembershipByUserId(userId);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [totalCredited, totalThisMonth, byType] = await Promise.all([
      MlmCommissionEvent.aggregate([
        { $match: { recipientId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, total: { $sum: "$cappedAmount" } } },
      ]),
      MlmCommissionEvent.aggregate([
        {
          $match: {
            recipientId: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: new Date(today.getFullYear(), today.getMonth(), 1) },
          },
        },
        { $group: { _id: null, total: { $sum: "$cappedAmount" } } },
      ]),
      MlmCommissionEvent.aggregate([
        { $match: { recipientId: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: "$bonusType",
            total: { $sum: "$cappedAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    return handleResponse(res, 200, "Earnings summary", {
      lifetimeEarnings:
        (membership?.lifetimePlanAEarnings || 0) +
        (membership?.lifetimePlanBEarnings || 0),
      lifetimePlanAEarnings: membership?.lifetimePlanAEarnings || 0,
      lifetimePlanBEarnings: membership?.lifetimePlanBEarnings || 0,
      totalCredited: totalCredited[0]?.total || 0,
      totalThisMonth: totalThisMonth[0]?.total || 0,
      byType: byType.map((row) => ({
        bonusType: row._id,
        total: row.total,
        count: row.count,
      })),
      dailyCapTracker: membership?.dailyCapTracker || null,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/customer/mlm/earnings-history?page=1&limit=20&bonusType=... */
export const getEarningsHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const query = { recipientId: userId };
    if (req.query.bonusType) query.bonusType = req.query.bonusType;
    if (req.query.status) query.status = req.query.status;

    const [items, total] = await Promise.all([
      MlmCommissionEvent.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MlmCommissionEvent.countDocuments(query),
    ]);

    return handleResponse(res, 200, "Earnings history", {
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

/** POST /api/customer/mlm/withdrawals */
export const requestWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const membership = await getMembershipByUserId(userId);
    if (!membership || membership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) {
      return handleResponse(res, 403, "Only active MLM members can withdraw");
    }
    const payload = validateMlmSchema(createWithdrawalRequestSchema, req.body || {});
    const request = await createWithdrawalRequest({
      userId,
      amount: payload.amount,
      beneficiary: payload.beneficiary,
      idempotencyKey: payload.idempotencyKey,
    });
    return handleResponse(res, 201, "Withdrawal request submitted", {
      id: request._id,
      amount: request.amount,
      adminCharge: request.adminChargeAmount,
      gst: request.gstAmount,
      net: request.netPayoutAmount,
      status: request.status,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** GET /api/customer/mlm/withdrawals */
export const listMyWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id;
    const status = req.query.status && ALL_MLM_WITHDRAWAL_STATUSES.includes(req.query.status)
      ? req.query.status
      : undefined;
    const result = await listWithdrawalsForCustomer(userId, {
      page: req.query.page,
      limit: req.query.limit,
      status,
    });
    return handleResponse(res, 200, "Withdrawal requests", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/customer/mlm/home-shopping/claim
 *
 * Phase 4 — single-use Home Shopping product claim, available to
 * ACTIVE Plan B members whose `homeShoppingUnlocked` flag is set.
 * Marks `MlmMembership.homeShoppingClaimed = true` and emits an audit
 * row. The actual product fulfilment (creating an Order with
 * `isHomeShoppingOrder: true`) flows through the regular checkout
 * stack — the claim simply unblocks the product from the catalog.
 */
export const claimHomeShopping = async (req, res) => {
  try {
    const userId = req.user.id;
    const membership = await getMembershipByUserId(userId);
    if (!membership) return handleResponse(res, 404, "Not an MLM member");
    if (membership.planType !== "B" || !membership.homeShoppingUnlocked) {
      return handleResponse(res, 403, "Home Shopping is reserved for Plan B members");
    }
    if (membership.homeShoppingClaimed) {
      return handleResponse(res, 200, "Home Shopping already claimed", {
        homeShoppingClaimed: true,
      });
    }
    membership.homeShoppingClaimed = true;
    membership.homeShoppingClaimedAt = new Date();
    await membership.save();
    return handleResponse(res, 200, "Home Shopping unlocked", {
      homeShoppingClaimed: true,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/customer/mlm/join/initiate
 *
 * One-click MLM joining: creates the joining-package Order on the
 * customer's behalf and returns a payment-gateway redirect URL so the
 * frontend can open PhonePe directly without sending the user through
 * cart + checkout + address picker UI.
 *
 * Activation still happens via the existing payment-CAPTURED webhook
 * (`paymentService.processPhonePeWebhook` →
 * `activatePlanAOnJoiningPackagePaid`) — this endpoint only fast-tracks
 * the user from intent to gateway.
 */
export const initiateJoin = async (req, res) => {
  try {
    const userId = req.user.id;
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey || null;
    const result = await initiateJoinPayment({ userId, idempotencyKey });
    return handleResponse(res, 200, "Joining payment initiated", result);
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to initiate joining payment",
      error.code ? { code: error.code } : undefined,
    );
  }
};

/** PATCH /api/customer/mlm/withdrawals/:id/cancel */
export const cancelMyWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id;
    const request = await cancelWithdrawalRequestByCustomer({
      requestId: req.params.id,
      userId,
    });
    return handleResponse(res, 200, "Withdrawal request cancelled", { id: request._id });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};
