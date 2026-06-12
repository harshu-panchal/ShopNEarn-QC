import mongoose from "mongoose";
import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import MlmMembership from "../../models/mlmMembership.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../../constants/finance.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { creditWallet } from "../finance/walletService.js";
import { getSignupBonusConfig } from "./mlmConfigService.js";

/**
 * mlmSignupBonusService — signup bonus credits for the MLM program.
 *
 * Two distinct credit moments, each with its own entry point:
 *
 *   1. `applyRegistrationBonusInSession` — fires the moment a new
 *      MlmMembership is minted (status = REGISTERED_UNPAID). Only
 *      credits the SPONSOR (₹50 by default) to their shopping wallet.
 *      The new customer does NOT receive a self-bonus at this stage —
 *      it is deferred to activation so the money is only granted once
 *      the customer has confirmed intent by paying the joining fee.
 *
 *   2. `applySelfSignupBonusAtActivation` — fires inside
 *      `mlmActivationService.activateMembershipFromJoiningPayment`
 *      after the joining payment is CAPTURED. Credits ₹100 (default)
 *      to the NEW CUSTOMER's shopping wallet as a welcome bonus.
 *
 * Both go to the `shopping` wallet bucket — usable at checkout but
 * NOT withdrawable as cash (per PO decision).
 *
 * Idempotency contract (same for both entry points):
 *   - `LedgerEntry.idempotencyKey` (partial unique index) is the real
 *     backstop — duplicate inserts collapse to no-ops at the DB.
 *   - `MlmCommissionEvent.idempotencyKey` (partial unique index) does
 *     the same for the audit row.
 *   - The membership-level `signupBonusCreditedAt` flag is the fast-
 *     path: when set we exit early without touching wallets.
 */

/**
 * Credit the SPONSOR's signup acquisition bonus (₹50 by default) to
 * their shopping wallet. Called inside the membership-creation
 * transaction when a new customer registers with a referral code.
 *
 * The self-bonus (₹100) is NOT credited here — it fires later at
 * activation via `applySelfSignupBonusAtActivation`.
 *
 * @param {object} opts
 * @param {mongoose.Types.ObjectId} opts.newCustomerId
 * @param {MlmMembership}           opts.newMembership   - already saved, status REGISTERED_UNPAID
 * @param {mongoose.Types.ObjectId} [opts.sponsorUserId]
 * @param {MlmMembership}           [opts.sponsorMembership]
 * @param {mongoose.ClientSession}  opts.session
 * @param {string|null}             [opts.correlationId]
 *
 * @returns {Promise<{skipped: string|null, sponsorCredit: object|null}>}
 */
