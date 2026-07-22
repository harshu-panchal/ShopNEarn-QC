import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
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
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MEMBERSHIP_STATUS,
  MLM_PAYMENT_MODE,
  MLM_PLAN_TYPE,
  normalizeMilestoneType,
} from "../../constants/mlm.js";
import { LEDGER_TRANSACTION_TYPE, OWNER_TYPE } from "../../constants/finance.js";
import {
  lookupMembershipJoinedAtByUserIds,
  resolveMemberRegistrationAt,
} from "../../utils/mlmMemberJoinedAt.js";
import {
  approveWithdrawalRequest,
  listWithdrawalsForAdmin,
  rejectWithdrawalRequest,
} from "../../services/mlm/mlmWithdrawalService.js";
import {
  approveManualJoiningPayment,
  rejectManualJoiningPayment,
} from "../../services/mlm/mlmJoiningPaymentService.js";
import {
  approveUpgradePayment,
  rejectUpgradePayment,
} from "../../services/mlm/mlmUpgradePaymentService.js";
import { adminActivateMembership } from "../../services/mlm/mlmActivationService.js";
import { getMlmConfig, resolveJoiningPackageShoppingCredit } from "../../services/mlm/mlmConfigService.js";
import MlmJoiningPayment from "../../models/mlmJoiningPayment.js";
import MlmUpgradePayment from "../../models/mlmUpgradePayment.js";
import Customer from "../../models/customer.js";
import { PAYMENT_STATUS } from "../../constants/payment.js";
import { creditWallet, debitWallet } from "../../services/finance/walletService.js";
import { invalidate } from "../../services/cacheService.js";
import {
  getMembershipByUserId,
  syncCustomerMlmProjection,
} from "../../services/mlm/mlmMembershipService.js";
import { drainAllPendingPlanABonuses } from "../../services/mlm/mlmPairBonusCooldownReleaseService.js";
import { softDeleteMlmMember } from "../../services/mlm/mlmMemberSoftDeleteService.js";
import { verifyMlmMemberWallet } from "../../jobs/mlmWalletLedgerVerifierJob.js";
import { USER_ID_PATTERN } from "../../utils/userIdGenerator.js";
import { normalizePhoneNumber } from "../../utils/phone.js";
import {
  listMlmMaintenanceJobs as getMaintenanceJobCatalog,
  runMlmMaintenanceJob as executeMaintenanceJob,
} from "../../services/mlm/mlmMaintenanceRunner.js";
import {
  previewBinaryMove,
  executeBinaryMove,
} from "../../services/mlm/mlmBinaryMoveService.js";
import { buildBinaryTreeBottomUp } from "../../services/mlm/mlmBinaryTreeBuilder.js";
import {
  buildMlmMembersExcelBuffer,
  queryMlmMembersEnriched,
} from "../../services/mlm/mlmMemberListService.js";
import MlmDailyPayoutReport, {
  MLM_DAILY_PAYOUT_REPORT_STATUS,
} from "../../models/mlmDailyPayoutReport.js";
import {
  generateDailyPayoutReport,
  getDailyPayoutReportByDate,
  listDailyPayoutReports,
  serializeReportForExport,
} from "../../services/mlm/mlmDailyPayoutReportService.js";
import { istDayBounds, todayIstDateString } from "../../utils/mlmIstDate.js";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);

/**
 * GET /api/admin/mlm/dashboard
 * Top-level KPIs for the MLM module: member counts, lifetime payouts,
 * pending withdrawals, and today's daily-cap usage.
 * Plan A / Plan B counts include only ACTIVE memberships.
 */
