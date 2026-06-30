import { describe, expect, test } from "@jest/globals";
import {
  calculateBinaryPairs,
  resolvePairIncomeConfig,
  resolveFirstDirectPairIncomeAmount,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { MLM_DEFAULTS } from "../app/constants/mlm.js";

describe("mlmBinaryPairIncomeService (client PHP spec)", () => {
  test("calculateBinaryPairs matches PHP example left=15 right=10", () => {
    const result = calculateBinaryPairs(15, 10);
    expect(result.pairs).toBe(10);
    expect(result.leftBalance).toBe(4);
    expect(result.rightBalance).toBe(0);
  });

  test("first pair requires 2:1 or 1:2 opener (not plain 1:1)", () => {
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

  test("resolveFirstDirectPairIncomeAmount follows pair tiers", () => {
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 2, false, 200)).toBe(
      200,
    );
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 3, false, 200)).toBe(
      250,
    );
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 5, false, 200)).toBe(
      300,
    );
    expect(resolveFirstDirectPairIncomeAmount(MLM_DEFAULTS, 1, false, 175)).toBe(
      175,
    );
  });

  test("PHP example income: 10 pairs × ₹300 at 5 directs", () => {
    const { pairs } = calculateBinaryPairs(15, 10);
    const { pairIncome, dailyPairCap } = resolvePairIncomeConfig(MLM_DEFAULTS, 5, false);
    const capped = Math.min(pairs, dailyPairCap);
    expect(capped * pairIncome).toBe(3000);
  });
});