export async function applyRegistrationBonusInSession({
  newCustomerId,
  newMembership,
  sponsorUserId = null,
  sponsorMembership = null,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "applyRegistrationBonusInSession requires an open mongoose session.",
    );
  }
  if (!newCustomerId || !newMembership) {
    throw new Error(
      "applyRegistrationBonusInSession requires `newCustomerId` and `newMembership`.",
    );
  }

  // Fast-path: already credited for this member (idempotency guard).
  if (newMembership.signupBonusCreditedAt) {
    return { skipped: "ALREADY_CREDITED", selfCredit: null, sponsorCredit: null };
  }

  const cfg = await getSignupBonusConfig();
  if (!cfg.enabled) {
    return { skipped: "DISABLED", selfCredit: null, sponsorCredit: null };
  }
  if (cfg.selfAmount <= 0 && cfg.sponsorAmount <= 0) {
    return { skipped: "ZERO_AMOUNT", selfCredit: null, sponsorCredit: null };
  }

  // ── Self credit ────────────────────────────────────────────────────
  // Credit ₹100 (or configured amount) to the NEW USER's shopping
  // wallet immediately at account creation so they see a non-zero
  // balance before paying the joining fee.
  let selfCredit = null;
  if (cfg.selfAmount > 0) {
    const selfIdempotencyKey =
      `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(newCustomerId)}`;
    selfCredit = await creditMemberSignupBonus({
      recipientUserId: newCustomerId,
      recipientMembership: newMembership,
      amount: cfg.selfAmount,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
      ledgerReference: selfIdempotencyKey,
      ledgerDescription: "MLM signup bonus — welcome credit",
      idempotencyKey: selfIdempotencyKey,
      correlationId,
      meta: {
        mlmEvent: "SIGNUP_BONUS_SELF",
        newCustomerId: String(newCustomerId),
        sponsorUserId: sponsorUserId ? String(sponsorUserId) : null,
      },
      sourceUserId: sponsorUserId || null,
      session,
    });
  }

  // ── Sponsor credit ─────────────────────────────────────────────────
  // Credit ₹50 (or configured amount) to the SPONSOR's shopping wallet.
  // Skip silently when there's no sponsor or the new customer is
  // somehow their own sponsor.
  let sponsorCredit = null;
  const sameAsSelf =
    sponsorUserId && String(sponsorUserId) === String(newCustomerId);

  if (cfg.sponsorAmount > 0 && sponsorUserId && !sameAsSelf) {
    const sponsorIdempotencyKey =
      `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${String(sponsorUserId)}-${String(newCustomerId)}`;

    let sponsorMemDoc = sponsorMembership || null;
    if (!sponsorMemDoc) {
      sponsorMemDoc = await MlmMembership.findOne({
        userId: sponsorUserId,
      }).session(session);
    }

    sponsorCredit = await creditMemberSignupBonus({
      recipientUserId: sponsorUserId,
      recipientMembership: sponsorMemDoc,
      amount: cfg.sponsorAmount,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR,
      ledgerReference: sponsorIdempotencyKey,
      ledgerDescription: "MLM signup bonus — referral acquired",
      idempotencyKey: sponsorIdempotencyKey,
      correlationId,
      meta: {
        mlmEvent: "SIGNUP_BONUS_SPONSOR",
        newCustomerId: String(newCustomerId),
        sponsorUserId: String(sponsorUserId),
      },
      sourceUserId: newCustomerId,
      session,
    });
  }

  // Stamp the flag so re-runs short-circuit at the top of this function.
  newMembership.signupBonusCreditedAt = new Date();
  await newMembership.save({ session });

  return {
    skipped: null,
    selfCredit,
    sponsorCredit,
  };
}

/**
 * Credit the NEW CUSTOMER's self signup bonus (₹100 by default) to
 * their shopping wallet. Must be called AFTER the joining payment is
 * CAPTURED (inside `mlmActivationService.activateMembershipFromJoiningPayment`).
 *
 * This is intentionally separate from `applyRegistrationBonusInSession`
 * so the customer only receives the bonus once they've confirmed intent
 * by paying the joining fee — preventing abuse where someone registers
 * under a sponsor code just to grab the ₹100 without ever paying.
 *
 * Idempotent: re-running after `signupBonusCreditedAt` is set returns
 * `{ skipped: "ALREADY_CREDITED" }` without touching the wallet.
 *
 * @param {object} opts
 * @param {mongoose.Types.ObjectId} opts.newCustomerId
 * @param {MlmMembership}           opts.newMembership   - status ACTIVE at this point
 * @param {mongoose.ClientSession}  opts.session
 * @param {string|null}             [opts.correlationId]
 *
 * @returns {Promise<{skipped: string|null, selfCredit: object|null}>}
 */
