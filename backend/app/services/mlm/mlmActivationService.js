import mongoose from "mongoose";
import Order from "../../models/order.js";
import Customer from "../../models/customer.js";
import MlmMembership from "../../models/mlmMembership.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../../constants/finance.js";
import {
  MLM_IDEMPOTENCY_PREFIX,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { creditWallet } from "../finance/walletService.js";
import {
  assignSponsor,
  createOrGetMembership,
  syncCustomerMlmProjection,
} from "./mlmMembershipService.js";
import { computeAndCreditDirectReferralMilestone } from "./mlmBonusEngineService.js";
import { getMlmConfig } from "./mlmConfigService.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";

/**
 * mlmActivationService — orchestrates everything that happens between
 * "a customer's joining-package order is paid" and "the customer has
 * an active Plan A membership with shopping-wallet seed and sponsor
 * milestone bonus paid".
 *
 * Two entry points:
 *   1. `activatePlanAOnJoiningPackagePaid(orderId)` — called from the
 *      payment-CAPTURED hook (online) and the COD-collected hook.
 *      Idempotent via `Order.mlmActivationApplied`.
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
 * Activate Plan A membership for the customer of `orderOrId`.
 *
 * Operations (all inside one session):
 *   1. Reload the order; short-circuit if `mlmActivationApplied` is true.
 *   2. Ensure MlmMembership exists for the customer (lazy-create).
 *   3. If the customer captured a `pendingSponsorReferralCode` at signup
 *      and the membership has no sponsor yet, assign the sponsor edge
 *      (this builds sponsorChain, places into binary tree, bumps
 *      counters, etc).
 *   4. Credit the joining-package shopping-wallet seed (admin-configured
 *      amount; default ₹5000) to the customer's `shoppingBalance`.
 *   5. Fire the direct-referral milestone bonus for the sponsor (if any).
 *   6. Mark `Order.mlmActivationApplied = true`.
 *   7. Resync the customer's denormalised `Customer.mlm` projection.
 *
 * Returns `{ membership, sponsorMembership, shoppingCreditAmount,
 * milestoneEvent }` on success.
 *
 * Idempotent: re-running the function on an already-activated order is
 * a no-op (returns the existing membership + zero new credits).
 */
export async function activatePlanAOnJoiningPackagePaid(
  orderOrId,
  { correlationId = null, session: externalSession } = {},
) {
  return runInSession(externalSession, async (session) => {
    const cfg = await getMlmConfig();

    const order = await (orderOrId instanceof mongoose.Model
      ? Promise.resolve(orderOrId)
      : Order.findById(orderOrId).session(session));

    if (!order) {
      throw new Error(`Order not found for MLM activation: ${orderOrId}`);
    }

    if (!order.isJoiningPackageOrder) {
      return {
        skipped: true,
        reason: "not_a_joining_package_order",
        orderId: order._id,
      };
    }

    if (order.mlmActivationApplied) {
      return {
        skipped: true,
        reason: "already_activated",
        orderId: order._id,
      };
    }

    const customerId = order.customer;
    if (!customerId) {
      throw new Error(`Order ${order._id} has no customer to activate`);
    }

    const customer = await Customer.findById(customerId, null, { session });
    if (!customer) {
      throw new Error(`Customer ${customerId} not found for MLM activation`);
    }

    // 1. Ensure membership exists
    const { membership } = await createOrGetMembership(customerId, { session });

    // 2. Assign sponsor if a pending referral code was captured at signup
    let sponsorMembership = null;
    if (!membership.sponsorId && customer.pendingSponsorReferralCode) {
      try {
        const updated = await assignSponsor({
          membership,
          sponsorReferralCode: customer.pendingSponsorReferralCode,
          session,
        });
        if (updated && updated.sponsorId) {
          sponsorMembership = await MlmMembership.findOne(
            { userId: updated.sponsorId },
            null,
            { session },
          );
        }
      } catch (error) {
        // self-referral or schema errors are non-fatal — log and continue.
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

    // 3. Credit the joining-package shopping-wallet seed
    const shoppingCreditAmount = Number(cfg.joiningPackageShoppingWalletCredit) || 0;
    let shoppingCreditResult = null;
    if (shoppingCreditAmount > 0) {
      shoppingCreditResult = await creditWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: customerId,
        amount: shoppingCreditAmount,
        bucket: "shopping",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
        ledgerReference: `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-${order._id}`,
        ledgerDescription: "MLM joining package shopping wallet seed",
        orderId: order._id,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-${order._id}`,
        correlationId,
        metadata: {
          mlmEvent: "JOINING_PACKAGE_ACTIVATED",
          orderId: String(order._id),
        },
        syncUserWalletBalance: false, // shopping bucket is separate from legacy mirror
      });
    }

    // 4. Fire direct-referral milestone bonus for the sponsor
    let milestoneEvent = null;
    if (sponsorMembership) {
      const sponsorUserId = sponsorMembership.userId;
      const refreshedSponsor = await MlmMembership.findOne(
        { userId: sponsorUserId },
        null,
        { session },
      );
      const directCount = refreshedSponsor?.directReferralsCount || 0;
      milestoneEvent = await computeAndCreditDirectReferralMilestone({
        sponsorUserId,
        newReferralUserId: customerId,
        atDirectCount: directCount,
        session,
        correlationId,
      });
    }

    // 5. Mark activation applied (idempotency guard) and persist
    order.mlmActivationApplied = true;
    await order.save({ session });

    // 6. Clear pendingSponsorReferralCode so re-runs don't try to re-assign
    if (customer.pendingSponsorReferralCode) {
      customer.pendingSponsorReferralCode = null;
      await customer.save({ session });
    }

    // 7. Final projection resync
    await syncCustomerMlmProjection(customerId, { session });

    // 8. Fire the membership-activated notification AFTER the
    //    transaction commits (emitter uses `setImmediate` internally
    //    so this is safe to call from inside the txn body).
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
      milestoneEvent,
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
