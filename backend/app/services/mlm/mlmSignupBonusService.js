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
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { creditWallet, debitWallet } from "../finance/walletService.js";
import { getSignupBonusConfig, getDirectReferralActivationConfig } from "./mlmConfigService.js";
import { recordLifetimeEarning } from "./mlmMembershipService.js";
import { roundCurrency } from "../../utils/money.js";

/**
 * Signup bonus credits for the MLM program.
 *
 * Rule (Jun 2026): when the direct sponsor is still REGISTERED_UNPAID,
 * neither the sponsor nor the new referral receives the signup bonus in
 * wallet/history. Both amounts are held until the sponsor activates.
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

async function emitHeldSignupBonusEvent({
  recipientUserId,
  recipientMembershipId,
  sourceUserId,
  bonusType,
  amount,
  idempotencyKey,
  correlationId,
  unpaidSponsorUserId,
  referralUserId,
  session,
}) {
  const existing = await MlmCommissionEvent.findOne(
    { idempotencyKey },
    null,
    session ? { session } : {},
  );
  if (existing) return existing;

  const description =
    bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
      ? "MLM signup bonus — referral acquired (held until sponsor activates)"
      : "MLM signup bonus — welcome credit (held until sponsor activates)";

  const [eventDoc] = await MlmCommissionEvent.create(
    [
      {
        recipientId: recipientUserId,
        recipientMembershipId: recipientMembershipId || null,
        sourceUserId: sourceUserId || null,
        bonusType,
        planType: MLM_PLAN_TYPE.A,
        baseAmount: amount,
        bonusAmount: amount,
        cappedAmount: 0,
        rolloverAmount: 0,
        walletBucket: "shopping",
        ledgerEntryId: null,
        status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
        idempotencyKey,
        correlationId,
        description,
        meta: {
          unpaidSponsorUserId: String(unpaidSponsorUserId),
          heldReferralUserId: String(referralUserId),
          mlmEvent:
            bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
              ? "SIGNUP_BONUS_SPONSOR_HELD"
              : "SIGNUP_BONUS_SELF_HELD",
        },
      },
    ],
    session ? { session } : {},
  );

  return eventDoc;
}

/**
 * Credit signup bonuses when a new customer registers with a referral code.
 * Defers both sponsor and self credits when the sponsor is unpaid.
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

  let sponsorMemDoc = sponsorMembership || null;
  if (!sponsorMemDoc && sponsorUserId) {
    sponsorMemDoc = await MlmMembership.findOne({ userId: sponsorUserId }).session(
      session,
    );
  }

  const sponsorUnpaid =
    sponsorMemDoc?.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID;
  const sameAsSelf =
    sponsorUserId && String(sponsorUserId) === String(newCustomerId);

  if (sponsorUnpaid && sponsorUserId && !sameAsSelf) {
    if (cfg.selfAmount > 0) {
      await emitHeldSignupBonusEvent({
        recipientUserId: newCustomerId,
        recipientMembershipId: newMembership._id,
        sourceUserId: sponsorUserId,
        bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
        amount: cfg.selfAmount,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(newCustomerId)}`,
        correlationId,
        unpaidSponsorUserId: sponsorUserId,
        referralUserId: newCustomerId,
        session,
      });
    }
    if (cfg.sponsorAmount > 0) {
      await emitHeldSignupBonusEvent({
        recipientUserId: sponsorUserId,
        recipientMembershipId: sponsorMemDoc?._id || null,
        sourceUserId: newCustomerId,
        bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
        amount: cfg.sponsorAmount,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${String(sponsorUserId)}-${String(newCustomerId)}`,
        correlationId,
        unpaidSponsorUserId: sponsorUserId,
        referralUserId: newCustomerId,
        session,
      });
    }
    return {
      skipped: "HELD_UNTIL_SPONSOR_ACTIVATION",
      selfCredit: null,
      sponsorCredit: null,
    };
  }

  let selfCredit = null;
  if (cfg.selfAmount > 0) {
    const selfIdempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(newCustomerId)}`;
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

  let sponsorCredit = null;
  if (cfg.sponsorAmount > 0 && sponsorUserId && !sameAsSelf) {
    const sponsorIdempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${String(sponsorUserId)}-${String(newCustomerId)}`;
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

  newMembership.signupBonusCreditedAt = new Date();
  await newMembership.save({ session });

  return {
    skipped: null,
    selfCredit,
    sponsorCredit,
  };
}

/**
 * One-time earnings credit to the direct sponsor when a referral
 * activates Plan A. Idempotent per (sponsor, activated referral).
 */