export async function applySelfSignupBonusAtActivation({
  newCustomerId,
  newMembership,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "applySelfSignupBonusAtActivation requires an open mongoose session.",
    );
  }
  if (!newCustomerId || !newMembership) {
    throw new Error(
      "applySelfSignupBonusAtActivation requires `newCustomerId` and `newMembership`.",
    );
  }

  // Fast-path: already credited for this member (idempotency guard).
  if (newMembership.signupBonusCreditedAt) {
    return { skipped: "ALREADY_CREDITED", selfCredit: null };
  }

  const cfg = await getSignupBonusConfig();
  if (!cfg.enabled) {
    return { skipped: "DISABLED", selfCredit: null };
  }
  if (cfg.selfAmount <= 0) {
    return { skipped: "ZERO_SELF_AMOUNT", selfCredit: null };
  }

  const selfIdempotencyKey =
    `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(newCustomerId)}`;

  // Credit ₹100 (or configured amount) to the NEW USER's shopping wallet.
  const selfCredit = await creditMemberSignupBonus({
    recipientUserId: newCustomerId,
    recipientMembership: newMembership,
    amount: cfg.selfAmount,
    bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
    ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
    ledgerReference: selfIdempotencyKey,
    ledgerDescription: "MLM signup bonus — welcome credit on plan activation",
    idempotencyKey: selfIdempotencyKey,
    correlationId,
    meta: {
      mlmEvent: "SIGNUP_BONUS_SELF",
      newCustomerId: String(newCustomerId),
    },
    sourceUserId: null,
    session,
  });

  // Stamp the flag so re-runs short-circuit at the top of this function.
  // Done last so an error in the credit path leaves the flag null and
  // the transaction rolls back cleanly.
  newMembership.signupBonusCreditedAt = new Date();
  await newMembership.save({ session });

  return {
    skipped: null,
    selfCredit,
  };
}

/**
 * Internal helper — one wallet credit + matching commission event.
 *
 * Credits to the `shopping` bucket so the amount is spendable at
 * checkout but NOT withdrawable as cash.
 */
async function creditMemberSignupBonus({
  recipientUserId,
  recipientMembership,
  amount,
  bonusType,
  ledgerType,
  ledgerReference,
  ledgerDescription,
  idempotencyKey,
  correlationId,
  meta,
  sourceUserId,
  session,
}) {
  const creditResult = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: recipientUserId,
    amount,
    // Shopping bucket: spendable at checkout, NOT withdrawable.
    bucket: "shopping",
    session,
    ledgerType,
    ledgerReference,
    ledgerDescription,
    metadata: meta,
    idempotencyKey,
    correlationId,
    syncUserWalletBalance: false,
  });

  const eventDoc = await MlmCommissionEvent.create(
    [
      {
        recipientId: recipientUserId,
        recipientMembershipId: recipientMembership?._id || null,
        sourceUserId,
        bonusType,
        planType: MLM_PLAN_TYPE.A,
        baseAmount: amount,
        bonusAmount: amount,
        cappedAmount: amount,
        rolloverAmount: 0,
        // Matches the actual bucket used above.
        walletBucket: "shopping",
        ledgerEntryId: creditResult?.ledgerEntry?._id || null,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey,
        correlationId,
        description: ledgerDescription,
        meta,
      },
    ],
    { session },
  ).then((rows) => rows[0]);

  return {
    amount,
    walletBalanceAfter: creditResult?.after,
    ledgerEntryId: creditResult?.ledgerEntry?._id || null,
    eventId: eventDoc?._id || null,
  };
}

/**
 * Convenience wrapper that owns its own transaction. Useful for the
 * backfill script and any future admin "re-issue signup bonus" tool
 * — both of which run OUTSIDE an existing session.
 *
 * Returns the same shape as `applyRegistrationBonusInSession`. Any
 * thrown error rolls the credits back at the DB.
 */
export async function applyRegistrationBonusStandalone({
  newCustomerId,
  newMembership,
  sponsorUserId = null,
  sponsorMembership = null,
  correlationId = null,
}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await applyRegistrationBonusInSession({
        newCustomerId,
        newMembership,
        sponsorUserId,
        sponsorMembership,
        session,
        correlationId,
      });
    });
  } finally {
    await session.endSession();
  }
  return result;
}
