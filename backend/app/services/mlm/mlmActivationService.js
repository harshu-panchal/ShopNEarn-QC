import mongoose from "mongoose";
import Customer from "../../models/customer.js";
import MlmJoiningPayment from "../../models/mlmJoiningPayment.js";
import MlmMembership from "../../models/mlmMembership.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../../constants/finance.js";
import {
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { creditWallet } from "../finance/walletService.js";
import {
  assignSponsor,
  createOrGetMembership,
  syncCustomerMlmProjection,
  transitionUplineDownlineStatus,
} from "./mlmMembershipService.js";
import {
  propagateBinaryTeamPairIncome,
} from "./mlmBinaryPairIncomeService.js";
import {
  releaseHeldPairBonusesForDownlineActivation,
} from "./mlmBonusEngineService.js";
import {
  releaseHeldSignupBonusesForSponsorActivation,
  releaseHeldSelfSignupBonusOnReferralActivation,
  restoreClawedSignupBonusesForActivatedSponsors,
  applyDirectReferralActivationBonusInSession,
} from "./mlmSignupBonusService.js";
import { getMlmConfig } from "./mlmConfigService.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";

/**
 * mlmActivationService — orchestrates everything that happens between
 * "a customer's joining-payment is captured" and "the customer has an
 * active Plan A membership with shopping-wallet seed and sponsor
 * milestone bonus paid".
 *
 * Two entry points:
 *   1. `activateMembershipFromJoiningPayment(paymentId)` — called from
 *      the joining-payment CAPTURED hook (webhook + client verify).
 *      Idempotent via `MlmJoiningPayment.activationApplied`.
 *   2. `upgradeToPlanBIfEligible(userId)` — called after every Plan A
 *      bonus credit to check the auto-upgrade trigger.
 *
 * Both functions are session-aware: they open their own transaction
 * if none is supplied, or join the caller's transaction.
 */

async function runInSession(externalSession, fn) {
  if (externalSession) {
    return fn(externalSession);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

/**
 * Activate Plan A membership for the customer of `joiningPaymentId`.
 *
 * Operations (all inside one session):
 *   1. Reload the MlmJoiningPayment; short-circuit if `activationApplied` is true.
 *   2. Refuse to activate unless the payment is CAPTURED (defence-in-depth).
 *   3. Ensure MlmMembership exists for the customer (lazy-create).
 *   4. If the payment carries a `sponsorReferralCodeSnapshot` and the
 *      membership has no sponsor yet, assign the sponsor edge (this
 *      builds sponsorChain, places into binary tree, bumps counters,
 *      etc). Falls back to `Customer.pendingSponsorReferralCode` for
 *      payments minted before the snapshot field was introduced.
 *   5. Credit the joining-package shopping-wallet seed (using the
 *      payment's snapshot value — NOT the live config — so admins
 *      can't cheat mid-flight customers) to `shoppingBalance`.
 *   6. Propagate binary team pair income up the placement tree
 *      (client PHP spec: 2:1 first pair, 1:1 after, tiered ₹/pair).
 *   7. Mark `MlmJoiningPayment.activationApplied = true`.
 *   8. Resync the customer's denormalised `Customer.mlm` projection.
 *
 * Returns `{ membership, sponsorMembership, shoppingCreditAmount,
 * pairBonusEvents }` on success.
 *
 * Idempotent: re-running the function on an already-activated payment
 * is a no-op (returns the existing membership + zero new credits).
 */
export async function activateMembershipFromJoiningPayment(
  paymentOrId,
  { correlationId = null, session: externalSession } = {},
) {
  return runInSession(externalSession, async (session) => {
    const payment = await (paymentOrId instanceof mongoose.Model
      ? Promise.resolve(paymentOrId)
      : MlmJoiningPayment.findById(paymentOrId).session(session));

    if (!payment) {
      throw new Error(
        `MlmJoiningPayment not found for activation: ${paymentOrId}`,
      );
    }

    if (payment.activationApplied) {
      return {
        skipped: true,
        reason: "already_activated",
        paymentId: payment._id,
      };
    }

    // Defence-in-depth: the side-effect dispatcher only invokes us on
    // CAPTURED, but reload-safe.
    if (payment.status !== "CAPTURED") {
      return {
        skipped: true,
        reason: "payment_not_captured",
        paymentId: payment._id,
        currentStatus: payment.status,
      };
    }

    const customerId = payment.customer;
    if (!customerId) {
      throw new Error(`MlmJoiningPayment ${payment._id} has no customer`);
    }

    const customer = await Customer.findById(customerId, null, { session });
    if (!customer) {
      throw new Error(`Customer ${customerId} not found for MLM activation`);
    }

    // Customer-MLM-rebuild Phase 4: in the new signup flow the
    // membership row already exists (status REGISTERED_UNPAID), with
    // the sponsor edge wired and the binary tree placement done. The
    // payment flow's only remaining job is to flip the status flag,
    // seed the shopping wallet, and release HELD sponsor pair-bonuses.
    //
    // For legacy customers that never went through the new signup
    // (no membership row at all yet), `createOrGetMembership` still
    // mints a fresh ACTIVE row here for back-compat.
    const { membership } = await createOrGetMembership(customerId, { session });
    const wasPreviouslyUnpaid =
      membership.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID;
    if (wasPreviouslyUnpaid) {
      membership.status = MLM_MEMBERSHIP_STATUS.ACTIVE;
      membership.planAJoinedAt = membership.planAJoinedAt || new Date();
      await membership.save({ session });

      await transitionUplineDownlineStatus(membership.sponsorChain, { session });
    }

    // Prefer the snapshot taken at intent time; fall back to the live
    // pendingSponsorReferralCode for payments minted before the
    // snapshot field existed (or in case the snapshot was empty and
    // the customer entered a code afterwards).
    const sponsorCodeForActivation =
      payment.sponsorReferralCodeSnapshot ||
      customer.pendingSponsorReferralCode ||
      null;

    let sponsorMembership = null;
    if (!membership.sponsorId && sponsorCodeForActivation) {
      try {
        const updated = await assignSponsor({
          membership,
          sponsorReferralCode: sponsorCodeForActivation,
          session,
          // Legacy rows without pendingSponsorLeg fall back to spillover
          // on the left leg. Current signup always captures L/R and
          // wires the sponsor edge before activation, so this branch
          // only fires for those legacy rows.
          preferredBinaryPosition: customer.pendingSponsorLeg || "L",
          forceManualPlacement: true,
        });
        if (updated && updated.sponsorId) {
          sponsorMembership = await MlmMembership.findOne(
            { userId: updated.sponsorId },
            null,
            { session },
          );
        }
      } catch (error) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn(
            "[mlmActivationService] assignSponsor failed; continuing without sponsor",
            { userId: String(customerId), error: error.message },
          );
        }
      }
    } else if (membership.sponsorId) {
      sponsorMembership = await MlmMembership.findOne(
        { userId: membership.sponsorId },
        null,
        { session },
      );
    }

    const shoppingCreditAmount = Number(payment.shoppingCreditSnapshot) || 0;
    let shoppingCreditResult = null;
    if (shoppingCreditAmount > 0) {
      shoppingCreditResult = await creditWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: customerId,
        amount: shoppingCreditAmount,
        // Shopping bucket: spendable at checkout, NOT withdrawable as cash.
        bucket: "shopping",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
        ledgerReference: `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-${payment._id}`,
        ledgerDescription: "MLM joining package shopping wallet seed",
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-${payment._id}`,
        correlationId,
        metadata: {
          mlmEvent: "JOINING_PACKAGE_ACTIVATED",
          paymentId: String(payment._id),
        },
        syncUserWalletBalance: false,
      });
    }

    // Plan A binary team pair income (client PHP spec).
    let pairBonusEvents = [];
    if (wasPreviouslyUnpaid || membership.status === MLM_MEMBERSHIP_STATUS.ACTIVE) {
      await releaseHeldPairBonusesForDownlineActivation({
        newActiveUserId: customerId,
        session,
        correlationId,
      });

      await releaseHeldSignupBonusesForSponsorActivation({
        sponsorUserId: customerId,
        session,
        correlationId,
      });

      await releaseHeldSelfSignupBonusOnReferralActivation({
        activatedUserId: customerId,
        session,
        correlationId,
      });

      await restoreClawedSignupBonusesForActivatedSponsors({
        sponsorUserId: customerId,
        session,
        correlationId,
      });

      pairBonusEvents = await propagateBinaryTeamPairIncome({
        activatedUserId: customerId,
        session,
        correlationId,
      });

      await applyDirectReferralActivationBonusInSession({
        activatedUserId: customerId,
        activatedMembership: membership,
        session,
        correlationId,
      });
    }

    payment.activationApplied = true;
    payment.activationCompletedAt = new Date();
    payment.activationError = null;
    await payment.save({ session });

    if (customer.pendingSponsorReferralCode) {
      customer.pendingSponsorReferralCode = null;
      await customer.save({ session });
    }

    await syncCustomerMlmProjection(customerId, { session });

    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.MLM_MEMBERSHIP_ACTIVATED, {
        userId: String(customerId),
        data: {
          referralCode: membership?.referralCode,
          membershipId: String(membership?._id || ""),
        },
      });
    } catch (_) {
      /* non-fatal */
    }

    return {
      activated: true,
      membership,
      sponsorMembership,
      shoppingCreditAmount,
      shoppingCreditResult,
      pairBonusEvents,
      milestoneEvent: pairBonusEvents?.[0] || null,
    };
  });
}

/**
 * Customer-MLM-rebuild Phase 7 (PO-request): admin-initiated
 * "approve without payment" activation.
 *
 * Same end-state as `activateMembershipFromJoiningPayment`, including
 * the Plan A joining-package shopping-wallet seed from live MLM config
 * (`joiningPackageShoppingWalletCredit`, default ₹5000).
 *
 * Operations (all inside one session):
 *   1. Reload the membership; require status REGISTERED_UNPAID.
 *      ACTIVE → idempotent no-op.
 *      SUSPENDED / TERMINATED → 409 (admin must lift first).
 *   2. Flip status to ACTIVE, planType to A, set planAJoinedAt.
 *   3. Credit joining-package shopping wallet (idempotent per membership).
 *   4. Stamp `meta.adminApprovedActivation = { adminId, at, ... }`
 *      and `updatedBy = adminId` for the audit trail.
 *   5. Release any HELD pair-bonuses sitting on this member's
 *      sponsor (the exact same path the paid activation takes).
 *   6. Resync the customer's denormalised `Customer.mlm` projection.
 *   7. Fire the MLM_MEMBERSHIP_ACTIVATED notification.
 *
 * Returns `{ activated, membership, shoppingCreditAmount, releasedEvents }`.
 * Idempotent: re-running on an already-active membership returns
 * `{ skipped: true, reason: "already_active" }`.
 */
export async function adminActivateMembership({
  membershipId,
  adminId,
  reason = "",
  correlationId = null,
  session: externalSession,
} = {}) {
  if (!membershipId) {
    const err = new Error("membershipId is required");
    err.statusCode = 422;
    throw err;
  }
  if (!adminId) {
    const err = new Error("adminId is required");
    err.statusCode = 401;
    throw err;
  }

  return runInSession(externalSession, async (session) => {
    const membership = await MlmMembership.findById(membershipId).session(
      session,
    );
    if (!membership) {
      const err = new Error("Membership not found");
      err.statusCode = 404;
      err.code = "MEMBERSHIP_NOT_FOUND";
      throw err;
    }

    if (membership.status === MLM_MEMBERSHIP_STATUS.ACTIVE) {
      return {
        skipped: true,
        reason: "already_active",
        membership,
      };
    }

    if (membership.status !== MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID) {
      const err = new Error(
        `Cannot admin-activate a membership in status ${membership.status}.`,
      );
      err.statusCode = 409;
      err.code = "INVALID_STATUS";
      throw err;
    }

    const customerId = membership.userId;

    // Flip to ACTIVE / Plan A and stamp the audit fields.
    membership.status = MLM_MEMBERSHIP_STATUS.ACTIVE;
    membership.planType = MLM_PLAN_TYPE.A;
    membership.planAJoinedAt = membership.planAJoinedAt || new Date();
    membership.updatedBy = adminId;

    const meta = membership.meta || {};
    meta.adminApprovedActivation = {
      adminId: String(adminId),
      at: new Date(),
      source: "admin_manual",
      reason: String(reason || "").slice(0, 1000),
    };
    membership.meta = meta;
    // Mongoose Mixed paths require an explicit markModified before
    // save() picks up nested changes.
    membership.markModified("meta");

    await membership.save({ session });

    await transitionUplineDownlineStatus(membership.sponsorChain, { session });

    const cfg = await getMlmConfig();
    const shoppingCreditAmount =
      Number(cfg.joiningPackageShoppingWalletCredit) || 0;
    let shoppingCreditResult = null;
    if (shoppingCreditAmount > 0) {
      shoppingCreditResult = await creditWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: customerId,
        amount: shoppingCreditAmount,
        bucket: "shopping",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
        ledgerReference: `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-ADMIN-${membership._id}`,
        ledgerDescription: "MLM joining package shopping wallet seed (admin approval)",
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-ADMIN-${membership._id}`,
        correlationId,
        metadata: {
          mlmEvent: "JOINING_PACKAGE_ACTIVATED",
          activationSource: "admin_manual",
          membershipId: String(membership._id),
          adminId: String(adminId),
        },
        syncUserWalletBalance: false,
      });
    }

    let pairBonusEvents = [];
    const releasedEvents = await releaseHeldPairBonusesForDownlineActivation({
      newActiveUserId: customerId,
      session,
      correlationId,
    });

    await releaseHeldSignupBonusesForSponsorActivation({
      sponsorUserId: customerId,
      session,
      correlationId,
    });

    await releaseHeldSelfSignupBonusOnReferralActivation({
      activatedUserId: customerId,
      session,
      correlationId,
    });

    await restoreClawedSignupBonusesForActivatedSponsors({
      sponsorUserId: customerId,
      session,
      correlationId,
    });

    pairBonusEvents = await propagateBinaryTeamPairIncome({
      activatedUserId: customerId,
      session,
      correlationId,
    });

    await applyDirectReferralActivationBonusInSession({
      activatedUserId: customerId,
      activatedMembership: membership,
      session,
      correlationId,
    });

    await syncCustomerMlmProjection(customerId, { session });

    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.MLM_MEMBERSHIP_ACTIVATED, {
        userId: String(customerId),
        data: {
          referralCode: membership?.referralCode,
          membershipId: String(membership?._id || ""),
          activationSource: "admin_manual",
        },
      });
    } catch (_) {
      /* non-fatal */
    }

    return {
      activated: true,
      membership,
      shoppingCreditAmount,
      shoppingCreditResult,
      releasedEvents,
      pairBonusEvents,
    };
  });
}

