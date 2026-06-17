import mongoose from "mongoose";
import handleResponse from "../utils/helper.js";
import Wallet from "../models/wallet.js";
import LedgerEntry from "../models/ledgerEntry.js";
import MlmMembership from "../models/mlmMembership.js";
import MlmCommissionEvent from "../models/mlmCommissionEvent.js";
import MlmWithdrawalRequest from "../models/mlmWithdrawalRequest.js";
import { OWNER_TYPE } from "../constants/finance.js";
import {
  ALL_MLM_WITHDRAWAL_STATUSES,
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_WITHDRAWAL_STATUS,
} from "../constants/mlm.js";
import {
  getDirectReferrals,
  getMembershipByUserId,
  getUplineChain,
} from "../services/mlm/mlmMembershipService.js";
import { createMemberInBinarySlot } from "../services/mlm/mlmManualSlotPlacementService.js";
import {
  buildBinaryTreeBottomUp,
  classifyDirectReferralsByLegUnderRoot,
} from "../services/mlm/mlmBinaryTreeBuilder.js";
import {
  getManualQrConfig,
  getMlmConfig,
  getPlanAPairBonusForPairIndex,
} from "../services/mlm/mlmConfigService.js";
import {
  cancelWithdrawalRequestByCustomer,
  createWithdrawalRequest,
  listWithdrawalsForCustomer,
} from "../services/mlm/mlmWithdrawalService.js";
import {
  getLatestPendingJoiningPaymentForCustomer,
  getManualJoiningPaymentForCustomer,
  initiateJoiningPayment,
  submitManualPaymentProof,
} from "../services/mlm/mlmJoiningPaymentService.js";
import {
  createWithdrawalRequestSchema,
  validateMlmSchema,
} from "../validation/mlmValidation.js";

/* ===============================
   Customer-MLM-rebuild Phase 5 — helpers
================================ */

/**
 * Mask a phone number for downline privacy:
 *   "+919876543210" -> "+91••••3210"
 * The first 3 chars (e.g. country code) and last 4 digits remain
 * visible; everything else is dots. Returns the original input if it's
 * too short to mask.
 */
function maskPhoneForDownline(phone) {
  if (!phone) return null;
  const str = String(phone);
  if (str.length <= 6) return str;
  return `${str.slice(0, 3)}${"•".repeat(Math.max(str.length - 7, 4))}${str.slice(-4)}`;
}

