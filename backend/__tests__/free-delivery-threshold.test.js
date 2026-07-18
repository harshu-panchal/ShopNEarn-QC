import { jest } from "@jest/globals";

const mockProductFind = jest.fn();
const mockCategoryFind = jest.fn();
const mockGetOrCreateFinanceSettings = jest.fn();
const mockSellerCountDocuments = jest.fn().mockResolvedValue(0);
const mockIsDigitalOnlyMlmCart = false;

function createQueryChain(result) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
    session: jest.fn().mockReturnThis(),
  };
}

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: {
    find: mockProductFind,
  },
}));

jest.unstable_mockModule("../app/models/category.js", () => ({
  default: {
    find: mockCategoryFind,
  },
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: {
    countDocuments: mockSellerCountDocuments,
    findById: jest.fn().mockImplementation(() => {
      const query = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: "seller-a",
          storeLocation: null,
        }),
        session: jest.fn().mockReturnThis(),
      };
      return query;
    }),
  },
}));

jest.unstable_mockModule("../app/services/finance/financeSettingsService.js", () => ({
  getOrCreateFinanceSettings: mockGetOrCreateFinanceSettings,
}));

jest.unstable_mockModule("../app/services/mlm/mlmConfigService.js", () => ({
  getMlmConfig: jest.fn().mockResolvedValue({ homeShoppingProductId: null }),
}));

jest.unstable_mockModule("../app/services/franchise/franchiseCatalogService.js", () => ({
  cartIsHubOnly: jest.fn().mockResolvedValue(false),
}));

jest.unstable_mockModule("../app/services/franchise/franchiseConfigService.js", () => ({
  getHubSellerId: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule("../app/services/franchise/franchiseOrderRoutingService.js", () => ({
  resolveFranchisePartner: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule("../app/services/finance/couponService.js", () => ({
  computeOrderDiscount: jest.fn().mockResolvedValue(null),
}));

const { buildCheckoutPricingSnapshot } = await import(
  "../app/services/checkoutPricingService.js"
);

function mockCatalog() {
  mockProductFind.mockReturnValue(
    createQueryChain([
      {
        _id: "p1",
        name: "P1",
        salePrice: 0,
        price: 600,
        mainImage: "",
        headerId: "h1",
        sellerId: "seller-a",
        status: "active",
        stock: 10,
        variants: [],
      },
    ]),
  );

  mockCategoryFind.mockReturnValue(
    createQueryChain([
      {
        _id: "h1",
        name: "Header 1",
        adminCommissionType: "percentage",
        adminCommissionValue: 0,
        adminCommissionFixedRule: "per_qty",
        handlingFeeType: "fixed",
        handlingFeeValue: 0,
        handlingFees: 0,
      },
    ]),
  );
}

describe("free delivery threshold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSellerCountDocuments.mockResolvedValue(0);
    mockCatalog();
  });

  it("keeps delivery fees when threshold is 0/disabled", async () => {
    mockGetOrCreateFinanceSettings.mockResolvedValue({
      deliveryPricingMode: "fixed_price",
      customerBaseDeliveryFee: 20,
      riderBasePayout: 20,
      baseDistanceCapacityKm: 0.5,
      incrementalKmSurcharge: 10,
      deliveryPartnerRatePerKm: 5,
      fixedDeliveryFee: 20,
      freeDeliveryThreshold: 0,
      handlingFeeStrategy: "highest_category_fee",
      codEnabled: true,
      onlineEnabled: true,
    });

    const snapshot = await buildCheckoutPricingSnapshot({
      orderItems: [{ product: "p1", quantity: 1 }],
      address: {},
      session: null,
    });

    expect(snapshot.aggregateBreakdown.productSubtotal).toBe(600);
    expect(snapshot.aggregateBreakdown.deliveryFeeCharged).toBe(20);
    expect(snapshot.aggregateBreakdown.grandTotal).toBe(620);
    expect(snapshot.freeDeliveryApplied).toBe(false);
  });

  it("waives delivery when product subtotal is exactly at threshold", async () => {
    mockGetOrCreateFinanceSettings.mockResolvedValue({
      deliveryPricingMode: "fixed_price",
      customerBaseDeliveryFee: 20,
      riderBasePayout: 20,
      baseDistanceCapacityKm: 0.5,
      incrementalKmSurcharge: 10,
      deliveryPartnerRatePerKm: 5,
      fixedDeliveryFee: 20,
      freeDeliveryThreshold: 600,
      handlingFeeStrategy: "highest_category_fee",
      codEnabled: true,
      onlineEnabled: true,
    });

    const snapshot = await buildCheckoutPricingSnapshot({
      orderItems: [{ product: "p1", quantity: 1 }],
      address: {},
      session: null,
    });

    expect(snapshot.aggregateBreakdown.productSubtotal).toBe(600);
    expect(snapshot.aggregateBreakdown.deliveryFeeCharged).toBe(0);
    expect(snapshot.aggregateBreakdown.grandTotal).toBe(600);
    expect(snapshot.freeDeliveryApplied).toBe(true);
    expect(snapshot.freeDeliveryReason).toBe("threshold");
    expect(snapshot.sellerBreakdownEntries[0].breakdown.riderPayoutTotal).toBe(20);
    expect(
      snapshot.sellerBreakdownEntries[0].breakdown.snapshots.freeDeliveryReason,
    ).toBe("threshold");
  });

  it("keeps delivery when product subtotal is below threshold", async () => {
    mockGetOrCreateFinanceSettings.mockResolvedValue({
      deliveryPricingMode: "fixed_price",
      customerBaseDeliveryFee: 20,
      riderBasePayout: 20,
      baseDistanceCapacityKm: 0.5,
      incrementalKmSurcharge: 10,
      deliveryPartnerRatePerKm: 5,
      fixedDeliveryFee: 20,
      freeDeliveryThreshold: 700,
      handlingFeeStrategy: "highest_category_fee",
      codEnabled: true,
      onlineEnabled: true,
    });

    const snapshot = await buildCheckoutPricingSnapshot({
      orderItems: [{ product: "p1", quantity: 1 }],
      address: {},
      session: null,
    });

    expect(snapshot.aggregateBreakdown.deliveryFeeCharged).toBe(20);
    expect(snapshot.freeDeliveryApplied).toBe(false);
  });
});

void mockIsDigitalOnlyMlmCart;