export async function applyDirectReferralActivationBonusInSession({
  activatedUserId,
  activatedMembership,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "applyDirectReferralActivationBonusInSession requires an open mongoose session.",
    );
  }
  if (!activatedUserId || !activatedMembership?.sponsorId) {
    return { skipped: "NO_SPONSOR", event: null };
  }

  const sponsorUserId = activatedMembership.sponsorId;
  if (String(sponsorUserId) === String(activatedUserId)) {
    return { skipped: "SELF_REFERRAL", event: null };
  }

  const cfg = await getDirectReferralActivationConfig();
  if (!cfg.enabled || cfg.sponsorAmount <= 0) {
    return { skipped: "DISABLED", event: null };
  }

  const idempotencyKey = `${MLM_IDEMPOTENCY_PREFIX.DIRECT_REFERRAL_ACTIVATION}-${String(sponsorUserId)}-${String(activatedUserId)}`;
  const existing = await MlmCommissionEvent.findOne(
    { idempotencyKey },
    null,
    { session },
  );
  if (existing) {
    return { skipped: "ALREADY_CREDITED", event: existing };
  }

  const sponsorMembership = await MlmMembership.findOne({
    userId: sponsorUserId,
  }).session(session);
  if (!sponsorMembership) {
    return { skipped: "SPONSOR_NOT_FOUND", event: null };
  }
  if (
    sponsorMembership.status === MLM_MEMBERSHIP_STATUS.SUSPENDED ||
    sponsorMembership.status === MLM_MEMBERSHIP_STATUS.TERMINATED
  ) {
    return { skipped: "SPONSOR_INELIGIBLE", event: null };
  }

  const amount = roundCurrency(cfg.sponsorAmount);
  const creditResult = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: sponsorUserId,
    amount,
    bucket: "earnings",
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_ACTIVATION,
    ledgerReference: idempotencyKey,
    ledgerDescription: "Direct referral activation income",
    metadata: {
      mlmEvent: "DIRECT_REFERRAL_ACTIVATION",
      activatedUserId: String(activatedUserId),
      sponsorUserId: String(sponsorUserId),
    },
    idempotencyKey,
    correlationId,
    syncUserWalletBalance: false,
  });

  const [eventDoc] = await MlmCommissionEvent.create(
    [
      {
        recipientId: sponsorUserId,
        recipientMembershipId: sponsorMembership._id,
        sourceUserId: activatedUserId,
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
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
        description: "Direct referral activation income",
        meta: {
          mlmEvent: "DIRECT_REFERRAL_ACTIVATION",
          activatedUserId: String(activatedUserId),
        },
      },
    ],
    { session },
  );

  await recordLifetimeEarning({
    userId: sponsorUserId,
    amount,
    planType: MLM_PLAN_TYPE.A,
    session,
  });

  return { skipped: null, event: eventDoc, amount };
}

/**
 * Release signup bonuses held while this member was REGISTERED_UNPAID.
 * Called when the sponsor activates Plan A (paid or admin approval).
 */
export async function releaseHeldSignupBonusesForSponsorActivation({
  sponsorUserId,
  session,
  correlationId = null,
}) {
  if (!session) {
    throw new Error(
      "releaseHeldSignupBonusesForSponsorActivation requires an open mongoose session.",
    );
  }
  if (!sponsorUserId) return [];

  const heldEvents = await MlmCommissionEvent.find({
    status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
    "meta.unpaidSponsorUserId": String(sponsorUserId),
  }).session(session);

  if (!heldEvents.length) return [];

  const released = [];
  for (const event of heldEvents) {
    const recipientMembership = event.recipientMembershipId
      ? await MlmMembership.findById(event.recipientMembershipId).session(session)
      : await MlmMembership.findOne({ userId: event.recipientId }).session(session);

    const ledgerType =
      event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
        ? LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR
        : LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF;

    const creditResult = await creditWallet({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: event.recipientId,
      amount: event.bonusAmount,
      bucket: "shopping",
      session,
      ledgerType,
      ledgerReference: event.idempotencyKey,
      ledgerDescription:
        event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
          ? "MLM signup bonus — referral acquired"
          : "MLM signup bonus — welcome credit",
      metadata: {
        ...(event.meta || {}),
        releasedOnSponsorActivation: String(sponsorUserId),
      },
      idempotencyKey: event.idempotencyKey,
      correlationId,
      syncUserWalletBalance: false,
    });

    event.status = MLM_COMMISSION_EVENT_STATUS.CREDITED;
    event.cappedAmount = event.bonusAmount;
    event.ledgerEntryId = creditResult?.ledgerEntry?._id || null;
    event.releasedAt = new Date();
    event.description =
      event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR
        ? "MLM signup bonus — referral acquired"
        : "MLM signup bonus — welcome credit";
    await event.save({ session });

    if (
      event.bonusType === MLM_BONUS_TYPE.SIGNUP_BONUS_SELF &&
      recipientMembership &&
      !recipientMembership.signupBonusCreditedAt
    ) {
      recipientMembership.signupBonusCreditedAt = new Date();
      await recipientMembership.save({ session });
    }

    released.push({
      eventId: event._id,
      bonusType: event.bonusType,
      recipientId: event.recipientId,
      amount: event.bonusAmount,
    });
  }

  return released;
}