export const getMlmDashboard = async (req, res) => {
  try {
    const { startUtc: todayStart } = istDayBounds(todayIstDateString());

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
      MlmMembership.countDocuments({
        planType: MLM_PLAN_TYPE.A,
        status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      }),
      MlmMembership.countDocuments({
        planType: MLM_PLAN_TYPE.B,
        status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      }),
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
 *
 * Search semantics (Jun 2026): the `q` param matches across the
 * entire member collection — NOT just the rows that happen to fall
 * on the current page. Previously the search ran in-memory on the
 * already-paginated 25-row window, which meant typing a customer's
 * name on page 1 silently missed any matching customer on page 2+.
 *
 * Implementation:
 *   1. Resolve `q` to a list of matching `User._id`s by regex-
 *      scanning `name`, `phone`, `email`, and public `userId` on
 *      the User collection (the User collection is small enough
 *      that an indexed-name + non-indexed `$or` regex is fine
 *      here; if it ever becomes a hot path we should add a text
 *      index and switch to `$text` search).
 *   2. Add `referralCode` (regex) OR `userId IN matchingUserIds`
 *      to the membership query, so Mongo does the filtering AND
 *      the pagination AND the `countDocuments` consistently.
 *
 * Side-benefits: `total` / `totalPages` returned to the client are
 * now accurate when `q` is set (previously they reflected the
 * unfiltered count, so the paginator showed "Page 1 of 12" while
 * the visible body only had 2 matching rows).
 */
export const listMlmMembers = async (req, res) => {
  try {
    const result = await queryMlmMembersEnriched({
      planType: req.query.planType,
      status: req.query.status,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    });

    return handleResponse(res, 200, "MLM members", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/admin/mlm/members/export?q=&planType=&status=
 *
 * Downloads an Excel workbook of every member matching the same
 * filters as the list view (not just the current page).
 */
export const exportMlmMembers = async (req, res) => {
  try {
    const buffer = await buildMlmMembersExcelBuffer({
      planType: req.query.planType,
      status: req.query.status,
      q: req.query.q,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mlm-members-${stamp}.xlsx"`,
    );
    return res.send(buffer);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** GET /api/admin/mlm/members/:id
 *
 * Plaintext-password disclosure (Jun 2026, PO-request):
 * the populate string includes `+_signupPasswordPlaintext` so admins
 * can see the member's password directly on the member-detail page
 * — typically to verbally share credentials with a customer who has
 * lost access to their welcome email. This is a deliberate
 * extension of the documented read-site list on
 * `Customer._signupPasswordPlaintext`; the underlying field has
 * been persisted as plaintext since Phase 7, so we're surfacing
 * existing data, not introducing new sensitive storage.
 *
 * Access control: this endpoint sits under the admin auth
 * middleware (`/api/admin/mlm/...`), so the disclosure is gated to
 * authenticated admin sessions. Legacy rows (created before the
 * field became permanent) will return `""`, which the frontend
 * renders as a "—" placeholder.
 */
export const getMlmMemberDetail = async (req, res) => {
  try {
    const membership = await MlmMembership.findById(req.params.id)
      .populate(
        "userId",
        "name phone email mlm walletBalance userId createdAt +_signupPasswordPlaintext",
      )
      .lean();
    if (!membership) return handleResponse(res, 404, "Member not found");

    const memberUserId = membership.userId._id || membership.userId;

    const [
      directReferrals,
      commissionHistory,
      withdrawals,
      sponsorMembership,
      heldBonusEvents,
      pendingJoiningPayment,
    ] = await Promise.all([
      MlmMembership.find({ sponsorId: memberUserId })
        .populate("userId", "name phone email userId createdAt")
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
            .select({ userId: 1, referralCode: 1, planType: 1, status: 1, createdAt: 1 })
            .populate("userId", "name phone email userId createdAt")
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
      MlmJoiningPayment.findOne({
        customer: memberUserId,
        paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
        status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING_REVIEW] },
      })
        .sort({ createdAt: -1 })
        .select({
          _id: 1,
          status: 1,
          amountPaise: 1,
          joiningPriceSnapshot: 1,
          shoppingCreditSnapshot: 1,
          manualPaymentDetails: 1,
          createdAt: 1,
        })
        .lean(),
    ]);

    return handleResponse(res, 200, "Member detail", {
      membership: {
        ...membership,
        joinedAt: resolveMemberRegistrationAt(membership),
        registeredAt: resolveMemberRegistrationAt(membership),
      },
      directReferrals: directReferrals.map((row) => ({
        ...row,
        joinedAt: resolveMemberRegistrationAt(row),
      })),
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
            joinedAt: resolveMemberRegistrationAt(sponsorMembership),
          }
        : null,
      heldBonusEvents,
      pendingJoiningPayment: pendingJoiningPayment
        ? {
            paymentId: String(pendingJoiningPayment._id),
            status: pendingJoiningPayment.status,
            joiningPrice: Number(pendingJoiningPayment.joiningPriceSnapshot) || 0,
            shoppingCredit:
              Number(pendingJoiningPayment.shoppingCreditSnapshot) || 0,
            transactionId:
              pendingJoiningPayment.manualPaymentDetails?.transactionId || null,
            submittedAt:
              pendingJoiningPayment.manualPaymentDetails?.submittedAt
              || pendingJoiningPayment.createdAt,
          }
        : null,
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
 * goes from REGISTERED_UNPAID → ACTIVE and receives the same Plan A
 * joining-package shopping-wallet seed as a paid activation.
 *
 * Idempotent: re-running on an ACTIVE row returns 200 + skipped.
 * Refuses to approve SUSPENDED / TERMINATED rows.
 */
export const approveMlmMember = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    const membership = await MlmMembership.findById(req.params.id);
    if (!membership) {
      return handleResponse(res, 404, "Member not found");
    }

    const pendingPayment = await MlmJoiningPayment.findOne({
      customer: membership.userId,
      paymentMode: MLM_PAYMENT_MODE.MANUAL_QR,
      status: PAYMENT_STATUS.PENDING_REVIEW,
    }).sort({ createdAt: -1 });

    if (pendingPayment) {
      const payment = await approveManualJoiningPayment({
        paymentId: pendingPayment._id,
        adminId: req.user?.id,
        adminRemarks: reason || "Approved from member detail",
      });
      const shoppingCreditAmount =
        payment._activationSummary?.shoppingCreditAmount
        || (await resolveJoiningPackageShoppingCredit(payment));

      try {
        await invalidate(`/admin/mlm/members`);
        await invalidate(`/admin/mlm/members/${req.params.id}`);
      } catch (_) {
        /* non-fatal */
      }

      return handleResponse(res, 200, "Joining payment approved — Plan A activated", {
        activated: true,
        source: "joining_payment_approval",
        paymentId: String(payment._id),
        shoppingCreditAmount,
      });
    }

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
      shoppingCreditAmount: result.shoppingCreditAmount || 0,
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
 * POST /api/admin/mlm/members/:id/impersonation-token
 *
 * Admin support tool (PO-request Jun 2026): mints a short-lived
 * customer JWT for the member identified by `:id` and returns it so
 * the admin frontend can open a new tab pre-authenticated as the
 * customer. Eliminates the manual "copy User ID, copy password,
 * sign out, paste, sign in" loop that the support team was doing
 * dozens of times a day.
 *
 * Why this is acceptable:
 *   - Admins already see the plaintext signup password via
 *     `_signupPasswordPlaintext` on the member detail endpoint
 *     (see SECURITY NOTE in models/customer.js). They can already
 *     impersonate manually; this just automates it.
 *   - The token carries an `act` claim with the admin's user id so
 *     a future audit reader can tell impersonated sessions apart.
 *     The customer auth middleware ignores it (only `id` + `role`
 *     are required), so no existing controller breaks.
 *   - Expiry is `IMPERSONATION_TOKEN_TTL` (15 minutes) — long
 *     enough to land on `/mlm` and for the front-end to refresh the
 *     profile, short enough that a leaked token isn't a persistent
 *     foothold. The downstream `verifyToken` middleware will re-
 *     check the JWT exp on every subsequent request, so once the
 *     customer-shaped session expires the new tab will get a 401
 *     and the admin will need to mint a fresh handoff.
 *   - SUSPENDED / TERMINATED memberships are blocked — they can't
 *     log in normally either, so impersonating them would surface
 *     UI flows the real user has no path to.
 *
 * Response shape mirrors `loginWithPassword` / `verifyCustomerOTP`
 * (token + sanitised customer) so the frontend handoff page can
 * eagerly populate `useAuth().user` and avoid a one-frame "Loading"
 * flash while `/customer/profile` refetches.
 *
 * The token is returned in the JSON body (HTTPS-only); the admin
 * frontend ships it to the new tab via a URL hash fragment so it
 * never reaches the server in a Referer header.
 */
const IMPERSONATION_TOKEN_TTL_SECONDS = 15 * 60;
const IMPERSONATION_BLOCKED_STATUSES = new Set([
  "suspended",
  "terminated",
]);
export const issueImpersonationToken = async (req, res) => {
  try {
    const membership = await MlmMembership.findById(req.params.id)
      .populate("userId")
      .lean();
    if (!membership) return handleResponse(res, 404, "Member not found");
    if (!membership.userId || !membership.userId._id) {
      return handleResponse(
        res,
        409,
        "Membership has no linked customer account.",
      );
    }
    if (IMPERSONATION_BLOCKED_STATUSES.has(membership.status)) {
      return handleResponse(
        res,
        403,
        "Cannot impersonate a suspended or terminated member.",
      );
    }

    const customer = membership.userId;
    const adminId = req.user?.id || null;

    // Lazy-import sanitizeCustomer to keep the controller bundle
    // free of the OTP service surface (it pulls in nodemailer +
    // twilio). We only need the helper at request-time.
    const { sanitizeCustomer } = await import(
      "../../services/otpAuthService.js"
    );

    const token = jwt.sign(
      {
        id: customer._id,
        role: "customer",
        // Actor claim — recorded for future audit-log readers.
        // `verifyToken` ignores extra claims, so this is forward-
        // compatible with no controller changes.
        act: { id: adminId, type: "admin" },
        impersonated: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: IMPERSONATION_TOKEN_TTL_SECONDS },
    );

    console.warn(
      `[admin-impersonation] admin=${adminId} -> customer=${customer._id} membership=${membership._id}`,
    );

    return handleResponse(res, 200, "Impersonation token issued", {
      token,
      expiresInSeconds: IMPERSONATION_TOKEN_TTL_SECONDS,
      // Default landing page for the new tab — matches the
      // customer's POST_LOGIN_DEFAULT in CustomerAuth.jsx.
      redirect: "/mlm",
      customer: sanitizeCustomer(customer),
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to issue impersonation token",
    );
  }
};

/**
 * POST /api/admin/mlm/members/:id/soft-delete
 *
 * Tombstones a single membership and restructures the binary tree.
 * The heavy lifting (promotion + spillover + sponsor remap +
 * withdrawal cancel + counter rebalance) lives in
 * `mlmMemberSoftDeleteService.softDeleteMlmMember`, which runs the
 * whole thing inside a single mongoose transaction.
 *
 * Request body (optional): `{ reason: string }` — surfaced into the
 * `MlmWithdrawalRequest.rejectionReason` for any pending payouts that
 * get auto-cancelled, so the customer-facing receipt stays useful.
 *
 * Response: `summary` object describing what changed (which child
 * was promoted, who the spillover landed under, how many direct
 * referrals were re-parented). The admin UI uses this to show a
 * confirmation toast.
 */
export const softDeleteMember = async (req, res) => {
  try {
    const reason = (req.body?.reason || "").toString().trim().slice(0, 240);
    const summary = await softDeleteMlmMember({
      membershipId: req.params.id,
      adminId: req.user?.id,
      reason: reason || "Soft-deleted by admin",
    });
    console.warn(
      `[admin-soft-delete] admin=${req.user?.id} -> membership=${req.params.id} ` +
        `result=${JSON.stringify(summary)}`,
    );
    return handleResponse(
      res,
      summary.alreadyDeleted ? 200 : 200,
      summary.alreadyDeleted
        ? "Member was already soft-deleted"
        : "Member soft-deleted",
      summary,
    );
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to soft-delete member",
    );
  }
};

/**
 * POST /api/admin/mlm/customers/:customerId/delete-non-member
 *
 * Soft-deletes a Customer account that has NO live MlmMembership.
 * Used for "No MLM" rows on the members list — accounts that completed
 * signup/OTP but never got an MLM membership. Tombstoning frees the
 * phone unique index (partialFilterExpression: deletedAt=null) so the
 * person can register again from scratch.
 *
 * Refuses if a live membership exists — those must go through the
 * full member soft-delete path (tree restructure).
 */
export const deleteNonMlmCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return handleResponse(res, 400, "Invalid customer id");
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return handleResponse(res, 404, "Customer not found");
    }

    const liveMembership = await MlmMembership.findOne({
      userId: customer._id,
    }).lean();
    if (liveMembership) {
      return handleResponse(
        res,
        409,
        "This account has an MLM membership. Open the member page and use soft-delete instead.",
        {
          code: "HAS_MEMBERSHIP",
          membershipId: String(liveMembership._id),
        },
      );
    }

    // Account existence is handled below by deleteOne, but checking here helps
    // return early if someone double-clicks delete.

    await Customer.deleteOne({ _id: customer._id });

    console.warn(
      `[admin-delete-non-mlm] admin=${req.user?.id} -> customer=${customer._id} ` +
        `phone=${customer.phone} userId=${customer.userId}`,
    );

    return handleResponse(
      res,
      200,
      "Account deleted. The phone number can be used to register again.",
      {
        customerId: String(customer._id),
        phone: customer.phone,
        userId: customer.userId,
      },
    );
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to delete account",
    );
  }
};

/**
 * PATCH /api/admin/mlm/members/:id/profile
 *
 * Admin-only profile editor for an MLM member. Lets support staff
 * fix typos in name/email/phone, re-issue the public User ID, or
 * reset a forgotten password without forcing the customer through
 * the OTP-based "forgot password" flow.
 *
 * Body (all fields optional — only provided fields are updated):
 *   {
 *     userId:   "SE12345678",          // public User ID
 *     name:     "Manishaben Mehta",
 *     email:    "manishaben@example.com",
 *     phone:    "+918000139993",
 *     password: "NewPassw0rd!"         // plaintext; we bcrypt it
 *   }
 *
 * Uniqueness is enforced on userId / email / phone against ALL
 * customers (including soft-deleted rows — a tombstoned account's
 * email/phone must NOT be re-issued to a new live customer because
 * downstream wallets/ledgers reference it).
 *
 * Password updates also refresh `_signupPasswordPlaintext` so the
 * "Show Credentials" admin reveal + customer self-serve credentials
 * screen surface the new value. See the SECURITY NOTE in
 * `models/customer.js` for the trade-off rationale.
 *
 * All writes happen inside ONE mongoose transaction so a partial
 * failure (e.g. a unique-index violation on the second field) rolls
 * back the first.
 */
export const updateMemberProfile = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const membership = await MlmMembership.findById(req.params.id, null);
    if (!membership) return handleResponse(res, 404, "Member not found");

    const customer = await Customer.findById(membership.userId).select(
      "+password +_signupPasswordPlaintext",
    );
    if (!customer) {
      return handleResponse(res, 404, "Linked customer account not found");
    }

    const updates = {};
    const customerUpdates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "userId")) {
      const raw = String(req.body.userId || "").trim().toUpperCase();
      if (!raw) {
        return handleResponse(res, 400, "User ID cannot be empty", {
          code: "USER_ID_EMPTY",
        });
      }
      if (!USER_ID_PATTERN.test(raw)) {
        return handleResponse(
          res,
          400,
          "User ID must be 'SE' followed by 8 digits (or legacy 8-char unambiguous alphanumeric).",
          { code: "USER_ID_INVALID_FORMAT" },
        );
      }
      if (raw !== (customer.userId || "").toUpperCase()) {
        const collision = await Customer.findOne(
          {
            userId: raw,
            _id: { $ne: customer._id },
            __includeDeleted: true,
          },
          { _id: 1 },
        );
        if (collision) {
          return handleResponse(res, 409, "User ID is already taken", {
            code: "USER_ID_TAKEN",
          });
        }
        customerUpdates.userId = raw;
        updates.userId = raw;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const name = String(req.body.name || "").trim().slice(0, 120);
      if (!name) {
        return handleResponse(res, 400, "Name cannot be empty", {
          code: "NAME_EMPTY",
        });
      }
      if (name !== customer.name) {
        customerUpdates.name = name;
        updates.name = name;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "email")) {
      const email = String(req.body.email || "").trim().toLowerCase();
      // Email is OPTIONAL on the schema, but if provided it must
      // be a well-formed address; downstream credential reveal +
      // welcome-email replay rely on it being syntactically valid.
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return handleResponse(res, 400, "Invalid email address", {
          code: "EMAIL_INVALID",
        });
      }
      if (email !== (customer.email || "").toLowerCase()) {
        if (email) {
          const collision = await Customer.findOne(
            {
              email,
              _id: { $ne: customer._id },
              __includeDeleted: true,
            },
            { _id: 1 },
          );
          if (collision) {
            return handleResponse(res, 409, "Email is already taken", {
              code: "EMAIL_TAKEN",
            });
          }
        }
        customerUpdates.email = email || null;
        updates.email = email || null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const rawPhone = String(req.body.phone || "").trim();
      if (!rawPhone) {
        return handleResponse(res, 400, "Phone cannot be empty", {
          code: "PHONE_EMPTY",
        });
      }
      let normalized;
      try {
        normalized = normalizePhoneNumber(rawPhone);
      } catch (e) {
        return handleResponse(res, 400, "Invalid phone number", {
          code: "PHONE_INVALID",
        });
      }
      if (normalized !== customer.phone) {
        const collision = await Customer.findOne(
          {
            phone: normalized,
            _id: { $ne: customer._id },
            __includeDeleted: true,
          },
          { _id: 1 },
        );
        if (collision) {
          return handleResponse(
            res,
            409,
            "Phone number is already taken",
            { code: "PHONE_TAKEN" },
          );
        }
        customerUpdates.phone = normalized;
        updates.phone = normalized;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "password")) {
      const plaintext = String(req.body.password || "");
      if (plaintext.length < 6) {
        return handleResponse(
          res,
          400,
          "Password must be at least 6 characters.",
          { code: "PASSWORD_TOO_SHORT" },
        );
      }
      if (plaintext.length > 128) {
        return handleResponse(
          res,
          400,
          "Password is too long (max 128 characters).",
          { code: "PASSWORD_TOO_LONG" },
        );
      }
      const hash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
      customerUpdates.password = hash;
      customerUpdates._signupPasswordPlaintext = plaintext;
      updates.password = "(changed)";
    }

    if (Object.keys(customerUpdates).length === 0) {
      return handleResponse(res, 200, "No changes detected", {
        membershipId: String(membership._id),
        updates: {},
      });
    }

    await session.withTransaction(async () => {
      for (const [k, v] of Object.entries(customerUpdates)) {
        customer[k] = v;
      }
      customer.updatedBy = req.user?.id || null;
      await customer.save({ session });

      // PO consolidation (Jun 2026): when the admin changes the
      // public User ID, the membership's `referralCode` must follow
      // — otherwise the canonical "referralCode === Customer.userId"
      // invariant the rest of the system relies on would silently
      // break. Old code is preserved in `legacyReferralCode` so
      // anyone still sharing the previous identifier (links / cards)
      // continues to resolve via the soft-transition lookup.
      if (customerUpdates.userId) {
        const oldReferralCode = membership.referralCode;
        membership.referralCode = customerUpdates.userId;
        if (oldReferralCode && oldReferralCode !== customerUpdates.userId) {
          // Only stash the FIRST replaced code so we don't lose the
          // original. If `legacyReferralCode` is already populated
          // from the bulk migration, leave it alone — a customer's
          // truly original code is more valuable for back-compat
          // than the intermediate one.
          if (!membership.legacyReferralCode) {
            membership.legacyReferralCode = oldReferralCode;
          }
        }
        membership.updatedBy = req.user?.id || null;
        await membership.save({ session });
        // Refresh the denormalised Customer.mlm.referralCode mirror
        // so customer dashboards reflect the new code without a
        // forced page reload.
        await syncCustomerMlmProjection(membership.userId, { session });
      }
    });

    try {
      await invalidate(`/admin/mlm/members`);
      await invalidate(`/admin/mlm/members/${req.params.id}`);
    } catch (_) {
      /* non-fatal */
    }

    console.warn(
      `[admin-edit-member] admin=${req.user?.id} -> membership=${req.params.id} fields=${Object.keys(updates).join(",")}`,
    );

    return handleResponse(res, 200, "Member profile updated", {
      membershipId: String(membership._id),
      updates,
    });
  } catch (error) {
    if (error?.code === 11000) {
      // Defensive — our explicit collision checks above should
      // catch every case, but a race between the check and the
      // save could still surface a duplicate-key error.
      const dupField = Object.keys(error.keyPattern || {})[0] || "field";
      return handleResponse(
        res,
        409,
        `${dupField} is already taken (race detected)`,
        { code: "UNIQUE_VIOLATION", field: dupField },
      );
    }
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to update member profile",
    );
  } finally {
    await session.endSession();
  }
};

/**
 * POST /api/admin/mlm/members/:id/deactivate
 *
 * Inverse of `approveMlmMember`. Flips an ACTIVE membership back
 * to REGISTERED_UNPAID. The member stays in the binary tree (so
 * downstream child placements aren't orphaned), but:
 *   - the canvas paints them in the "unpaid" red colour
 *   - they no longer receive ANY new commission credits while in
 *     `REGISTERED_UNPAID` (the existing bonus engine already
 *     gates on `MLM_MEMBERSHIP_STATUS.ACTIVE`)
 *   - any pair-match bonuses sponsored from their leg are HELD
 *     against the sponsor until they're re-activated
 *
 * Re-activation is the existing "Approve Plan A" button, which
 * also runs the held-bonus release logic. No data is destroyed
 * here; the action is fully reversible.
 *
 * Body (optional): `{ reason: string }` — surfaced into a console
 * audit line for traceability.
 */
export const deactivateMember = async (req, res) => {
  try {
    const membership = await MlmMembership.findById(req.params.id);
    if (!membership) return handleResponse(res, 404, "Member not found");
    if (membership.deletedAt) {
      return handleResponse(
        res,
        410,
        "Member is soft-deleted; restore them before changing status.",
        { code: "MEMBERSHIP_DELETED" },
      );
    }
    if (membership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) {
      return handleResponse(
        res,
        200,
        `Member is already ${membership.status}; no change applied.`,
        { skipped: true, status: membership.status },
      );
    }

    const reason = String(req.body?.reason || "").trim().slice(0, 240);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        membership.status = MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID;
        membership.updatedBy = req.user?.id || null;
        await membership.save({ session });
        // Keep the denormalised Customer.mlm.active projection in
        // sync so the customer dashboard reflects the change
        // without a forced refetch.
        await syncCustomerMlmProjection(membership.userId, { session });
      });
    } finally {
      await session.endSession();
    }

    try {
      await invalidate(`/admin/mlm/members`);
      await invalidate(`/admin/mlm/members/${req.params.id}`);
    } catch (_) {
      /* non-fatal */
    }

    console.warn(
      `[admin-deactivate] admin=${req.user?.id} -> membership=${req.params.id} reason="${reason || "(none)"}"`,
    );

    return handleResponse(res, 200, "Member Plan A deactivated", {
      membershipId: String(membership._id),
      status: membership.status,
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to deactivate member",
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

    const { tree: rawTree, drift, totalDescendants, renderedCount, orphanedCount } =
      await buildBinaryTreeBottomUp({
        rootMembership: membership,
        depthLeft: depth,
      });
    const tree = shapeAdminTree(rawTree);

    if (drift.length) {
      console.warn(
        `[admin-mlm-tree] rootMembershipId=${membership._id} renderedCount=${renderedCount} totalDescendants=${totalDescendants} orphaned=${orphanedCount} drift=${drift.length}`,
      );
    }

    return handleResponse(res, 200, "Downline tree", {
      depth,
      tree,
      rootMembershipId: String(membership._id),
      // Surface drift counters so the admin panel can render a
      // "data drift detected — N nodes orphaned" banner once the
      // frontend lands the corresponding UI in a follow-up.
      diagnostics: {
        totalDescendants,
        renderedCount,
        orphanedCount,
        driftEntries: drift.length,
      },
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/admin/mlm/members/:id/add-child
 *
 * Body: { leg: "L"|"R", name, email, phone, password }
 *
 * Admin-side counterpart to the customer's
 * `POST /api/customer/mlm/genealogy/add-member`. Creates a new
 * Customer + MlmMembership row positioned at the supplied empty
 * slot directly under the member identified by `:id` (an
 * MlmMembership document id).
 *
 * Authorisation is bypassed (admins can place anywhere); other
 * invariants (slot must be empty, phone unique, leg in {L,R},
 * sponsor = parent membership) are enforced by the shared
 * `createMemberInBinarySlot` service.
 */
export const addChildMember = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const { leg, name, email, phone, password } = req.body || {};

    const result = await createMemberInBinarySlot({
      parentMembershipId: req.params.id,
      leg,
      name,
      email,
      phone,
      password,
      actorType: "admin",
      actorUserId: adminId,
      skipAuthorization: true,
    });

    return handleResponse(res, 201, "Member created and placed in the tree", {
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

/** POST /api/admin/mlm/members/:id/move-binary/preview */
export const previewMoveBinaryMember = async (req, res) => {
  try {
    const { newParentMembershipId, leg, changeSponsorToNewParent = false } =
      req.body || {};
    if (!newParentMembershipId) {
      return handleResponse(res, 422, "newParentMembershipId is required");
    }
    if (!leg) {
      return handleResponse(res, 422, "leg is required (L or R)");
    }
    const preview = await previewBinaryMove({
      membershipId: req.params.id,
      newParentMembershipId,
      leg,
      changeSponsorToNewParent: Boolean(changeSponsorToNewParent),
    });
    return handleResponse(res, 200, "Move preview", preview);
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message,
      error.code ? { code: error.code } : undefined,
    );
  }
};

/** POST /api/admin/mlm/members/:id/move-binary */
export const moveBinaryMember = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const {
      newParentMembershipId,
      leg,
      changeSponsorToNewParent = false,
      reason,
    } = req.body || {};
    if (!newParentMembershipId) {
      return handleResponse(res, 422, "newParentMembershipId is required");
    }
    if (!leg) {
      return handleResponse(res, 422, "leg is required (L or R)");
    }
    const result = await executeBinaryMove({
      membershipId: req.params.id,
      newParentMembershipId,
      leg,
      changeSponsorToNewParent: Boolean(changeSponsorToNewParent),
      adminId,
      reason: reason ? String(reason).trim().slice(0, 500) : null,
    });
    return handleResponse(res, 200, "Member moved in binary tree", result);
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message,
      error.code ? { code: error.code } : undefined,
    );
  }
};

/**
 * Shape a single membership doc into the admin tree payload. Admin
 * view does NOT mask phone numbers (compare with the customer
 * controller's `shapeCustomerNode`).
 *
 * Returns a node of shape
 *   { ...meta, position, left: <node|null>, right: <node|null> }
 * `position` is the position THIS node occupies under its parent
 * ("L"/"R"/null for root) — the UI uses it for per-row labels.
 *
 * Per-node payload mirrors the customer-side `shapeCustomerNode`
 * so the same `GenealogyTreeCanvas` component (shared in
 * `frontend/src/shared/components/mlm/`) can render either tree with
 * an identical tooltip. The User document's `userId` (public-facing
 * SE-prefixed ID) is populated so the tooltip's "User ID" row reads
 * the human-facing identifier directly without an extra round-trip.
 *
 * Tree assembly itself is delegated to the shared
 * `buildBinaryTreeBottomUp` service which walks bottom-up
 * `binaryParentId` linkage — robust to the legacy data drift where
 * a parent's denormalised `binaryLeftChildId`/`binaryRightChildId`
 * pointers became stale (see the service for context).
 */
function shapeAdminNode(member, position) {
  const u = member.userId || {};
  return {
    _id: member._id,
    userId: member.userId,
    name: u?.name || null,
    phone: u?.phone || null,
    publicUserId: u?.userId || null,
    referralCode: member.referralCode,
    planType: member.planType,
    status: member.status,
    position,
    joinedAt: resolveMemberRegistrationAt(member),
    registeredAt: resolveMemberRegistrationAt(member),
    planAJoinedAt: member.planAJoinedAt || null,
    directReferralsCount: member.directReferralsCount || 0,
    totalDownlineCount: member.totalDownlineCount || 0,
    activeDownlineCount: member.activeDownlineCount || 0,
    inactiveDownlineCount: member.inactiveDownlineCount || 0,
    leftLegDirectCount: member.leftLegDirectCount || 0,
    rightLegDirectCount: member.rightLegDirectCount || 0,
    pairsCompleted: member.pairsCompleted || 0,
    lastPaidPairIndex: member.lastPaidPairIndex || 0,
    leftLegTeamActiveCount: member.leftLegTeamActiveCount || 0,
    rightLegTeamActiveCount: member.rightLegTeamActiveCount || 0,
    binaryPairsEligible: member.binaryPairsEligible || 0,
    binaryLeftBalance: member.binaryLeftBalance || 0,
    binaryRightBalance: member.binaryRightBalance || 0,
    lifetimePlanAEarnings: member.lifetimePlanAEarnings || 0,
    lifetimePlanBEarnings: member.lifetimePlanBEarnings || 0,
    left: null,
    right: null,
  };
}

function shapeAdminTree(node) {
  if (!node) return null;
  const shaped = shapeAdminNode(node.raw, node.position);
  shaped.leftLegTotalDownlineCount = node.raw.trueLeftLegTotalDownlineCount || 0;
  shaped.rightLegTotalDownlineCount = node.raw.trueRightLegTotalDownlineCount || 0;
  shaped.leftLegActiveDownlineCount = node.raw.trueLeftLegActiveDownlineCount || 0;
  shaped.rightLegActiveDownlineCount = node.raw.trueRightLegActiveDownlineCount || 0;

  shaped.totalDownlineCount = shaped.leftLegTotalDownlineCount + shaped.rightLegTotalDownlineCount;
  shaped.activeDownlineCount = node.raw.trueBinaryActiveDownlineCount || 0;
  shaped.inactiveDownlineCount = node.raw.trueBinaryInactiveDownlineCount || 0;
  // See customer `shapeCustomerTree` — pair counters stay on the
  // membership snapshot; do not replace with `trueBinaryPairsCount`.

  shaped.left = shapeAdminTree(node.left);
  shaped.right = shapeAdminTree(node.right);
  return shaped;
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

/** GET /api/admin/mlm/maintenance/jobs */
export const listMlmMaintenanceJobs = async (req, res) => {
  try {
    const jobs = getMaintenanceJobCatalog();
    return handleResponse(res, 200, "MLM maintenance jobs", { jobs });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** POST /api/admin/mlm/maintenance/jobs/:jobId/run */
export const runMlmMaintenanceJob = async (req, res) => {
  try {
    const { apply = false, options = {} } = req.body || {};
    const result = await executeMaintenanceJob(req.params.jobId, {
      apply: Boolean(apply),
      options: options && typeof options === "object" ? options : {},
      adminId: req.user?.id || null,
    });
    const status = result.success ? 200 : 502;
    return handleResponse(
      res,
      status,
      result.success ? "Maintenance job completed" : "Maintenance job failed",
      result,
    );
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
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

    let pendingBonusRelease = null;
    if (
      Object.prototype.hasOwnProperty.call(payload, "planAPairBonusReleaseCooldownDays") &&
      Number(payload.planAPairBonusReleaseCooldownDays) === 0
    ) {
      pendingBonusRelease = await drainAllPendingPlanABonuses({ cooldownDays: 0 });
    }

    const cfg = await getMlmConfig();
    return handleResponse(res, 200, "MLM settings updated", {
      ...cfg,
      pendingBonusRelease,
    });
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
  if (out.milestoneType !== undefined) {
    out.milestoneType = normalizeMilestoneType(out.milestoneType);
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
        const resolvedBucket = ["available", "pending", "shopping", "earnings"].includes(bucket)
          ? bucket
          : "earnings";
        const args = {
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: membership.userId,
          amount: Number(amount),
          bucket: resolvedBucket,
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
          ledgerReference: idempotencyKey,
          ledgerDescription: `Manual admin adjustment: ${reason}`,
          idempotencyKey,
          metadata: {
            // Persist the target bucket so wallet-history labelling and
            // category filters resolve the correct wallet. Without this,
            // an earnings adjustment defaults to the "Shopping Wallet"
            // label because `metadata.bucket` is undefined.
            bucket: resolvedBucket,
            adminId: req.user?.id ? String(req.user.id) : null,
            reason: String(reason).trim(),
          },
          syncUserWalletBalance: resolvedBucket === "available",
        };
        if (String(direction).toUpperCase() === "CREDIT") {
          event = await creditWallet(args);
        } else {
          event = await debitWallet(args);
        }
        // Audit row in MlmCommissionEvent for visibility on the
        // member-detail page commission history. Amounts stay non-negative
        // (schema min: 0); debit vs credit is carried by status + meta.
        const dir = String(direction).toUpperCase();
        const adjAmount = Number(amount);
        const isCredit = dir === "CREDIT";
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
              bonusAmount: adjAmount,
              cappedAmount: isCredit ? adjAmount : 0,
              clawbackAmount: isCredit ? 0 : adjAmount,
              rolloverAmount: 0,
              walletBucket: args.bucket,
              ledgerEntryId: event?.ledgerEntry?._id || null,
              status: isCredit
                ? MLM_COMMISSION_EVENT_STATUS.CREDITED
                : MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
              idempotencyKey,
              description: `Manual admin adjustment: ${reason}`,
              meta: {
                adminId: req.user?.id ? String(req.user.id) : null,
                direction: dir,
              },
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
          { name: 1, phone: 1, email: 1, createdAt: 1 },
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
          registeredAt: c.createdAt || null,
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
    const shoppingCreditAmount =
      payment._activationSummary?.shoppingCreditAmount
      || (await resolveJoiningPackageShoppingCredit(payment));
    return handleResponse(res, 200, "Payment approved", {
      paymentId: String(payment._id),
      status: payment.status,
      shoppingCreditAmount,
      activated: payment.activationApplied !== false,
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

/* ───────── Manual-QR Plan B upgrade payment review queue ───────── */

const UPGRADE_REVIEW_STATUS_OPTIONS = Object.freeze([
  PAYMENT_STATUS.CREATED,
  PAYMENT_STATUS.PENDING_REVIEW,
  PAYMENT_STATUS.CAPTURED,
  PAYMENT_STATUS.FAILED,
]);

/** GET /api/admin/mlm/upgrade-reviews */
export const listUpgradeReviews = async (req, res) => {
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
      if (!UPGRADE_REVIEW_STATUS_OPTIONS.includes(requestedStatus)) {
        return handleResponse(res, 400, "Invalid status filter");
      }
      filter.status = requestedStatus;
    } else if (!requestedStatus) {
      filter.status = PAYMENT_STATUS.PENDING_REVIEW;
    }

    let items = await MlmUpgradePayment.find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const customerIds = [...new Set(items.map((p) => String(p.customer)))];
    const customers = customerIds.length
      ? await Customer.find(
          { _id: { $in: customerIds } },
          { name: 1, phone: 1, email: 1, createdAt: 1 },
        ).lean()
      : [];
    const customerMap = new Map(customers.map((c) => [String(c._id), c]));

    const total = await MlmUpgradePayment.countDocuments(filter);

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
          registeredAt: c.createdAt || null,
        },
        amount: row.payAmountSnapshot,
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
        upgradeApplied: !!row.upgradeApplied,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    return handleResponse(res, 200, "Upgrade reviews", {
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

/** POST /api/admin/mlm/upgrade-reviews/:id/approve */
export const approveUpgradeReview = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const { adminRemarks } = req.body || {};
    const payment = await approveUpgradePayment({
      paymentId: req.params.id,
      adminId,
      adminRemarks,
    });
    return handleResponse(res, 200, "Upgrade payment approved", {
      paymentId: String(payment._id),
      status: payment.status,
      upgradeApplied: !!payment.upgradeApplied,
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

/** POST /api/admin/mlm/upgrade-reviews/:id/reject */
export const rejectUpgradeReview = async (req, res) => {
  try {
    const adminId = req.user?.id || null;
    const { reason } = req.body || {};
    const payment = await rejectUpgradePayment({
      paymentId: req.params.id,
      adminId,
      reason,
    });
    return handleResponse(res, 200, "Upgrade payment rejected", {
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

const PAYOUT_REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidReportDate(date) {
  if (!PAYOUT_REPORT_DATE_RE.test(String(date || ""))) {
    const err = new Error("date must be YYYY-MM-DD (IST)");
    err.statusCode = 400;
    throw err;
  }
}

/** GET /api/admin/mlm/payout-reports */
export const listMlmPayoutReports = async (req, res) => {
  try {
    const { from, to, status, page = 1, limit = 30 } = req.query || {};
    const result = await listDailyPayoutReports({
      from: from || null,
      to: to || null,
      status: status || null,
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 30, 100),
    });
    return handleResponse(res, 200, "Payout reports", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** GET /api/admin/mlm/payout-reports/:date */
export const getMlmPayoutReport = async (req, res) => {
  try {
    assertValidReportDate(req.params.date);
    const report = await getDailyPayoutReportByDate(req.params.date);
    if (!report) return handleResponse(res, 404, "Report not found");
    return handleResponse(res, 200, "Payout report", report);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** POST /api/admin/mlm/payout-reports/:date/generate */
export const generateMlmPayoutReport = async (req, res) => {
  try {
    assertValidReportDate(req.params.date);
    const force = Boolean(req.body?.force);
    const result = await generateDailyPayoutReport(req.params.date, { force });
    return handleResponse(res, 200, "Report generated", {
      skipped: result.skipped,
      report: result.report,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** PATCH /api/admin/mlm/payout-reports/:date/line-items/:lineItemId */
export const patchMlmPayoutReportLineItem = async (req, res) => {
  try {
    assertValidReportDate(req.params.date);
    const report = await MlmDailyPayoutReport.findOne({ reportDate: req.params.date });
    if (!report) return handleResponse(res, 404, "Report not found");
    if (report.status === MLM_DAILY_PAYOUT_REPORT_STATUS.FINALIZED) {
      return handleResponse(res, 400, "Cannot edit a finalized report");
    }

    const line = report.memberLineItems.id(req.params.lineItemId);
    if (!line) return handleResponse(res, 404, "Line item not found");

    const { correctedTotal, adminNote } = req.body || {};
    if (correctedTotal !== undefined && correctedTotal !== null) {
      const num = Number(correctedTotal);
      if (!Number.isFinite(num) || num < 0) {
        return handleResponse(res, 400, "correctedTotal must be a non-negative number");
      }
      line.correctedTotal = num;
    }
    if (adminNote !== undefined) {
      line.adminNote = String(adminNote || "").trim();
    }
    await report.save();
    return handleResponse(res, 200, "Line item updated", { lineItem: line });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** POST /api/admin/mlm/payout-reports/:date/line-items/:lineItemId/apply-correction */
export const applyMlmPayoutReportCorrection = async (req, res) => {
  try {
    assertValidReportDate(req.params.date);
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return handleResponse(res, 400, "reason is required");
    }

    const report = await MlmDailyPayoutReport.findOne({ reportDate: req.params.date });
    if (!report) return handleResponse(res, 404, "Report not found");
    if (report.status === MLM_DAILY_PAYOUT_REPORT_STATUS.FINALIZED) {
      return handleResponse(res, 400, "Cannot correct a finalized report");
    }

    const line = report.memberLineItems.id(req.params.lineItemId);
    if (!line) return handleResponse(res, 404, "Line item not found");

    const targetTotal = line.correctedTotal ?? line.autoTotal;
    const alreadyApplied = (line.adjustments || []).reduce((sum, adj) => {
      const signed = adj.direction === "DEBIT" ? -adj.amount : adj.amount;
      return sum + signed;
    }, 0);
    const effectiveCurrent = line.autoTotal + alreadyApplied;
    const delta = Math.round((targetTotal - effectiveCurrent) * 100) / 100;

    if (Math.abs(delta) < 0.01) {
      return handleResponse(res, 400, "No wallet correction needed (already matches target)");
    }

    const direction = delta > 0 ? "CREDIT" : "DEBIT";
    const amount = Math.abs(delta);
    const membership = await MlmMembership.findById(line.membershipId);
    if (!membership) return handleResponse(res, 404, "Member not found");

    const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.MANUAL_ADJUSTMENT}-RPT-${report.reportDate}-${line._id}-${Date.now()}`;
    const session = await mongoose.startSession();
    let walletResult;
    try {
      await session.withTransaction(async () => {
        const args = {
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: membership.userId,
          amount,
          bucket: "earnings",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
          ledgerReference: idempotencyKey,
          ledgerDescription: `Payout report ${report.reportDate} correction: ${reason}`,
          idempotencyKey,
          metadata: {
            // Persist the target bucket so wallet-history labelling and
            // category filters resolve the correct wallet (earnings).
            bucket: "earnings",
            adminId: req.user?.id ? String(req.user.id) : null,
            reason: String(reason).trim(),
            reportDate: report.reportDate,
            lineItemId: String(line._id),
          },
          syncUserWalletBalance: false,
        };
        walletResult =
          direction === "CREDIT"
            ? await creditWallet(args)
            : await debitWallet(args);

        // Amounts stay non-negative (schema min: 0); debit vs credit is
        // carried by status + meta.direction / clawbackAmount.
        const isCredit = direction === "CREDIT";
        await MlmCommissionEvent.create(
          [
            {
              recipientId: membership.userId,
              recipientMembershipId: membership._id,
              sourceUserId: req.user?.id || null,
              bonusType: MLM_BONUS_TYPE.MANUAL_ADJUSTMENT,
              planType: membership.planType,
              bonusAmount: amount,
              cappedAmount: isCredit ? amount : 0,
              clawbackAmount: isCredit ? 0 : amount,
              rolloverAmount: 0,
              walletBucket: "earnings",
              ledgerEntryId: walletResult?.ledgerEntry?._id || null,
              status: isCredit
                ? MLM_COMMISSION_EVENT_STATUS.CREDITED
                : MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
              idempotencyKey,
              description: `Payout report correction: ${reason}`,
              meta: {
                adminId: req.user?.id ? String(req.user.id) : null,
                direction,
                reportDate: report.reportDate,
              },
            },
          ],
          { session },
        );

        line.adjustments.push({
          direction,
          amount,
          reason: String(reason).trim(),
          adminId: req.user?.id || null,
          appliedAt: new Date(),
          ledgerRef: idempotencyKey,
          idempotencyKey,
        });
        await report.save({ session });
        await syncCustomerMlmProjection(membership.userId, { session });
      });
    } finally {
      await session.endSession();
    }

    return handleResponse(res, 200, "Correction applied", {
      direction,
      amount,
      idempotencyKey,
      lineItem: line,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** POST /api/admin/mlm/payout-reports/:date/finalize */
export const finalizeMlmPayoutReport = async (req, res) => {
  try {
    assertValidReportDate(req.params.date);
    const report = await MlmDailyPayoutReport.findOne({ reportDate: req.params.date });
    if (!report) return handleResponse(res, 404, "Report not found");
    if (report.status === MLM_DAILY_PAYOUT_REPORT_STATUS.FINALIZED) {
      return handleResponse(res, 200, "Already finalized", { report });
    }

    report.status = MLM_DAILY_PAYOUT_REPORT_STATUS.FINALIZED;
    report.finalizedAt = new Date();
    report.finalizedBy = req.user?.id || null;
    if (req.body?.adminNotes) {
      report.adminNotes = String(req.body.adminNotes).trim();
    }
    await report.save();
    return handleResponse(res, 200, "Report finalized", { report });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** DELETE /api/admin/mlm/payout-reports/:date
 *
 * Removes a daily payout report row. Safe because the report is
 * derived data (a rollup of MlmCommissionEvent) — deleting it never
 * touches wallets or ledger entries, and the same date can be
 * regenerated at any time via the generate endpoint.
 */
export const deleteMlmPayoutReport = async (req, res) => {
  try {
    assertValidReportDate(req.params.date);
    const report = await MlmDailyPayoutReport.findOneAndDelete({
      reportDate: req.params.date,
    });
    if (!report) return handleResponse(res, 404, "Report not found");

    console.warn(
      `[mlm-payout-report] admin=${req.user?.id || null} deleted report ${req.params.date} (status=${report.status})`,
    );

    return handleResponse(res, 200, "Report deleted", {
      reportDate: req.params.date,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

/** GET /api/admin/mlm/payout-reports/:date/export */
export const exportMlmPayoutReport = async (req, res) => {
  try {
    assertValidReportDate(req.params.date);
    const report = await getDailyPayoutReportByDate(req.params.date);
    if (!report) return handleResponse(res, 404, "Report not found");
    const csv = serializeReportForExport(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mlm-payout-report-${req.params.date}.csv"`,
    );
    return res.send(csv);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};
