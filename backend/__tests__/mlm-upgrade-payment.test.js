import { describe, expect, test } from "@jest/globals";
import { MLM_DEFAULTS, MLM_MEMBERSHIP_STATUS, MLM_PLAN_TYPE } from "../app/constants/mlm.js";
import { __internals } from "../app/services/mlm/mlmUpgradePaymentService.js";

const { computeUpgradeEligibility, resolveUpgradeAmounts } = __internals;

describe("mlmUpgradePaymentService", () => {
  test("resolveUpgradeAmounts reads binaryTopupPairIncome config", () => {
    const amounts = resolveUpgradeAmounts(MLM_DEFAULTS);
    expect(amounts.payAmount).toBe(5900);
    expect(amounts.shoppingCredit).toBe(10000);
  });

  test("computeUpgradeEligibility false below threshold on Plan A", () => {
    const membership = {
      planType: MLM_PLAN_TYPE.A,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      lifetimePlanAEarnings: 25000,
    };
    const result = computeUpgradeEligibility(membership, MLM_DEFAULTS, {
      earningsBalance: 10000,
    });
    expect(result.upgradeEligible).toBe(false);
    expect(result.canPayViaWallet).toBe(false);
  });

  test("computeUpgradeEligibility true at threshold with wallet option", () => {
    const membership = {
      planType: MLM_PLAN_TYPE.A,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      lifetimePlanAEarnings: 30000,
    };
    const result = computeUpgradeEligibility(membership, MLM_DEFAULTS, {
      earningsBalance: 6000,
    });
    expect(result.upgradeEligible).toBe(true);
    expect(result.upgradePayAmount).toBe(5900);
    expect(result.canPayViaWallet).toBe(true);
  });

  test("computeUpgradeEligibility blocks wallet when balance insufficient", () => {
    const membership = {
      planType: MLM_PLAN_TYPE.A,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      lifetimePlanAEarnings: 35000,
    };
    const result = computeUpgradeEligibility(membership, MLM_DEFAULTS, {
      earningsBalance: 1000,
    });
    expect(result.upgradeEligible).toBe(true);
    expect(result.canPayViaWallet).toBe(false);
  });

  test("computeUpgradeEligibility false for Plan B members", () => {
    const membership = {
      planType: MLM_PLAN_TYPE.B,
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      lifetimePlanAEarnings: 50000,
    };
    const result = computeUpgradeEligibility(membership, MLM_DEFAULTS, {
      earningsBalance: 20000,
    });
    expect(result.upgradeEligible).toBe(false);
  });
});
