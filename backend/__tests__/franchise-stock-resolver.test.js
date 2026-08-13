import { describe, expect, it, jest } from "@jest/globals";

// Mock Mongoose Models for FranchisePartner and FranchiseStockLedger
const mockPartnerFind = jest.fn();
const mockLedgerFind = jest.fn();

jest.unstable_mockModule("../app/models/franchisePartner.js", () => ({
  default: {
    find: mockPartnerFind,
  },
}));

jest.unstable_mockModule("../app/models/franchiseStockLedger.js", () => ({
  default: {
    find: mockLedgerFind,
  },
}));

const { resolveCatalogStockForProducts, findTop5NearestFranchisePartners } =
  await import("../app/services/franchise/franchiseStockResolver.js");

describe("franchiseStockResolver", () => {
  it("finds top 5 nearest franchise partners via location and fallback queries", async () => {
    const fakePartners = [
      { _id: "fp-1", name: "Partner 1" },
      { _id: "fp-2", name: "Partner 2" },
      { _id: "fp-3", name: "Partner 3" },
      { _id: "fp-4", name: "Partner 4" },
      { _id: "fp-5", name: "Partner 5" },
    ];

    mockPartnerFind.mockReturnValueOnce({
      limit: () => ({
        lean: async () => fakePartners,
      }),
    });

    const result = await findTop5NearestFranchisePartners({ lat: 19.07, lng: 72.87 });
    expect(result).toHaveLength(5);
    expect(result[0]._id).toBe("fp-1");
  });

  it("sums stock from 5 nearest franchise partners for master products and variants", async () => {
    const fakePartners = [{ _id: "fp-1" }, { _id: "fp-2" }];

    mockPartnerFind.mockReturnValueOnce({
      limit: () => ({
        lean: async () => fakePartners,
      }),
    });

    const fakeLedgers = [
      { franchisePartnerId: "fp-1", productId: "prod-1", variantSku: "VAR-RED", quantity: 5 },
      { franchisePartnerId: "fp-2", productId: "prod-1", variantSku: "VAR-RED", quantity: 10 },
      { franchisePartnerId: "fp-1", productId: "prod-1", variantSku: "VAR-BLUE", quantity: 3 },
      { franchisePartnerId: "fp-2", productId: "prod-1", variantSku: "VAR-BLUE", quantity: 2 },
    ];

    mockLedgerFind.mockReturnValueOnce({
      lean: async () => fakeLedgers,
    });

    const products = [
      {
        _id: "prod-1",
        name: "Test Shirt",
        stock: 0, // Hub stock was 0
        variants: [
          { sku: "VAR-RED", name: "Red", stock: 0 },
          { sku: "VAR-BLUE", name: "Blue", stock: 0 },
        ],
      },
    ];

    await resolveCatalogStockForProducts(products, { lat: 19.07, lng: 72.87 });

    // VAR-RED = 5 + 10 = 15
    // VAR-BLUE = 3 + 2 = 5
    // Total product stock = 15 + 5 = 20
    expect(products[0].variants[0].stock).toBe(15);
    expect(products[0].variants[1].stock).toBe(5);
    expect(products[0].stock).toBe(20);
  });

  it("falls back to Hub product stock when no franchise ledger exists", async () => {
    const fakePartners = [{ _id: "fp-1" }];

    mockPartnerFind.mockReturnValueOnce({
      limit: () => ({
        lean: async () => fakePartners,
      }),
    });

    // No ledger entries found
    mockLedgerFind.mockReturnValueOnce({
      lean: async () => [],
    });

    const products = [
      {
        _id: "prod-hub-only",
        name: "Hub Item",
        stock: 50,
        variants: [{ sku: "SKU-HUB", stock: 50 }],
      },
    ];

    await resolveCatalogStockForProducts(products, { lat: 19.07, lng: 72.87 });

    // Should preserve Hub stock
    expect(products[0].stock).toBe(50);
    expect(products[0].variants[0].stock).toBe(50);
  });
});
