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

  test("countDirectReferralLegPairsFromLegMap — bare 1 Left + 1 Right is NOT a completed pair", () => {
    // Opening pair requires 2:1 or 1:2 (client PHP spec), same rule
    // `calculateBinaryPairs` enforces for the team-wide BINARY_PAIR_MATCH
    // engine. A naive Math.min(1, 1) previously paid this out as 1 pair.
    const directs = [
      { _id: "a", userId: "ua" },
      { _id: "b", userId: "ub" },
    ];
    const legMap = new Map([
      ["a", "L"],
      ["b", "R"],
    ]);
    expect(countDirectReferralLegPairsFromLegMap(directs, legMap)).toEqual({
      left: 1,
      right: 1,
      pairs: 0,
    });
  });

  test("countDirectReferralLegPairsFromLegMap — 1 Left + 2 Right completes the opening pair (mirror of 2:1)", () => {
    const directs = [
      { _id: "a", userId: "ua" },
      { _id: "b", userId: "ub" },
      { _id: "c", userId: "uc" },
    ];
    const legMap = new Map([
      ["a", "L"],
      ["b", "R"],
      ["c", "R"],
    ]);
    expect(countDirectReferralLegPairsFromLegMap(directs, legMap)).toEqual({
      left: 1,
      right: 2,
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
