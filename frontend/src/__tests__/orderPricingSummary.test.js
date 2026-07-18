import { describe, expect, it } from "@jest/globals";
import { normalizeOrderPricing } from "../shared/utils/orderPricingSummary.js";
import {
  buildInvoiceFilename,
  normalizeInvoiceOrder,
} from "../shared/utils/invoiceOrderAdapter.js";
import {
  buildAddressForOrder,
  canProceedWithCheckoutAddress,
  isCheckoutAddressComplete,
  isRecipientComplete,
  normalizeProfileAddress,
  profileAddressToCheckoutAddress,
} from "../modules/customer/utils/checkoutAddress.js";

describe("normalizeOrderPricing", () => {
  it("prefers paymentBreakdown over fabricated totals", () => {
    const pricing = normalizeOrderPricing({
      paymentBreakdown: {
        productSubtotal: 600,
        deliveryFeeCharged: 0,
        handlingFeeCharged: 20,
        grandTotal: 620,
      },
      pricing: { subtotal: 610, deliveryFee: 10, total: 620 },
      total: 620,
    });

    expect(pricing.productSubtotal).toBe(600);
    expect(pricing.deliveryFee).toBe(0);
    expect(pricing.handlingFee).toBe(20);
    expect(pricing.grandTotal).toBe(620);
  });

  it("falls back to legacy pricing fields", () => {
    const pricing = normalizeOrderPricing({
      pricing: { subtotal: 500, deliveryFee: 30, platformFee: 10, total: 540 },
    });
    expect(pricing.productSubtotal).toBe(500);
    expect(pricing.deliveryFee).toBe(30);
    expect(pricing.handlingFee).toBe(10);
    expect(pricing.grandTotal).toBe(540);
  });
});

describe("normalizeInvoiceOrder", () => {
  it("maps live API payload fields", () => {
    const invoice = normalizeInvoiceOrder({
      orderId: "AZ-100",
      createdAt: "2026-01-01T00:00:00.000Z",
      address: { name: "Asha", phone: "9999999999", address: "Street 1", city: "Indore" },
      items: [{ name: "Milk", quantity: 2, price: 30 }],
      pricing: { subtotal: 60, deliveryFee: 0, gst: 0, total: 60 },
      paymentMode: "COD",
    });

    expect(invoice.orderId).toBe("AZ-100");
    expect(invoice.items[0].quantity).toBe(2);
    expect(invoice.pricing.productSubtotal).toBe(60);
    expect(invoice.hasLineItems).toBe(true);
    expect(buildInvoiceFilename(invoice.orderId)).toBe("Invoice_AZ-100.pdf");
  });

  it("marks group summaries without line items", () => {
    const invoice = normalizeInvoiceOrder({
      orderId: "GROUP-1",
      isGroupSummary: true,
      items: [],
      pricing: { total: 100 },
    });
    expect(invoice.hasLineItems).toBe(false);
  });
});

describe("checkoutAddress helpers", () => {
  it("hydrates profile addresses with name/phone", () => {
    const saved = normalizeProfileAddress(
      { name: "Riya", phone: "9876543210" },
      {
        _id: "a1",
        label: "home",
        fullAddress: "12 MG Road",
        city: "Indore",
        state: "MP",
        pincode: "452001",
        location: { lat: 22.7, lng: 75.9 },
      },
      0,
    );
    expect(saved.name).toBe("Riya");
    expect(saved.phone).toBe("9876543210");
    expect(saved.location).toEqual({ lat: 22.7, lng: 75.9 });

    const checkout = profileAddressToCheckoutAddress(saved, {
      name: "Riya",
      phone: "9876543210",
    });
    expect(isCheckoutAddressComplete(checkout)).toBe(true);
  });

  it("blocks checkout without a complete address", () => {
    expect(
      canProceedWithCheckoutAddress({
        currentAddress: { name: "X", address: "Y", phone: "123" },
        savedRecipient: null,
      }),
    ).toBe(false);
  });

  it("never borrows currentLocation for recipient addresses", () => {
    const recipient = {
      name: "Guest",
      phone: "9999999999",
      completeAddress: "Other Street",
      location: { lat: 23.1, lng: 76.1 },
    };
    expect(isRecipientComplete(recipient)).toBe(true);

    const payload = buildAddressForOrder({
      currentAddress: null,
      savedRecipient: recipient,
      currentLocation: { latitude: 22.7, longitude: 75.9 },
    });
    expect(payload.location).toEqual({ lat: 23.1, lng: 76.1 });
  });
});
