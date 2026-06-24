import { describe, expect, test } from "@jest/globals";
import {
  countDirectReferralLegPairsFromLegMap,
  directReferralActivationFirstPairIdempotencyKey,
  directReferralPerActivationIdempotencyKey,
  shouldCreditFirstDirectReferralPair,
} from "../app/services/mlm/mlmSignupBonusService.js";

describe("mlm direct referral activation — first pair only", () => {
  test("directReferralActivationFirstPairIdempotencyKey is per sponsor", () => {
    expect(directReferralActivationFirstPairIdempotencyKey("abc")).toBe(
      "MLM-DRA-abc-FIRST-DIRECT-PAIR",
    );
  });

  test("countDirectReferralLegPairsFromLegMap — U refers A(L), B(R), C(L spill)", () => {
    const directs = [
      { _id: "a", userId: "ua" },
      { _id: "b", userId: "ub" },
      { _id: "c", userId: "uc" },
    ];
    const legMap = new Map([
      ["a", "L"],
      ["b", "R"],
      ["c", "L"],
    ]);
    expect(countDirectReferralLegPairsFromLegMap(directs, legMap)).toEqual({
      left: 2,
      right: 1,
      pairs: 1,
    });
  });

  test("shouldCreditFirstDirectReferralPair — only on 0 → 1 transition", () => {
    expect(
      shouldCreditFirstDirectReferralPair({ pairsBefore: 0, pairsAfter: 0 }),
    ).toBe(false);
    expect(
      shouldCreditFirstDirectReferralPair({ pairsBefore: 0, pairsAfter: 1 }),
    ).toBe(true);
    expect(
      shouldCreditFirstDirectReferralPair({ pairsBefore: 1, pairsAfter: 1 }),
    ).toBe(false);
    expect(
      shouldCreditFirstDirectReferralPair({ pairsBefore: 1, pairsAfter: 2 }),
    ).toBe(false);
  });

  test("directReferralPerActivationIdempotencyKey is per sponsor + referral", () => {
    expect(directReferralPerActivationIdempotencyKey("s1", "r1")).toBe(
      "MLM-DRPA-s1-r1",
    );
  });

  test("both flows on B activation: per-activation always; first-pair only at 0→1", () => {
  // A on L only
    expect(
      shouldCreditFirstDirectReferralPair({ pairsBefore: 0, pairsAfter: 0 }),
    ).toBe(false);
    // B completes first pair (L=1, R=1)
    expect(
      shouldCreditFirstDirectReferralPair({ pairsBefore: 0, pairsAfter: 1 }),
    ).toBe(true);
    // C adds second left — pair count stays 1
    expect(
      shouldCreditFirstDirectReferralPair({ pairsBefore: 1, pairsAfter: 1 }),
    ).toBe(false);
  });
});