/**
 * Claw back signup bonuses that were incorrectly credited while the
 * sponsor was still unpaid, and re-create HELD commission events.
 */
export async function reclawSignupBonusesForUnpaidSponsor({
  referralUserId,
  referralMembership,
  sponsorUserId,
  sponsorMembership,
  session,
  correlationId = null,
}) {
  const cfg = await getSignupBonusConfig();
  if (!cfg.enabled) return { clawed: 0 };

  let clawed = 0;
  const referralId = String(referralUserId);
  const sponsorId = String(sponsorUserId);

  const pairs = [
    {
      idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${referralId}`,
      recipientUserId: referralUserId,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
      amount: cfg.selfAmount,
      recipientMembershipId: referralMembership?._id,
      sourceUserId: sponsorUserId,
    },
    {
      idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${sponsorId}-${referralId}`,
      recipientUserId: sponsorUserId,
      bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
      amount: cfg.sponsorAmount,
      recipientMembershipId: sponsorMembership?._id,
      sourceUserId: referralUserId,
    },
  ];

  for (const row of pairs) {
    if (row.amount <= 0) continue;

    const credited = await MlmCommissionEvent.findOne({
      idempotencyKey: row.idempotencyKey,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    }).session(session);

    if (credited?.ledgerEntryId) {
      await debitWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: row.recipientUserId,
        amount: credited.cappedAmount || credited.bonusAmount || row.amount,
        bucket: "shopping",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
        ledgerReference: `${row.idempotencyKey}-CLAW`,
        ledgerDescription:
          "Signup bonus reversed — sponsor was unpaid at referral time",
        idempotencyKey: `${row.idempotencyKey}-CLAW`,
        correlationId,
        syncUserWalletBalance: false,
      });
      credited.status = MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK;
      credited.clawbackAt = new Date();
      credited.clawbackAmount = credited.cappedAmount || credited.bonusAmount;
      await credited.save({ session });
      clawed += 1;
    }

    const held = await MlmCommissionEvent.findOne({
      idempotencyKey: row.idempotencyKey,
      status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_SPONSOR_ACTIVATION,
    }).session(session);

    if (!held) {
      await emitHeldSignupBonusEvent({
        recipientUserId: row.recipientUserId,
        recipientMembershipId: row.recipientMembershipId,
        sourceUserId: row.sourceUserId,
        bonusType: row.bonusType,
        amount: row.amount,
        idempotencyKey: row.idempotencyKey,
        correlationId,
        unpaidSponsorUserId: sponsorUserId,
        referralUserId: referralUserId,
        session,
      });
    }
  }

  if (referralMembership?.signupBonusCreditedAt) {
    referralMembership.signupBonusCreditedAt = null;
    await referralMembership.save({ session });
  }

  return { clawed };
}

/** @deprecated Self bonus at activation is unused; kept for API compat. */
export async function applySelfSignupBonusAtActivation({
  newCustomerId,
  newMembership,
  session,
  correlationId = null,
}) {
  if (newMembership.signupBonusCreditedAt) {
    return { skipped: "ALREADY_CREDITED", selfCredit: null };
  }
  return { skipped: "DEFERRED_TO_REGISTRATION_OR_SPONSOR_RELEASE", selfCredit: null };
}

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

export async function applyDirectReferralActivationBonusStandalone({
  activatedUserId,
  activatedMembership,
  correlationId = null,
}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await applyDirectReferralActivationBonusInSession({
        activatedUserId,
        activatedMembership,
        session,
        correlationId,
      });
    });
  } finally {
    await session.endSession();
  }
  return result;
}
