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
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { creditWallet } from "../finance/walletService.js";
import {
  assignSponsor,
  createOrGetMembership,
  syncCustomerMlmProjection,
} from "./mlmMembershipService.js";
import { computeAndCreditBinaryPairBonus } from "./mlmBonusEngineService.js";
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
 *   6. Fire the Plan A binary pair-matching bonus for the sponsor
 *      (if any) via `computeAndCreditBinaryPairBonus`. Replaces the
 *      legacy direct-referral count milestone.
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

    const { membership } = await createOrGetMembership(customerId, { session });

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

    // Plan A binary pair-matching bonus.
    //
    // `assignSponsor` has already bumped the sponsor's
    // `leftLegDirectCount` / `rightLegDirectCount` for the leg the new
    // member landed in. The pair-bonus engine reads those freshly
    // bumped counters, computes
    //   `min(leftLegDirectCount, rightLegDirectCount)`,
    // and credits one BINARY_PAIR_MATCH event for every newly-completed
    // pair (typically 0 or 1 per activation, but the catch-up loop
    // handles multi-pair jumps if they ever occur).
    let pairBonusEvents = [];
    if (sponsorMembership) {
      pairBonusEvents = await computeAndCreditBinaryPairBonus({
        sponsorUserId: sponsorMembership.userId,
        newReferralUserId: customerId,
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
      // Backwards-compat alias for any caller still reading
      // `milestoneEvent` from the legacy direct-referral milestone
      // path. Surfaces the first newly-credited pair bonus (or null).
      milestoneEvent: pairBonusEvents?.[0] || null,
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
