import { describe, expect, it } from "@jest/globals";
import {
  HUB_STOCK_TYPES,
  FRANCHISE_STOCK_TYPES,
  hubDirectionForType,
  franchiseDirectionForType,
} from "../app/constants/inventory.js";

describe("inventory constants", () => {
  it("classifies hub transfer out as outgoing", () => {
    expect(hubDirectionForType(HUB_STOCK_TYPES.TRANSFER_OUT)).toBe("outgoing");
    expect(hubDirectionForType(HUB_STOCK_TYPES.RESTOCK)).toBe("incoming");
  });

  it("classifies franchise transfer in as incoming", () => {
    expect(franchiseDirectionForType(FRANCHISE_STOCK_TYPES.TRANSFER_IN)).toBe(
      "incoming",
    );
    expect(franchiseDirectionForType(FRANCHISE_STOCK_TYPES.FULFILLMENT)).toBe(
      "outgoing",
    );
  });
});

describe("StockHistory enum extension", () => {
  it("includes TransferOut and Damage", async () => {
    const mod = await import("../app/models/stockHistory.js");
    const schema = mod.default.schema.path("type");
    const values = schema.enumValues || schema.options?.enum;
    expect(values).toContain("TransferOut");
    expect(values).toContain("Damage");
  });
});

describe("FranchiseStockMovement model", () => {
  it("registers with mongoose", async () => {
    const mod = await import("../app/models/franchiseStockMovement.js");
    expect(mod.default.modelName).toBe("FranchiseStockMovement");
  });
});
