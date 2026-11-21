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

describe("normalizeFinanceSettings minimumOrderValue", () => {
  it("defaults missing minimum order value to 0", () => {
    expect(normalizeFinanceSettings({}).minimumOrderValue).toBe(0);
  });

  it("clamps negative minimum order values to 0", () => {
    expect(
      normalizeFinanceSettings({ minimumOrderValue: -10 }).minimumOrderValue,
    ).toBe(0);
  });

  it("preserves a positive minimum order value", () => {
    expect(
      normalizeFinanceSettings({ minimumOrderValue: 500 }).minimumOrderValue,
    ).toBe(500);
  });
});
