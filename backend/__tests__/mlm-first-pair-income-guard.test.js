import { describe, expect, test } from "@jest/globals";
import {
  binaryPairMatchIdempotencyKey,
  directReferralActivationFirstPairIdempotencyKey,
  isBinaryPairMatchIndexCommissionEvent,
  isDirectReferralFirstPairCommissionEvent,
} from "../app/services/mlm/mlmFirstPairIncomeGuard.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
} from "../app/constants/mlm.js";

describe("mlmFirstPairIncomeGuard", () => {
  const sponsorId = "6a2280b34931c0271e9eb53d";

  test("directReferralActivationFirstPairIdempotencyKey is per sponsor", () => {
    expect(directReferralActivationFirstPairIdempotencyKey(sponsorId)).toBe(
      `MLM-DRA-${sponsorId}-FIRST-DIRECT-PAIR`,
    );
  });

  test("isDirectReferralFirstPairCommissionEvent — canonical and restore rows", () => {
    expect(
      isDirectReferralFirstPairCommissionEvent({
        recipientId: sponsorId,
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey: directReferralActivationFirstPairIdempotencyKey(sponsorId),
      }),
    ).toBe(true);

    expect(
      isDirectReferralFirstPairCommissionEvent({
        recipientId: sponsorId,
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey: `MLM-DRA-RESTORE-RECALC-2026-${sponsorId}`,
        meta: { pairIndex: 1, restoreAfterRecalc: true },
      }),
    ).toBe(true);

    expect(
      isDirectReferralFirstPairCommissionEvent({
        recipientId: sponsorId,
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey: `MLM-DRA-${sponsorId}-6a2284434931c0271e9eba1e`,
      }),
    ).toBe(false);
  });

  test("isBinaryPairMatchIndexCommissionEvent — live and recalc keys", () => {
    expect(
      isBinaryPairMatchIndexCommissionEvent(
        {
          recipientId: sponsorId,
          bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          idempotencyKey: binaryPairMatchIdempotencyKey(sponsorId, 1),
        },
        1,
      ),
    ).toBe(true);

    expect(
      isBinaryPairMatchIndexCommissionEvent(
        {
          recipientId: sponsorId,
          bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          idempotencyKey: `MLM-EARN-RECALC-TREE-2026-PAIR-${sponsorId}-P1`,
        },
        1,
      ),
    ).toBe(true);

    expect(
      isBinaryPairMatchIndexCommissionEvent(
        {
          recipientId: sponsorId,
          bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
          status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
          idempotencyKey: binaryPairMatchIdempotencyKey(sponsorId, 2),
        },
        1,
      ),
    ).toBe(false);
  });
});