/** IST date string for "today" daily-cap reads. */
function todayIstDateString(now = new Date()) {
  const local = new Date(now.getTime() + 330 * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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

    // Compute the next-pair payout preview so the dashboard can show
    // "complete your next pair to earn ₹X" without the frontend having
    // to replicate the tier-vs-fixed lookup.
    const pairsCompleted = membership?.pairsCompleted || 0;
    const nextPairBonusAmount = membership
      ? await getPlanAPairBonusForPairIndex(pairsCompleted + 1)
      : 0;

    // Surface the latest non-terminal manual-QR joining payment so the
    // dashboard can render resume / under-review / try-again banners
    // without an extra round trip. Only relevant for non-members.
    let pendingJoiningPayment = null;
    if (!membership) {
      const pending = await getLatestPendingJoiningPaymentForCustomer(userId);
      if (pending) {
        pendingJoiningPayment = {
          paymentId: String(pending._id),
          status: pending.status,
          paymentMode: pending.paymentMode,
          amount: pending.joiningPriceSnapshot,
          createdAt: pending.createdAt,
          submittedAt: pending.manualPaymentDetails?.submittedAt || null,
          transactionId: pending.manualPaymentDetails?.transactionId || null,
          rejectionReason:
            pending.status === "FAILED"
              ? pending.adminRemarks || pending.failureReason || null
              : null,
          redirectUrl: pending.rawGatewayResponse?.redirectUrl || null,
        };
      }
    }

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
            activeDownlineCount: membership.activeDownlineCount || 0,
            inactiveDownlineCount: membership.inactiveDownlineCount || 0,
            // Plan A binary pair-match state.
            leftLegDirectCount: membership.leftLegDirectCount || 0,
            rightLegDirectCount: membership.rightLegDirectCount || 0,
            pairsCompleted,
            lastPaidPairIndex: membership.lastPaidPairIndex || 0,
            nextPairIndex: pairsCompleted + 1,
            nextPairBonusAmount,
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
      pendingJoiningPayment,
      config: {
        joiningPackagePrice: cfg.joiningPackagePrice,
        joiningPackageShoppingWalletCredit: cfg.joiningPackageShoppingWalletCredit,
        joiningPaymentMode:
          cfg.joiningPaymentMode === "phonepe" ? "phonepe" : "manual_qr",
        withdrawalMinAmount: cfg.withdrawalMinAmount,
        withdrawalAdminChargePercent: cfg.withdrawalAdminChargePercent,
        withdrawalGstOnAdminChargePercent: cfg.withdrawalGstOnAdminChargePercent,
        planBAutoUpgradeAtPlanALifetimeEarnings:
          cfg.planBAutoUpgradeAtPlanALifetimeEarnings,
        // Plan A pair bonus settings (read-only from the customer's
        // perspective; admin maintains them via /admin/mlm/settings).
        planAPairBonusTiers: cfg.planAPairBonusTiers || [],
        planAPairBonusFixedAfterPair: cfg.planAPairBonusFixedAfterPair || 0,
        planAPairBonusFixedAmount: cfg.planAPairBonusFixedAmount || 0,
        planAPairBonusReleaseCooldownDays:
          cfg.planAPairBonusReleaseCooldownDays || 0,
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

    const [totalCredited, totalThisMonth, byType, wallet] = await Promise.all([
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
      Wallet.findOne({ ownerType: OWNER_TYPE.CUSTOMER, ownerId: userId }).lean(),
    ]);

    return handleResponse(res, 200, "Earnings summary", {
      lifetimeEarnings:
        (membership?.lifetimePlanAEarnings || 0) +
        (membership?.lifetimePlanBEarnings || 0),
      lifetimePlanAEarnings: membership?.lifetimePlanAEarnings || 0,
      lifetimePlanBEarnings: membership?.lifetimePlanBEarnings || 0,
      shoppingWalletBalance: wallet?.shoppingBalance || 0,
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
        .populate("sourceUserId", "name userId phone")
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
 * One-click MLM joining: creates a dedicated MlmJoiningPayment row,
 * initiates the PhonePe checkout, and returns a redirect URL. No
 * Order or Product is involved — joining is a direct subscription
 * purchase whose lifecycle lives entirely in `MlmJoiningPayment`.
 *
 * Activation happens via the payment-CAPTURED hook
 * (`processPhonePeWebhook` / `verifyPhonePePaymentStatus` →
 * `mlmJoiningPaymentService` → `activateMembershipFromJoiningPayment`).
 *
 * Response: `{ paymentId, merchantOrderId, redirectUrl, duplicate }`.
 */
export const initiateJoin = async (req, res) => {
  try {
    const userId = req.user.id;
    const idempotencyKey = req.headers["idempotency-key"] || req.body?.idempotencyKey || null;
    const result = await initiateJoiningPayment({ userId, idempotencyKey });
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

/**
 * POST /api/customer/mlm/join/submit-proof
 *
 * Manual-QR flow only. Body: `{ paymentId, transactionId,
 * screenshotUrl, paidAmount? }`. Validates ownership +
 * payment-mode + status, transitions the row to PENDING_REVIEW.
 */
export const submitJoiningProof = async (req, res) => {
  try {
    const customerId = req.user.id;
    const {
      paymentId,
      transactionId,
      screenshotUrl,
      paidAmount = null,
    } = req.body || {};

    const updated = await submitManualPaymentProof({
      paymentId,
      customerId,
      transactionId,
      screenshotUrl,
      paidAmount,
    });

    return handleResponse(res, 200, "Payment proof submitted for review", {
      paymentId: String(updated._id),
      status: updated.status,
      submittedAt: updated.manualPaymentDetails?.submittedAt || null,
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to submit payment proof",
      error.code ? { code: error.code } : undefined,
    );
  }
};

/**
 * GET /api/customer/mlm/join/payment/:paymentId
 *
 * Polled by `ManualPaymentPage` so it can swap from form mode to
 * status-card mode the moment proof is submitted (or the admin
 * approves/rejects). Returns the manual-QR config snapshot so the
 * page never reads admin settings directly — it always renders the
 * QR/instructions snapshotted at intent time.
 */
export const getJoiningPayment = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { paymentId } = req.params;
    const payment = await getManualJoiningPaymentForCustomer({
      paymentId,
      customerId,
    });

    // Prefer the snapshot baked into rawGatewayResponse at intent
    // time; fall back to the live config if a legacy row predates the
    // snapshot. The fallback keeps the page usable even for rows that
    // existed before this rollout.
    const manualQr =
      payment.rawGatewayResponse?.manualQrSnapshot ||
      (await getManualQrConfig());

    return handleResponse(res, 200, "Joining payment", {
      paymentId: String(payment._id),
      status: payment.status,
      paymentMode: payment.paymentMode,
      amount: payment.joiningPriceSnapshot,
      shoppingCredit: payment.shoppingCreditSnapshot,
      sponsorReferralCode: payment.sponsorReferralCodeSnapshot || null,
      createdAt: payment.createdAt,
      submittedAt: payment.manualPaymentDetails?.submittedAt || null,
      transactionId: payment.manualPaymentDetails?.transactionId || null,
      screenshotUrl: payment.manualPaymentDetails?.screenshotUrl || null,
      reviewedAt: payment.reviewedAt || null,
      adminRemarks: payment.adminRemarks || null,
      rejectionReason:
        payment.status === "FAILED"
          ? payment.adminRemarks || payment.failureReason || null
          : null,
      manualQr,
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to fetch payment",
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

/* ===================================================================
 * Customer-MLM-rebuild Phase 5 — Main dashboard + Genealogy + Payouts
 * ================================================================ */

/**
 * GET /api/customer/mlm/dashboard-overview
 *
 * Single batched payload that powers the customer's Main Dashboard
 * page. Returns the full snapshot in one round trip:
 *
 *   - wallet buckets (shopping, earnings, pending, available)
 *   - lifetime earnings split (Plan A / Plan B / total)
 *   - direct referrals count + active / registered-unpaid breakdown
 *   - total downline count
 *   - left leg / right leg counts + pairs completed + next pair preview
 *   - pending payout total (sum of pending withdrawal amounts)
 *   - today's credited earnings (IST day)
 *   - daily cap usage
 */
export const getDashboardOverview = async (req, res) => {
  try {
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const today = todayIstDateString();
    const monthStart = new Date();
    monthStart.setUTCHours(0, 0, 0, 0);
    monthStart.setUTCDate(1);

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

    const pairsCompleted = membership?.pairsCompleted || 0;
    const nextPairBonusAmount = membership
      ? await getPlanAPairBonusForPairIndex(pairsCompleted + 1)
      : 0;

    const leftChildId = membership?.binaryLeftChildId;
    const rightChildId = membership?.binaryRightChildId;

    // Downline split: active customers vs registered-unpaid. We count
    // memberships whose `sponsorChain` contains the caller (full
    // downline, not just direct referrals).
    const [
      activeDownline,
      unpaidDownline,
      directActive,
      directUnpaid,
      leftChildMembership,
      rightChildMembership,
    ] = await Promise.all([
      MlmMembership.countDocuments({
        sponsorChain: userObjectId,
        status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      }),
      MlmMembership.countDocuments({
        sponsorChain: userObjectId,
        status: MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
      }),
      MlmMembership.countDocuments({
        sponsorId: userId,
        status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      }),
      MlmMembership.countDocuments({
        sponsorId: userId,
        status: MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
      }),
      leftChildId ? MlmMembership.findOne({ userId: leftChildId }, { totalDownlineCount: 1 }).lean() : null,
      rightChildId ? MlmMembership.findOne({ userId: rightChildId }, { totalDownlineCount: 1 }).lean() : null,
    ]);

    const leftLegTotalDownlineCount = leftChildMembership ? (leftChildMembership.totalDownlineCount || 0) + 1 : 0;
    const rightLegTotalDownlineCount = rightChildMembership ? (rightChildMembership.totalDownlineCount || 0) + 1 : 0;

    const [pendingWithdrawAgg, todaysCreditAgg, monthCreditAgg] =
      await Promise.all([
        MlmWithdrawalRequest.aggregate([
          {
            $match: {
              userId: userObjectId,
              status: {
                $in: [
                  MLM_WITHDRAWAL_STATUS.PENDING,
                  MLM_WITHDRAWAL_STATUS.APPROVED,
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              gross: { $sum: "$amount" },
              net: { $sum: "$netPayoutAmount" },
              count: { $sum: 1 },
            },
          },
        ]),
        MlmCommissionEvent.aggregate([
          {
            $match: {
              recipientId: userObjectId,
              status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
              createdAt: {
                $gte: (() => {
                  // Start of today IST -> UTC instant
                  const ist = new Date();
                  ist.setUTCHours(0, 0, 0, 0);
                  return new Date(ist.getTime() - 330 * 60 * 1000);
                })(),
              },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$cappedAmount" },
              count: { $sum: 1 },
            },
          },
        ]),
        MlmCommissionEvent.aggregate([
          {
            $match: {
              recipientId: userObjectId,
              status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
              createdAt: { $gte: monthStart },
            },
          },
          { $group: { _id: null, total: { $sum: "$cappedAmount" } } },
        ]),
      ]);

    const pendingWithdraw = pendingWithdrawAgg[0] || {
      gross: 0,
      net: 0,
      count: 0,
    };

    return handleResponse(res, 200, "Dashboard overview", {
      enabled: !!cfg.enabled,
      isMember: !!membership,
      membership: membership
        ? {
            referralCode: membership.referralCode,
            planType: membership.planType,
            status: membership.status,
            isActive: membership.status === MLM_MEMBERSHIP_STATUS.ACTIVE,
            isRegisteredUnpaid:
              membership.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
            joinedAt: membership.joinedAt,
            planAJoinedAt: membership.planAJoinedAt,
            planBJoinedAt: membership.planBJoinedAt,
            sponsorId: membership.sponsorId || null,
            heldPairBonusForSponsor: membership.heldPairBonusForSponsor || 0,
            homeShoppingUnlocked: !!membership.homeShoppingUnlocked,
          }
        : null,
      wallet: {
        shoppingBalance: wallet?.shoppingBalance || 0,
        earningsBalance: wallet?.earningsBalance || 0,
        pendingBalance: wallet?.pendingBalance || 0,
        availableBalance: wallet?.availableBalance || 0,
      },
      earnings: {
        lifetime:
          (membership?.lifetimePlanAEarnings || 0) +
          (membership?.lifetimePlanBEarnings || 0),
        planA: membership?.lifetimePlanAEarnings || 0,
        planB: membership?.lifetimePlanBEarnings || 0,
        today: todaysCreditAgg[0]?.total || 0,
        todayCount: todaysCreditAgg[0]?.count || 0,
        thisMonth: monthCreditAgg[0]?.total || 0,
      },
      referrals: {
        directReferralsCount: membership?.directReferralsCount || 0,
        directActive,
        directRegisteredUnpaid: directUnpaid,
        totalDownlineCount: membership?.totalDownlineCount || 0,
        activeDownlineCount: membership?.activeDownlineCount || 0,
        inactiveDownlineCount: membership?.inactiveDownlineCount || 0,
        activeCustomersInNetwork: activeDownline,
        registeredUnpaidInNetwork: unpaidDownline,
      },
      binary: {
        leftLegDirectCount: membership?.leftLegDirectCount || 0,
        rightLegDirectCount: membership?.rightLegDirectCount || 0,
        leftLegTotalDownlineCount,
        rightLegTotalDownlineCount,
        pairsCompleted,
        lastPaidPairIndex: membership?.lastPaidPairIndex || 0,
        nextPairIndex: pairsCompleted + 1,
        nextPairBonusAmount,
      },
      payout: {
        pendingGross: pendingWithdraw.gross || 0,
        pendingNet: pendingWithdraw.net || 0,
        pendingCount: pendingWithdraw.count || 0,
      },
      dailyCap: {
        cap: Number(cfg.dailyEarningCap) || 0,
        usedToday:
          membership?.dailyCapTracker?.date === today
            ? Number(membership.dailyCapTracker.usedAmount) || 0
            : 0,
        date: today,
      },
      config: {
        joiningPackagePrice: cfg.joiningPackagePrice,
        joiningPackageShoppingWalletCredit: cfg.joiningPackageShoppingWalletCredit,
        withdrawalMinAmount: cfg.withdrawalMinAmount,
        planAPairBonusTiers: cfg.planAPairBonusTiers || [],
        planAPairBonusFixedAmount: cfg.planAPairBonusFixedAmount || 0,
        // Surface the Plan A → Plan B auto-upgrade threshold so the
        // Main Dashboard "Current Plan" card can render a progress
        // meter towards the Premium tier without a second round-trip.
        planBAutoUpgradeAtPlanALifetimeEarnings:
          cfg.planBAutoUpgradeAtPlanALifetimeEarnings || 0,
        premiumUpgradeShoppingWalletTopup:
          cfg.premiumUpgradeShoppingWalletTopup || 0,
      },
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * Shape a single tree node into the wire payload the frontend
 * tooltip / canvas expect. Customer-side view masks phone numbers
 * for the entire downline (admin view does not — see admin
 * controller's `shapeAdminNode`).
 *
 * Per-node payload intentionally includes everything the frontend
 * tooltip needs (public User ID, name, code, plan, status, joined,
 * leg counts, lifetime earnings) so a hover/click on any node never
 * has to issue a second roundtrip.
 */
function shapeCustomerNode(member, position) {
  const u = member.userId || {};
  return {
    _id: member._id,
    userId: member.userId,
    name: u?.name || null,
    phone: maskPhoneForDownline(u?.phone || null),
    publicUserId: u?.userId || null,
    referralCode: member.referralCode,
    planType: member.planType,
    status: member.status,
    position,
    joinedAt: member.joinedAt,
    planAJoinedAt: member.planAJoinedAt || null,
    directReferralsCount: member.directReferralsCount || 0,
    totalDownlineCount: member.totalDownlineCount || 0,
    activeDownlineCount: member.activeDownlineCount || 0,
    inactiveDownlineCount: member.inactiveDownlineCount || 0,
    leftLegDirectCount: member.leftLegDirectCount || 0,
    rightLegDirectCount: member.rightLegDirectCount || 0,
    pairsCompleted: member.pairsCompleted || 0,
    lifetimePlanAEarnings: member.lifetimePlanAEarnings || 0,
    lifetimePlanBEarnings: member.lifetimePlanBEarnings || 0,
    left: null,
    right: null,
  };
}

/**
 * Convert the shared tree-builder's raw nodes into the customer
 * payload shape (recursive). Returns `null` for a `null` node so
 * the frontend's empty-slot rendering keeps working unchanged.
 */
function shapeCustomerTree(node) {
  if (!node) return null;
  const shaped = shapeCustomerNode(node.raw, node.position);
  shaped.leftLegTotalDownlineCount = node.left ? (node.left.raw.totalDownlineCount || 0) + 1 : 0;
  shaped.rightLegTotalDownlineCount = node.right ? (node.right.raw.totalDownlineCount || 0) + 1 : 0;
  shaped.left = shapeCustomerTree(node.left);
  shaped.right = shapeCustomerTree(node.right);
  return shaped;
}

/**
 * Authorisation for sub-tree navigation (`?rootUserId=...`): the
 * caller must own the requested root, OR the requested root must be
 * a descendant of the caller in the binary tree (which is the only
 * tree the frontend renders).
 *
 * Two-stage check:
 *  1. Cheap O(1) `sponsorChain` membership check — covers the
 *     common case where the caller is in the requested member's
 *     unilevel upline (which always holds for non-spillover trees).
 *  2. Defensive walk up `binaryParentId` for at most 20 hops to
 *     catch pure-binary-spillover descendants whose unilevel
 *     sponsor differs from their binary parent.
 *
 * Returns `true` when the caller may view the requested sub-tree.
 */
async function isCallerAuthorisedForTreeRoot(callerUserId, rootMembership) {
  if (!rootMembership) return false;
  if (String(rootMembership.userId?._id || rootMembership.userId) === String(callerUserId)) {
    return true;
  }
  const chain = (rootMembership.sponsorChain || []).map((id) => String(id));
  if (chain.includes(String(callerUserId))) return true;

  let cursor = rootMembership.binaryParentId;
  let safety = 20;
  while (cursor && safety-- > 0) {
    if (String(cursor) === String(callerUserId)) return true;
    const parent = await MlmMembership.findOne(
      { userId: cursor },
      { binaryParentId: 1 },
    ).lean();
    if (!parent) break;
    cursor = parent.binaryParentId;
  }
  return false;
}

/**
 * GET /api/customer/mlm/genealogy/tree?depth=<n>&rootUserId=<User._id>
 *
 * Recursive binary downline tree rooted at the caller's membership
 * (default) OR at any descendant in the caller's binary tree when
 * `rootUserId` is provided. The frontend uses the latter to power
 * the "click a node to view its sub-tree" interaction without ever
 * leaking strangers' networks (see `isCallerAuthorisedForTreeRoot`
 * for the auth model).
 *
 * Depth semantics:
 *   - omitted / 0 / non-positive → returns the FULL downline tree
 *     (capped at `MAX_TREE_DEPTH = 50` as a runaway safety bound)
 *   - positive integer           → clamped to [1, MAX_TREE_DEPTH]
 */
export const getMyGenealogyTree = async (req, res) => {
  try {
    const callerUserId = req.user.id;
    // Depth handling:
    //   - default (no query param) → 0  (interpreted as "all levels")
    //   - `depth=0`                 → full downline, capped at MAX_TREE_DEPTH
    //     to guarantee the recursive build can never run away on a
    //     pathologically deep tree.
    //   - any positive number       → clamped to [1, MAX_TREE_DEPTH]
    //
    // The cap is a safety bound; in practice no binary placement
    // tree gets anywhere close to 50 levels (that would be 2^50
    // members). It exists to keep the recursive Mongo queries
    // bounded if the schema ever develops a placement cycle bug.
    const MAX_TREE_DEPTH = 50;
    const rawDepth = parseInt(req.query.depth, 10);
    const depth = Number.isFinite(rawDepth) && rawDepth > 0
      ? Math.min(rawDepth, MAX_TREE_DEPTH)
      : MAX_TREE_DEPTH;
    const rawRoot = typeof req.query.rootUserId === "string"
      ? req.query.rootUserId.trim()
      : "";
    const requestedRoot = rawRoot && mongoose.isValidObjectId(rawRoot)
      ? rawRoot
      : callerUserId;
    const isOwnTree = String(requestedRoot) === String(callerUserId);

    const rootMembership = await MlmMembership.findOne({ userId: requestedRoot })
      .populate("userId", "name phone email userId")
      .lean();
    if (!rootMembership) {
      return handleResponse(res, 200, "Tree", {
        depth,
        tree: null,
        isMember: false,
        isOwnTree,
        requestedRootUserId: String(requestedRoot),
      });
    }

    if (!isOwnTree) {
      const allowed = await isCallerAuthorisedForTreeRoot(
        callerUserId,
        rootMembership,
      );
      if (!allowed) {
        return handleResponse(
          res,
          403,
          "You can only view the genealogy of members in your own network.",
        );
      }
    }

    const { tree: rawTree, drift, totalDescendants, renderedCount, orphanedCount } =
      await buildBinaryTreeBottomUp({
        rootMembership,
        depthLeft: depth,
      });
    const tree = shapeCustomerTree(rawTree);

    // Emit a single console.warn line per request when the
    // bottom-up assembly disagreed with the parent's denormalised
    // top-down child pointers, so we don't lose visibility of legacy
    // data drift while the audit playbook's Phase 4 repair job lands.
    if (drift.length) {
      console.warn(
        `[mlm-tree] rootUserId=${requestedRoot} renderedCount=${renderedCount} totalDescendants=${totalDescendants} orphaned=${orphanedCount} drift=${drift.length}`,
      );
    }

    return handleResponse(res, 200, "Tree", {
      depth,
      tree,
      isMember: true,
      isOwnTree,
      requestedRootUserId: String(requestedRoot),
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * GET /api/customer/mlm/genealogy/binary
 *
 * Flat per-leg breakdown — caller's left-leg roster and right-leg
 * roster as two arrays, with subtree counts. Each row is one of the
 * caller's direct referrals; spillover downline counts are surfaced
 * via the row's `subtreeCount` field.
 *
 * Leg classification:
 *   Each direct referral's `binaryPosition` field is its position
 *   relative to its IMMEDIATE `binaryParent` — that's NOT necessarily
 *   the same as which subtree of the CALLER it landed in. A referral
 *   spilled deep under one of the caller's children may have a
 *   `binaryPosition` of "L" because they slotted into a left position
 *   of their immediate parent, while actually living in the caller's
 *   RIGHT subtree. We therefore walk up `binaryParentId` chains via
 *   `classifyDirectReferralsByLegUnderRoot` so the leg labels here
 *   always match what the tree view renders.
 */
export const getMyBinaryGenealogy = async (req, res) => {
  try {
    const userId = req.user.id;
    const membership = await getMembershipByUserId(userId);
    if (!membership) {
      return handleResponse(res, 200, "Binary genealogy", {
        isMember: false,
        leftLeg: [],
        rightLeg: [],
      });
    }

    // Fetch all binary descendants under the user's binary tree
    const aggResult = await MlmMembership.aggregate([
      { $match: { userId: membership.userId } },
      {
        $graphLookup: {
          from: MlmMembership.collection.name,
          startWith: "$userId",
          connectFromField: "userId",
          connectToField: "binaryParentId",
          as: "descendants",
          // Bounded depth to prevent massive payload walks
          maxDepth: 64,
        },
      },
    ]);

    const descendants = aggResult[0]?.descendants || [];

    const userRows = await mongoose
      .model("User")
      .find({ _id: { $in: descendants.map((d) => d.userId) } }, { name: 1, phone: 1 })
      .lean();
    const userById = new Map(userRows.map((u) => [String(u._id), u]));

    const parentLinkByUser = new Map();
    for (const d of descendants) {
      parentLinkByUser.set(String(d.userId), {
        parent: d.binaryParentId ? String(d.binaryParentId) : null,
        position: d.binaryPosition || null,
      });
    }

    const shape = (m, actualLeg) => {
      const u = userById.get(String(m.userId));
      return {
        userId: m.userId,
        name: u?.name || null,
        phone: maskPhoneForDownline(u?.phone || null),
        referralCode: m.referralCode,
        status: m.status,
        // `position` here is leg-of-root (matches the tree view).
        position: actualLeg || null,
        joinedAt: m.joinedAt || m.createdAt || null,
        subtreeCount: m.totalDownlineCount || 0,
        activeDownlineCount: m.activeDownlineCount || 0,
        inactiveDownlineCount: m.inactiveDownlineCount || 0,
        pairsCompleted: m.pairsCompleted || 0,
        leftLegDirectCount: m.leftLegDirectCount || 0,
        rightLegDirectCount: m.rightLegDirectCount || 0,
        lifetimeEarnings:
          (m.lifetimePlanAEarnings || 0) + (m.lifetimePlanBEarnings || 0),
      };
    };

    const leftLeg = [];
    const rightLeg = [];
    const rootKey = String(membership.userId);
    const MAX_HOPS = 64;

    for (const m of descendants) {
      const mUserKey = String(m.userId);
      let cursorUser = mUserKey;
      let leg = null;
      let depth = 999;
      for (let i = 0; i < MAX_HOPS; i += 1) {
        const link = parentLinkByUser.get(cursorUser);
        if (!link || !link.parent) {
          if (cursorUser === mUserKey) {
            leg = m.binaryPosition || null;
            depth = 1;
          }
          break;
        }
        if (link.parent === rootKey) {
          leg = link.position;
          depth = i + 1;
          break;
        }
        cursorUser = link.parent;
      }

      if (leg === "L") {
        const shaped = shape(m, leg);
        shaped.depth = depth;
        leftLeg.push(shaped);
      } else if (leg === "R") {
        const shaped = shape(m, leg);
        shaped.depth = depth;
        rightLeg.push(shaped);
      }
    }

    leftLeg.sort((a, b) => new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0));
    rightLeg.sort((a, b) => new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0));

    return handleResponse(res, 200, "Binary genealogy", {
      isMember: true,
      leftLegCount: membership.leftLegDirectCount || 0,
      rightLegCount: membership.rightLegDirectCount || 0,
      pairsCompleted: membership.pairsCompleted || 0,
      leftLeg,
      rightLeg,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * GET /api/customer/mlm/genealogy/matching-report?page=1&limit=20
 *
 * Paginated pair-match (BINARY_PAIR_MATCH) commission events for the
 * caller, joined with the left/right contributor names from the
 * event's `meta` (denormalised at credit time).
 *
 * Surfaces HELD events too so the customer can see pairs that are
 * pending downline activation.
 */
export const getMyMatchingReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const query = {
      recipientId: userId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    };

    const [items, total] = await Promise.all([
      MlmCommissionEvent.find(query)
        .sort({ "meta.pairIndex": 1, createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MlmCommissionEvent.countDocuments(query),
    ]);

    // Gather every contributor userId to do ONE user lookup.
    const contributorIds = new Set();
    for (const ev of items) {
      if (ev.meta?.leftContributorUserId) contributorIds.add(String(ev.meta.leftContributorUserId));
      if (ev.meta?.rightContributorUserId) contributorIds.add(String(ev.meta.rightContributorUserId));
    }
    const users = contributorIds.size
      ? await mongoose
          .model("User")
          .find(
            { _id: { $in: Array.from(contributorIds) } },
            { name: 1, phone: 1 },
          )
          .lean()
      : [];
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const shaped = items.map((ev) => {
      const left = ev.meta?.leftContributorUserId
        ? userById.get(String(ev.meta.leftContributorUserId))
        : null;
      const right = ev.meta?.rightContributorUserId
        ? userById.get(String(ev.meta.rightContributorUserId))
        : null;
      return {
        _id: ev._id,
        pairIndex: ev.meta?.pairIndex || null,
        bonusAmount: ev.bonusAmount,
        cappedAmount: ev.cappedAmount,
        status: ev.status,
        isHeld:
          ev.status === MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_DOWNLINE_ACTIVATION,
        createdAt: ev.createdAt,
        releasedAt: ev.releasedAt || null,
        left: left
          ? { userId: left._id, name: left.name, phone: maskPhoneForDownline(left.phone) }
          : null,
        right: right
          ? { userId: right._id, name: right.name, phone: maskPhoneForDownline(right.phone) }
          : null,
      };
    });

    return handleResponse(res, 200, "Matching report", {
      items: shaped,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * GET /api/customer/mlm/genealogy/direct-sponsor
 *
 * Returns the caller's direct upline (L1 sponsor) information. The
 * sponsor's phone is masked; only the name + referral code + join
 * date are exposed.
 */
export const getMyDirectSponsor = async (req, res) => {
  try {
    const userId = req.user.id;
    const chain = await getUplineChain(userId, 1);
    if (!chain || chain.length === 0) {
      // Customer-MLM-rebuild Phase 4: also surface REGISTERED_UNPAID
      // sponsor — getUplineChain only returns ACTIVE rows.
      const membership = await getMembershipByUserId(userId);
      if (!membership?.sponsorId) {
        return handleResponse(res, 200, "Direct sponsor", { sponsor: null });
      }
      const sponsorMembership = await MlmMembership.findOne({
        userId: membership.sponsorId,
      });
      if (!sponsorMembership) {
        return handleResponse(res, 200, "Direct sponsor", { sponsor: null });
      }
      const sponsorUser = await mongoose
        .model("User")
        .findById(sponsorMembership.userId, { name: 1, phone: 1 })
        .lean();
      return handleResponse(res, 200, "Direct sponsor", {
        sponsor: {
          userId: sponsorMembership.userId,
          name: sponsorUser?.name || null,
          phone: maskPhoneForDownline(sponsorUser?.phone || null),
          referralCode: sponsorMembership.referralCode,
          status: sponsorMembership.status,
          planType: sponsorMembership.planType,
          joinedAt: sponsorMembership.joinedAt,
        },
      });
    }
    const sponsor = chain[0];
    const sponsorUser = await mongoose
      .model("User")
      .findById(sponsor.userId, { name: 1, phone: 1 })
      .lean();
    return handleResponse(res, 200, "Direct sponsor", {
      sponsor: {
        userId: sponsor.userId,
        name: sponsorUser?.name || null,
        phone: maskPhoneForDownline(sponsorUser?.phone || null),
        referralCode: sponsor.referralCode,
        status: sponsor.status,
        planType: sponsor.planType,
        joinedAt: sponsor.joinedAt,
      },
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * GET /api/customer/mlm/genealogy/tree-layout
 *
 * Returns the caller's cosmetic tree-node coordinate overrides. Used
 * by the Tree View page so a customer's manual layout drag positions
 * persist across reloads.
 */
export const getMyTreeLayout = async (req, res) => {
  try {
    const userId = req.user.id;
    const membership = await getMembershipByUserId(userId);
    if (!membership) {
      return handleResponse(res, 200, "Tree layout", { overrides: {} });
    }
    const overrides = {};
    const map = membership.treeLayoutOverrides;
    if (map && typeof map.forEach === "function") {
      map.forEach((value, key) => {
        if (value && typeof value.x === "number" && typeof value.y === "number") {
          overrides[String(key)] = { x: value.x, y: value.y };
        }
      });
    } else if (map && typeof map === "object") {
      for (const [key, value] of Object.entries(map)) {
        if (value && typeof value.x === "number" && typeof value.y === "number") {
          overrides[String(key)] = { x: value.x, y: value.y };
        }
      }
    }
    return handleResponse(res, 200, "Tree layout", { overrides });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * PUT /api/customer/mlm/genealogy/tree-layout
 * Body: { overrides: { [nodeId: string]: { x: number, y: number } } }
 *
 * Persists the caller's cosmetic node coordinates. Validates that
 * each entry is a `{x, y}` pair of finite numbers and that the count
 * is bounded (caps at 500 entries to prevent unbounded growth).
 *
 * Customer-MLM-rebuild Phase 1 invariant: this layout NEVER affects
 * the underlying binary tree's parent/child structure — it's pixel
 * coordinates only.
 */
export const updateMyTreeLayout = async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const incoming = body.overrides && typeof body.overrides === "object"
      ? body.overrides
      : null;
    if (!incoming) {
      return handleResponse(res, 400, "`overrides` is required (object)");
    }
    const entries = Object.entries(incoming).slice(0, 500);
    const sanitized = new Map();
    for (const [key, value] of entries) {
      if (!key || typeof key !== "string") continue;
      if (!value || typeof value !== "object") continue;
      const x = Number(value.x);
      const y = Number(value.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      sanitized.set(String(key), { x, y });
    }

    const membership = await getMembershipByUserId(userId);
    if (!membership) {
      return handleResponse(res, 404, "You are not a member yet");
    }
    membership.treeLayoutOverrides = sanitized;
    await membership.save();
    return handleResponse(res, 200, "Tree layout saved", {
      count: sanitized.size,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/customer/mlm/genealogy/add-member
 *
 * Body: { parentMembershipId, leg, name, email, phone, password }
 *
 * Creates a brand-new Customer + MlmMembership row positioned at the
 * supplied empty binary slot under the supplied parent. The actor
 * must own the parent (be the parent themselves) OR have the parent
 * in their own downline (`sponsorChain` membership check inside the
 * service). The new member lands `isVerified=true` (OTP skipped —
 * the actor vouches for the account) and `status=REGISTERED_UNPAID`
 * so the standard joining-payment flow still gates payouts.
 *
 * Powers the redesigned Genealogy "Tree View" tap-to-add interaction
 * on the customer panel; the admin panel has a parallel endpoint at
 * `POST /api/admin/mlm/members/:parentMembershipId/add-child`.
 */
export const addMemberAtSlot = async (req, res) => {
  try {
    const actorUserId = req.user.id;
    const {
      parentMembershipId,
      leg,
      name,
      email,
      phone,
      password,
    } = req.body || {};

    const result = await createMemberInBinarySlot({
      parentMembershipId,
      leg,
      name,
      email,
      phone,
      password,
      actorType: "customer",
      actorUserId,
      skipAuthorization: false,
    });

    return handleResponse(res, 201, "Member added to your network", {
      newMember: {
        userId: result.customer._id,
        publicUserId: result.customer.userId,
        name: result.customer.name,
        phone: result.customer.phone,
        email: result.customer.email,
        referralCode: result.membership.referralCode,
        membershipId: result.membership._id,
        binaryPosition: result.membership.binaryPosition,
        binaryParentMembershipId: result.membership.binaryParentMembershipId,
        status: result.membership.status,
      },
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to add member",
      error.code ? { code: error.code } : undefined,
    );
  }
};

/**
 * GET /api/customer/mlm/payouts/wallet-history?page=1&limit=20&type=&direction=
 *
 * Customer-MLM-rebuild Phase 5: unified wallet history from the
 * canonical `LedgerEntry` collection. Replaces the legacy
 * `Transaction`-backed `/api/customer/transactions` reader for the
 * new Payouts > Wallet History page.
 *
 * Surfaces: MLM bonus credits, withdrawal debits, joining-package
 * shopping seeds, Plan B upgrade top-ups, clawbacks, milestone
 * rewards, manual adjustments. Filterable by ledger type prefix
 * (`MLM_`) or by direction (`CREDIT` / `DEBIT`).
 */
export const getMyWalletHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const query = {
      actorType: OWNER_TYPE.CUSTOMER,
      actorId: new mongoose.Types.ObjectId(userId),
    };
    if (req.query.type) {
      query.type = req.query.type;
    }
    if (
      req.query.direction &&
      ["CREDIT", "DEBIT"].includes(String(req.query.direction).toUpperCase())
    ) {
      query.direction = String(req.query.direction).toUpperCase();
    }

    const [items, total] = await Promise.all([
      LedgerEntry.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LedgerEntry.countDocuments(query),
    ]);

    const shaped = items.map((row) => ({
      _id: row._id,
      transactionId: row.transactionId,
      type: row.type,
      direction: row.direction,
      amount: row.amount,
      status: row.status,
      description: row.description || null,
      reference: row.reference || null,
      createdAt: row.createdAt,
      balanceBefore: row.balanceBefore,
      balanceAfter: row.balanceAfter,
      orderId: row.orderId || null,
      payoutId: row.payoutId || null,
      metadata: row.metadata || {},
    }));

    return handleResponse(res, 200, "Wallet history", {
      items: shaped,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