/**
 * If the customer's lifetime Plan A earnings have crossed the
 * configured threshold AND they are still on Plan A, promote them to
 * Plan B atomically:
 *   - Set planType = "B", planBJoinedAt = now.
 *   - Apply Plan B upgrade benefits (Phase 4 will extend with
 *     home-shopping unlock and shopping top-up). Phase 1 only flips
 *     the planType so subsequent bonus computations route correctly.
 *
 * Idempotent: re-running on a Plan B member is a no-op.
 */
export async function upgradeToPlanBIfEligible(userId, { session: externalSession } = {}) {
  return runInSession(externalSession, async (session) => {
    const cfg = await getMlmConfig();
    const threshold = Number(cfg.planBAutoUpgradeAtPlanALifetimeEarnings) || 0;

    const membership = await MlmMembership.findOne({ userId }, null, { session });
    if (!membership || membership.planType !== MLM_PLAN_TYPE.A) {
      return { upgraded: false, reason: "not_eligible" };
    }
    if (threshold <= 0 || membership.lifetimePlanAEarnings < threshold) {
      return { upgraded: false, reason: "threshold_not_reached" };
    }

    membership.planType = MLM_PLAN_TYPE.B;
    membership.planBJoinedAt = new Date();
    membership.homeShoppingUnlocked = true;
    await membership.save({ session });

    // Phase 2: apply Plan B upgrade benefits — shopping-wallet top-up
    // (default ₹10,000) credited atomically inside the same session.
    // Home shopping unlock is just a flag flip above (Phase 4 wires
    // the claim flow). Idempotent via stable ledger key.
    const topupAmount = Number(cfg.premiumUpgradeShoppingWalletTopup) || 0;
    if (topupAmount > 0) {
      try {
        await creditWallet({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: userId,
          amount: topupAmount,
          bucket: "shopping",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT,
          ledgerReference: `${MLM_IDEMPOTENCY_PREFIX.PREMIUM_UPGRADE_CREDIT}-${userId}`,
          ledgerDescription: "Plan B upgrade shopping-wallet top-up",
          idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.PREMIUM_UPGRADE_CREDIT}-${userId}`,
          metadata: {
            mlmEvent: "PLAN_B_UPGRADED",
            membershipId: String(membership._id),
          },
          syncUserWalletBalance: false,
        });
      } catch (error) {
        // Idempotent duplicate is the only expected error here (re-upgrade
        // attempts collide on the unique ledger idempotency key). Swallow
        // it because the plan flip is the authoritative outcome.
        if (typeof console !== "undefined" && console.warn) {
          console.warn(
            "[mlmActivationService] Plan B top-up credit skipped (likely duplicate)",
            { userId: String(userId), error: error.message },
          );
        }
      }
    }

    await syncCustomerMlmProjection(userId, { session });

    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.MLM_PLAN_B_UPGRADED, {
        userId: String(userId),
        data: {
          membershipId: String(membership._id),
          topupAmount,
        },
      });
    } catch (_) {
      /* non-fatal */
    }

    return { upgraded: true, membership, topupAmount };
  });
}
