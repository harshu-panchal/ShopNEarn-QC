import { describe, it, expect } from "@jest/globals";
import {
  isFranchiseRegMerchantOrderId,
  isFranchiseTopupMerchantOrderId,
} from "../app/services/franchise/franchiseRegistrationPaymentService.js";
import { buildFranchiseOrderFields } from "../app/services/franchise/franchiseOrderRoutingService.js";
import { parseFranchiseRegistrationAddress } from "../app/services/franchise/franchiseAddressUtils.js";
import { FRANCHISE_ORDER_STATUS } from "../app/constants/franchise.js";

describe("franchise merchant order id detection", () => {
  it("detects franchise registration prefix", () => {
    expect(isFranchiseRegMerchantOrderId("FRANCHISE-REG-ABC-A1")).toBe(true);
    expect(isFranchiseRegMerchantOrderId("MLM-JOIN-ABC")).toBe(false);
  });

  it("detects franchise topup prefix", () => {
    expect(isFranchiseTopupMerchantOrderId("FRANCHISE-TOPUP-XYZ-A1")).toBe(true);
  });
});

describe("parseFranchiseRegistrationAddress", () => {
  it("requires complete address fields", () => {
    expect(() => parseFranchiseRegistrationAddress({ pincode: "380001" })).toThrow(
      "Complete franchise address is required",
    );
  });

  it("derives territory pincode from address pincode", () => {
    const result = parseFranchiseRegistrationAddress({
      address: "Shop 12, Main Road",
      locality: "Satellite",
      pincode: "380015",
      city: "Ahmedabad",
      state: "Gujarat",
      lat: 23.03,
      lng: 72.51,
    });
    expect(result.territoryPincodes).toEqual(["380015"]);
    expect(result.snapshot.city).toBe("Ahmedabad");
  });
});

describe("buildFranchiseOrderFields", () => {
  it("returns null fields when no partner", () => {
    expect(buildFranchiseOrderFields(null)).toEqual({
      franchisePartnerId: null,
      franchiseRoutedAt: null,
      franchiseStatus: null,
    });
  });

  it("tags pending franchise status when partner resolved", () => {
    const fields = buildFranchiseOrderFields({ _id: "507f1f77bcf86cd799439011" });
    expect(String(fields.franchisePartnerId)).toBe("507f1f77bcf86cd799439011");
    expect(fields.franchiseStatus).toBe(FRANCHISE_ORDER_STATUS.PENDING);
    expect(fields.franchiseRoutedAt).toBeInstanceOf(Date);
  });
});
