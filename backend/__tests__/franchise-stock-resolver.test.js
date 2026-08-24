import { describe, expect, it, jest } from "@jest/globals";

// Mock Mongoose Models for FranchisePartner, FranchiseStockLedger and Seller
const mockPartnerFind = jest.fn();
const mockLedgerFind = jest.fn();
const mockLedgerDistinct = jest.fn();
const mockSellerFindById = jest.fn();
const mockGetHubSellerId = jest.fn().mockResolvedValue(null);

jest.unstable_mockModule("../app/models/franchisePartner.js", () => ({
  default: {
    find: mockPartnerFind,
  },
}));

jest.unstable_mockModule("../app/models/franchiseStockLedger.js", () => ({
  default: {
    find: mockLedgerFind,
    distinct: mockLedgerDistinct,
  },
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: {
    findById: mockSellerFindById,
  },
}));

jest.unstable_mockModule(
  "../app/services/franchise/franchiseConfigService.js",
  () => ({ getHubSellerId: mockGetHubSellerId }),
);

const { resolveCatalogStockForProducts, findNearestFranchisePartner, resolveFranchiseCatalogScope } =
  await import("../app/services/franchise/franchiseStockResolver.js");

function sellerQueryChain(result) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  };
}

describe("franchiseStockResolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHubSellerId.mockResolvedValue(null);
    mockSellerFindById.mockReturnValue(sellerQueryChain(null));
  });

  it("finds the single nearest franchise partner via location", async () => {
    const fakePartners = [
      { _id: "fp-1", name: "Partner 1" },
      { _id: "fp-2", name: "Partner 2" },
    ];

    mockPartnerFind.mockReturnValueOnce({
      limit: () => ({
        lean: async () => fakePartners,
      }),
    });

    const result = await findNearestFranchisePartner({ lat: 19.07, lng: 72.87 });
    expect(result._id).toBe("fp-1");
  });

  it("reads stock from ONLY the nearest franchise partner for master products and variants", async () => {
    const fakePartners = [{ _id: "fp-1" }];

    mockPartnerFind.mockReturnValueOnce({
      limit: () => ({
        lean: async () => fakePartners,
      }),
    });

    const fakeLedgers = [
      { franchisePartnerId: "fp-1", productId: "prod-1", variantSku: "VAR-RED", quantity: 5 },
      { franchisePartnerId: "fp-1", productId: "prod-1", variantSku: "VAR-BLUE", quantity: 3 },
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

    expect(products[0].variants[0].stock).toBe(5);
    expect(products[0].variants[1].stock).toBe(3);
    expect(products[0].stock).toBe(8);
  });

  it("treats a product the resolved franchise never stocked as unavailable (0), not the Hub's number", async () => {
    const fakePartners = [{ _id: "fp-1" }];

    mockPartnerFind.mockReturnValueOnce({
      limit: () => ({
        lean: async () => fakePartners,
      }),
    });

    // No ledger entries found for this product at this franchise
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

    // The franchise never carried it -> unavailable here, not Hub's stock.
    expect(products[0].stock).toBe(0);
    expect(products[0].variants[0].stock).toBe(0);
  });

  it("shows the hub's own stock (not the franchise's) when the hub is geographically closer", async () => {
    // Franchise ~380km away (Ahmedabad); customer & hub are essentially co-located.
    const farFranchise = {
      _id: "fp-far",
      location: { type: "Point", coordinates: [72.5714, 23.0225] },
    };
    mockPartnerFind.mockReturnValueOnce({
      limit: () => ({
        lean: async () => [farFranchise],
      }),
    });
    mockGetHubSellerId.mockResolvedValue("hub-seller-id");
    mockSellerFindById.mockReturnValue(
      sellerQueryChain({ location: { type: "Point", coordinates: [75.858, 22.72] } }),
    );

    const products = [
      {
        _id: "prod-1",
        name: "Test Shirt",
        stock: 50, // Hub stock
        variants: [],
      },
    ];

    await resolveCatalogStockForProducts(products, { lat: 22.7196, lng: 75.8577 });

    // Hub won on distance — franchise ledger should never even be queried.
    expect(mockLedgerFind).not.toHaveBeenCalled();
    expect(products[0].stock).toBe(50);
  });

  describe("resolveFranchiseCatalogScope", () => {
    it("restricts to the resolved franchise's own product ids when it wins on distance", async () => {
      const nearFranchise = { _id: "fp-1", location: { type: "Point", coordinates: [72.87, 19.07] } };
      mockPartnerFind.mockReturnValueOnce({
        limit: () => ({ lean: async () => [nearFranchise] }),
      });
      // No hub seller configured -> franchise wins by default.
      mockGetHubSellerId.mockResolvedValue(null);
      mockLedgerDistinct.mockResolvedValueOnce(["prod-1", "prod-2"]);

      const scope = await resolveFranchiseCatalogScope({ lat: 19.07, lng: 72.87 });

      expect(scope.type).toBe("franchise");
      expect(scope.franchisePartnerId).toBe("fp-1");
      expect(scope.allowedProductIds).toEqual(["prod-1", "prod-2"]);
      expect(mockLedgerDistinct).toHaveBeenCalledWith("productId", { franchisePartnerId: "fp-1" });
    });

    it("does not restrict (type: hub) when the hub wins on distance", async () => {
      const farFranchise = { _id: "fp-far", location: { type: "Point", coordinates: [72.5714, 23.0225] } };
      mockPartnerFind.mockReturnValueOnce({
        limit: () => ({ lean: async () => [farFranchise] }),
      });
      mockGetHubSellerId.mockResolvedValue("hub-seller-id");
      mockSellerFindById.mockReturnValue(
        sellerQueryChain({ location: { type: "Point", coordinates: [75.858, 22.72] } }),
      );

      const scope = await resolveFranchiseCatalogScope({ lat: 22.7196, lng: 75.8577 });

      expect(scope.type).toBe("hub");
      expect(mockLedgerDistinct).not.toHaveBeenCalled();
    });

    it("does not restrict when there is no location signal at all, even if a franchise would otherwise be picked", async () => {
      const scope = await resolveFranchiseCatalogScope({});

      expect(scope.type).toBe("hub");
      expect(mockPartnerFind).not.toHaveBeenCalled();
      expect(mockLedgerDistinct).not.toHaveBeenCalled();
    });
  });
});
