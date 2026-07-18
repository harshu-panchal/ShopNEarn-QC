import { normalizeFinanceSettings } from "../app/services/finance/financeSettingsService.js";

describe("normalizeFinanceSettings freeDeliveryThreshold", () => {
  it("defaults missing threshold to 0", () => {
    expect(normalizeFinanceSettings({}).freeDeliveryThreshold).toBe(0);
  });

  it("clamps negative values to 0", () => {
    expect(
      normalizeFinanceSettings({ freeDeliveryThreshold: -10 }).freeDeliveryThreshold,
    ).toBe(0);
  });

  it("preserves a positive threshold", () => {
    expect(
      normalizeFinanceSettings({ freeDeliveryThreshold: 500 }).freeDeliveryThreshold,
    ).toBe(500);
  });
});
