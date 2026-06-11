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
 * mlmSignupBonusService — flat shopping-wallet credit fired when a
 * Customer's MlmMembership is minted (state = REGISTERED_UNPAID).
 *
 * Two credits per call, both in the SAME caller-owned session:
 *
 *   1. New customer (self)   →   `signupBonusSelfAmount`     to their
 *      `shopping` wallet bucket.
 *   2. Sponsor               →   `signupBonusSponsorAmount`  to their
 *      `shopping` wallet bucket.
 *
 * Both go to `shopping` (per the PO clarification on the redesign
 * thread) so the money is checkout-spendable but NOT withdrawable as
 * cash. Sponsor's bonus fires regardless of the sponsor's lifecycle
 * status (ACTIVE / REGISTERED_UNPAID) — this is marketing acquisition
 * spend, not earned commission, so the standard "recipient must be
 * ACTIVE" rule of `creditBonusToEarningsWallet` does not apply.
 *
 * Atomicity contract:
 *   - REQUIRES the caller's open mongoose `session`. Wallet credits +
 *     ledger entries + commission events + the membership flag bump
 *     all commit/rollback as one unit with the signup transaction.
 *   - REQUIRES a fresh `MlmMembership` instance (already persisted in
 *     the session) so the flag bump can save inside the same txn.
 *
 * Idempotency contract:
 *   - `LedgerEntry.idempotencyKey` (partial unique index) is the real
 *     backstop — duplicate inserts collapse to no-ops at the DB.
 *   - `MlmCommissionEvent.idempotencyKey` (partial unique index) does
 *     the same for the audit row.
 *   - The membership-level `signupBonusCreditedAt` flag is the fast-
 *     path: when set we exit early without touching wallets.
 *   - Result: re-running the helper for an already-credited member
 *     returns `{ skipped: "ALREADY_CREDITED" }` and writes nothing.
 *
 * Disabled / zero-amount short-circuit:
 *   - When `signupBonusEnabled === false`, returns `{ skipped: "DISABLED" }`
 *     immediately. Wallets/ledger untouched.
 *   - When BOTH amounts are 0, returns `{ skipped: "ZERO_AMOUNT" }`.
 *
 * Sponsor handling:
 *   - When `sponsorUserId` is null/undefined (legacy data — current
 *     product rules require a sponsor), the self-credit still fires
 *     but the sponsor-credit is silently skipped.
 *   - When the new customer IS their own sponsor (defensive — should
 *     never happen in practice), the sponsor-credit is skipped to
 *     avoid double-paying the same wallet.
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

  // Fast-path: already credited for this member.
  if (newMembership.signupBonusCreditedAt) {
    return {
      skipped: "ALREADY_CREDITED",
      selfCredit: null,
      sponsorCredit: null,
    };
  }

  const cfg = await getSignupBonusConfig();
  if (!cfg.enabled) {
    return { skipped: "DISABLED", selfCredit: null, sponsorCredit: null };
  }
  if (cfg.selfAmount <= 0 && cfg.sponsorAmount <= 0) {
    return { skipped: "ZERO_AMOUNT", selfCredit: null, sponsorCredit: null };
  }

  const selfIdempotencyKey =
    `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(newCustomerId)}`;

  let selfCredit = null;
  if (cfg.selfAmount > 0) {
    selfCredit = await creditMemberSignupBonus({
      recipientUserId: newCustomerId,
      recipientMembership: newMembership,
      amount: cfg.selfAmount,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
      ledgerReference: selfIdempotencyKey,
      ledgerDescription: "MLM signup bonus (new member)",
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

  // Sponsor credit — skip silently when there's no sponsor or when
  // the new customer is somehow their own sponsor.
  let sponsorCredit = null;
  const sameAsSelf =
    sponsorUserId && String(sponsorUserId) === String(newCustomerId);
  if (cfg.sponsorAmount > 0 && sponsorUserId && !sameAsSelf) {
    const sponsorIdempotencyKey =
      `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${String(sponsorUserId)}-${String(newCustomerId)}`;
    // Look up the sponsor's membership for the commission-event row's
    // `recipientMembershipId` field. If the caller already has it
    // (`sponsorMembership`), reuse to save a roundtrip. Falling back
    // to `findOne` keeps the call site optional.
    let sponsorMemDoc = sponsorMembership || null;
    if (!sponsorMemDoc) {
      sponsorMemDoc = await MlmMembership.findOne({
        userId: sponsorUserId,
      }).session(session);
    }
    sponsorCredit = await creditMemberSignupBonus({
      recipientUserId: sponsorUserId,
      recipientMembership: sponsorMemDoc, // may be null — handled below
      amount: cfg.sponsorAmount,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR,
      ledgerReference: sponsorIdempotencyKey,
      ledgerDescription: "MLM signup bonus (referral acquisition)",
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

  // Flip the membership flag inside the same session so the next
  // re-entry short-circuits at the top of this function. Done last
  // so an error in the credit path leaves the flag null and the
  // signup transaction rolls back cleanly.
  newMembership.signupBonusCreditedAt = new Date();
  await newMembership.save({ session });

  return {
    skipped: null,
    selfCredit,
    sponsorCredit,
  };
}

/**
 * Internal helper — one wallet credit + matching commission event.
 *
 * Mirrors the wallet+ledger+event triplet that
 * `mlmBonusEngineService.creditBonusToEarningsWallet` writes for
 * commission credits, minus the daily-cap, lifetime-earnings,
 * plan-B-auto-upgrade and mentor-royalty cascades. Those don't apply
 * to a flat marketing acquisition credit.
 *
 * `recipientMembership` is optional — the commission event will
 * carry `recipientMembershipId: null` when the sponsor row could not
 * be located (e.g. orphan sponsor reference). The wallet credit still
 * fires because the recipient's `User._id` is enough to mint a Wallet
 * via `getOrCreateWallet`.
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
    bucket: "earnings",
    session,
    ledgerType,
    ledgerReference,
    ledgerDescription,
    metadata: meta,
    idempotencyKey,
    correlationId,
    // Shopping bucket is intentionally separate from the legacy
    // `User.walletBalance` mirror (which only ever tracked the
    // `available` bucket). Mirror would double-count here.
    syncUserWalletBalance: false,
  });

  const eventDoc = await MlmCommissionEvent.create(
    [
      {
        recipientId: recipientUserId,
        recipientMembershipId: recipientMembership?._id || null,
        sourceUserId,
        bonusType,
        // Signup is a Plan A surface event (Plan A is the universal
        // entry state for every member; Plan B is an upgrade). Tagged
        // here so admin filters / lifetime-earnings reporting groups
        // it under the same plan tier as the joining bonuses.
        planType: MLM_PLAN_TYPE.A,
        baseAmount: amount,
        bonusAmount: amount,
        cappedAmount: amount,
        rolloverAmount: 0,
        walletBucket: "earnings",
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
