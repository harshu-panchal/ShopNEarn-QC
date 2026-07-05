import { describe, it, expect } from "@jest/globals";
import {
  isFranchiseRegMerchantOrderId,
  isFranchiseTopupMerchantOrderId,
} from "../app/services/franchise/franchiseRegistrationPaymentService.js";
import { buildFranchiseOrderFields, franchiseSelfRoutingError } from "../app/services/franchise/franchiseOrderRoutingService.js";
import { parseFranchiseRegistrationAddress, extractPincodeFromAddress } from "../app/services/franchise/franchiseAddressUtils.js";
import { FRANCHISE_ORDER_STATUS } from "../app/constants/franchise.js";
import { NOTIFICATION_EVENTS } from "../app/modules/notifications/notification.constants.js";
import { buildNotification } from "../app/modules/notifications/notification.builder.js";

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

  it("extracts pincode embedded in city text", () => {
    expect(
      extractPincodeFromAddress({ city: "Indore - 452018" }),
    ).toBe("452018");
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

describe("franchise order routed notification", () => {
  it("builds a customer notification for the franchise partner", () => {
    const rows = buildNotification(NOTIFICATION_EVENTS.FRANCHISE_ORDER_ROUTED, {
      userId: "507f1f77bcf86cd799439011",
      orderId: "ORD-12345",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("customer");
    expect(rows[0].userId).toBe("507f1f77bcf86cd799439011");
    expect(rows[0].title).toMatch(/New Customer Order/i);
    expect(rows[0].body).toContain("ORD-12345");
    expect(rows[0].data.link).toContain("/mlm/franchise/orders");
  });
});

describe("franchise self-routing guard", () => {
  it("returns a 422 error when a partner would be routed to themselves", () => {
    const err = franchiseSelfRoutingError();
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("FRANCHISE_SELF_ROUTING_BLOCKED");
    expect(err.message).toMatch(/cannot place a customer order to yourself/i);
  });
});
