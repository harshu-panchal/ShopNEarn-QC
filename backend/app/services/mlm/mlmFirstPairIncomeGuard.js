import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
} from "../../constants/mlm.js";

const LEGACY_PER_ACTIVATION_DRA_KEY_RE =
  /^MLM-DRA-[0-9a-f]{24}-[0-9a-f]{24}$/i;

/** Idempotency key — one credit per sponsor for the first direct pair. */
export function directReferralActivationFirstPairIdempotencyKey(sponsorUserId) {
  return `${MLM_IDEMPOTENCY_PREFIX.DIRECT_REFERRAL_ACTIVATION}-${String(sponsorUserId)}-FIRST-DIRECT-PAIR`;
}

export function binaryPairMatchIdempotencyKey(sponsorUserId, pairIndex) {
  return `${MLM_IDEMPOTENCY_PREFIX.BINARY_PAIR_MATCH}-${String(sponsorUserId)}-P${pairIndex}`;
}

function isLegacyPerActivationDirectReferralCredit({ bonusType, idempotencyKey }) {
  return (
    bonusType === MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION
    && LEGACY_PER_ACTIVATION_DRA_KEY_RE.test(String(idempotencyKey || ""))
  );
}

/** True when a credited commission row is the one-time first direct-pair income. */
export function isDirectReferralFirstPairCommissionEvent(event) {
  if (!event || event.bonusType !== MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION) {
    return false;
  }
  if (event.status !== MLM_COMMISSION_EVENT_STATUS.CREDITED) {
    return false;
  }
  if (
    isLegacyPerActivationDirectReferralCredit({
      bonusType: event.bonusType,
      idempotencyKey: event.idempotencyKey,
    })
  ) {
    return false;
  }

  const uid = String(event.recipientId || "");
  const key = String(event.idempotencyKey || "");
  if (key === directReferralActivationFirstPairIdempotencyKey(uid)) return true;
  if (key === `MLM-DRA-RESTORE-RECALC-2026-${uid}`) return true;
  if (event.meta?.incomeType === "FIRST_DIRECT_PAIR") return true;
  if (event.meta?.restoreAfterRecalc && Number(event.meta?.pairIndex) === 1) {
    return true;
  }
  return false;
}

/** True when a credited commission row is binary pair match at `pairIndex`. */
export function isBinaryPairMatchIndexCommissionEvent(event, pairIndex) {
  if (!event || event.bonusType !== MLM_BONUS_TYPE.BINARY_PAIR_MATCH) {
    return false;
  }
  if (event.status !== MLM_COMMISSION_EVENT_STATUS.CREDITED) {
    return false;
  }

  const uid = String(event.recipientId || "");
  const key = String(event.idempotencyKey || "");
  const index = Number(pairIndex);
  if (key === binaryPairMatchIdempotencyKey(uid, index)) return true;
  if (new RegExp(`-PAIR-${uid}-P${index}$`, "i").test(key)) return true;
  if (Number(event.meta?.pairIndex) === index) return true;
  return false;
}

export async function hasCreditedBinaryPairMatchIndex(
  sponsorUserId,
  pairIndex,
  { session } = {},
) {
  const uid = String(sponsorUserId);
  const index = Number(pairIndex);
  const row = await MlmCommissionEvent.findOne(
    {
      recipientId: sponsorUserId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      $or: [
        { idempotencyKey: binaryPairMatchIdempotencyKey(uid, index) },
        { idempotencyKey: new RegExp(`-PAIR-${uid}-P${index}$`, "i") },
        { "meta.pairIndex": index },
      ],
    },
    null,
    { session },
  );
  return Boolean(row);
}

export async function hasCreditedDirectReferralFirstPairIncome(
  sponsorUserId,
  { session } = {},
) {
  const uid = String(sponsorUserId);
  const row = await MlmCommissionEvent.findOne(
    {
      recipientId: sponsorUserId,
      bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      $or: [
        { idempotencyKey: directReferralActivationFirstPairIdempotencyKey(uid) },
        { idempotencyKey: `MLM-DRA-RESTORE-RECALC-2026-${uid}` },
        { "meta.incomeType": "FIRST_DIRECT_PAIR" },
        {
          "meta.restoreAfterRecalc": true,
          "meta.pairIndex": 1,
        },
      ],
    },
    null,
    { session },
  );
  if (!row) return false;
  return isDirectReferralFirstPairCommissionEvent(row);
}

/** Either binary pair #1 or one-time first direct-pair income already paid. */
export async function hasCreditedFirstPairMatchingIncome(
  sponsorUserId,
  { session } = {},
) {
  return (
    (await hasCreditedBinaryPairMatchIndex(sponsorUserId, 1, { session }))
    || (await hasCreditedDirectReferralFirstPairIncome(sponsorUserId, { session }))
  );
}
