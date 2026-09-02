import { describe, expect, test } from "@jest/globals";
import {
  calculateBinaryPairs,
  resolvePairIncomeConfig,
  resolveFirstDirectPairIncomeAmount,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { MLM_DEFAULTS } from "../app/constants/mlm.js";

describe("mlmBinaryPairIncomeService (client PHP spec)", () => {
  test("calculateBinaryPairs applies 2:1/1:2 to every pair, left=15 right=10", () => {
    const result = calculateBinaryPairs(15, 10);
    expect(result.pairs).toBe(8);
    expect(result.leftBalance).toBe(0);
    expect(result.rightBalance).toBe(1);
  });

  test("every pair requires a 2:1 or 1:2 ratio (not plain 1:1)", () => {
    expect(calculateBinaryPairs(1, 1)).toEqual({
      pairs: 0,
      leftBalance: 1,
      rightBalance: 1,
    });
    expect(calculateBinaryPairs(2, 1)).toEqual({
      pairs: 1,
      leftBalance: 0,
      rightBalance: 0,
    });
    expect(calculateBinaryPairs(1, 2)).toEqual({
      pairs: 1,
      leftBalance: 0,
      rightBalance: 0,
    });
    // A completed pair never leaves the team "1:1 even" — every pair,
    // not just the first, must cost 2 from one leg + 1 from the other.
    expect(calculateBinaryPairs(2, 2)).toEqual({
      pairs: 1,
      leftBalance: 0,
      rightBalance: 1,
    });
    expect(calculateBinaryPairs(3, 3)).toEqual({
      pairs: 2,
      leftBalance: 0,
      rightBalance: 0,
    });
    // 13:13 -> 8 pairs (1 stranded on each leg): the exact case that
    // surfaced this fix.
    expect(calculateBinaryPairs(13, 13)).toEqual({
      pairs: 8,
      leftBalance: 1,
      rightBalance: 1,
    });
    // A single unit on one leg can only ever anchor ONE pair, no
    // matter how large the other leg is.
    expect(calculateBinaryPairs(100, 1)).toEqual({
      pairs: 1,
      leftBalance: 98,
      rightBalance: 0,
    });
  });

  test("resolvePairIncomeConfig tier table", () => {
    expect(resolvePairIncomeConfig(MLM_DEFAULTS, 2, false)).toEqual({
      pairIncome: 200,
      dailyPairCap: 10,
    });
    expect(resolvePairIncomeConfig(MLM_DEFAULTS, 5, false)).toEqual({
      pairIncome: 300,
      dailyPairCap: 10,
    });
    expect(resolvePairIncomeConfig(MLM_DEFAULTS, 7, false)).toEqual({
      pairIncome: 400,
      dailyPairCap: 10,
    });
    expect(resolvePairIncomeConfig(MLM_DEFAULTS, 1, false)).toEqual({
      pairIncome: 0,
      dailyPairCap: 0,
    });
  });

  test("resolvePairIncomeConfig topup override", () => {
    expect(resolvePairIncomeConfig(MLM_DEFAULTS, 2, true)).toEqual({
      pairIncome: 550,
      dailyPairCap: 20,
    });
  });

  test("resolveFirstDirectPairIncomeAmount uses fixed first-pair slabs", () => {
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 2, false, 200)).toBe(
      200,
    );
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 3, false, 200)).toBe(
      250,
    );
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 5, false, 200)).toBe(
      250,
    );
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 7, false, 200)).toBe(
      250,
    );
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 1, false, 175)).toBe(
      175,
    );
  });

  test("income for left=15 right=10 at 5 directs: 8 pairs × ₹300", () => {
    const { pairs } = calculateBinaryPairs(15, 10);
    const { pairIncome, dailyPairCap } = resolvePairIncomeConfig(MLM_DEFAULTS, 5, false);
    const capped = Math.min(pairs, dailyPairCap);
    expect(capped * pairIncome).toBe(2400);
  });
});
