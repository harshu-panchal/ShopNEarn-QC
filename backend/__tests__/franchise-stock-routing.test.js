/**
 * Unit tests for stock-aware SINGLE-NEAREST-franchise order routing.
 *
 * A hub-catalog order is offered to ONLY the customer's single nearest
 * active franchise partner. If that partner doesn't hold FULL stock for
 * every cart line, routing falls straight through to the hub seller
 * (null partner + hubFallback flag) — there is no cascading through
 * farther candidates.
 */
import { jest } from "@jest/globals";

const mockPartnerFind = jest.fn();
const mockLedgerFind = jest.fn();
const mockSellerExists = jest.fn().mockResolvedValue(false);
const mockSellerFindById = jest.fn();
const mockCartIsHubOnly = jest.fn().mockResolvedValue(false);
const mockGetHubSellerId = jest.fn().mockResolvedValue(null);

jest.unstable_mockModule("../app/models/franchisePartner.js", () => ({
  default: { find: mockPartnerFind },
}));

jest.unstable_mockModule("../app/models/franchiseStockLedger.js", () => ({
  default: { find: mockLedgerFind },
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: { exists: mockSellerExists, findById: mockSellerFindById },
}));

jest.unstable_mockModule(
  "../app/services/franchise/franchiseCatalogService.js",
  () => ({ cartIsHubOnly: mockCartIsHubOnly }),
);

jest.unstable_mockModule(
  "../app/services/franchise/franchiseConfigService.js",
  () => ({ getHubSellerId: mockGetHubSellerId }),
);

jest.unstable_mockModule("../app/services/logger.js", () => {
  const noop = () => {};
  return {
    log: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    child: () => ({ log: noop, error: noop, warn: noop, info: noop, debug: noop }),
    sanitize: (v) => v,
    runWithCorrelationId: (fn) => fn(),
    getCorrelationId: () => null,
    LOG_LEVELS: {},
    default: { log: noop, error: noop, warn: noop, info: noop, debug: noop },
  };
});

const { resolveFranchisePartner, resolveFranchiseOrderRouting } = await import(
  "../app/services/franchise/franchiseOrderRoutingService.js"
);

function partnerQueryChain(result) {
  const chain = {
    limit: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function ledgerQueryChain(result) {
  const chain = {
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function sellerQueryChain(result) {
  const chain = {
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

/** Geo query carries `location`; pincode query carries `territoryPincodes`/`pincode`. */
function mockNearestPartner(partner) {
  mockPartnerFind.mockImplementation((query = {}) => {
    if (query.location) return partnerQueryChain(partner ? [partner] : []);
    return partnerQueryChain([]);
  });
}

const DELIVERY_ADDRESS = {
  pincode: "452001",
  location: { lat: 22.7196, lng: 75.8577 },
};

const NEAR_PARTNER = { _id: "partner-near", userId: "user-near" };

describe("single-nearest-franchise partner routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSellerExists.mockResolvedValue(false);
    mockSellerFindById.mockReturnValue(sellerQueryChain(null));
    mockCartIsHubOnly.mockResolvedValue(false);
    mockGetHubSellerId.mockResolvedValue(null);
  });

  it("returns the nearest partner when it covers the full cart", async () => {
    mockNearestPartner(NEAR_PARTNER);
    mockLedgerFind.mockReturnValue(
      ledgerQueryChain([
        { franchisePartnerId: "partner-near", productId: "prod-1", quantity: 5 },
      ]),
    );

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
      hydratedItems: [{ productId: "prod-1", quantity: 2 }],
    });

    expect(partner).toEqual(NEAR_PARTNER);
  });

  it("does NOT try a farther partner — falls to hub (null) when the nearest lacks stock", async () => {
    mockNearestPartner(NEAR_PARTNER);
    mockLedgerFind.mockReturnValue(
      ledgerQueryChain([
        { franchisePartnerId: "partner-near", productId: "prod-1", quantity: 1 },
      ]),
    );

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
      hydratedItems: [{ productId: "prod-1", quantity: 5 }],
    });

    expect(partner).toBeNull();
  });

  it("returns null when partner exists but has zero coverage for the product", async () => {
    mockNearestPartner(NEAR_PARTNER);
    mockLedgerFind.mockReturnValue(ledgerQueryChain([]));

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
      hydratedItems: [{ productId: "prod-1", quantity: 1 }],
    });

    expect(partner).toBeNull();
  });

  it("requires the nearest partner to cover EVERY cart line, not just some", async () => {
    mockNearestPartner(NEAR_PARTNER);
    mockLedgerFind.mockReturnValue(
      ledgerQueryChain([
        { franchisePartnerId: "partner-near", productId: "prod-1", quantity: 10 },
      ]),
    );

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
      hydratedItems: [
        { productId: "prod-1", quantity: 1 },
        { productId: "prod-2", quantity: 1 },
      ],
    });

    expect(partner).toBeNull();
  });

  it("keeps nearest-partner semantics for legacy calls without cart lines", async () => {
    mockNearestPartner(NEAR_PARTNER);

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
    });

    expect(partner).toEqual(NEAR_PARTNER);
    expect(mockLedgerFind).not.toHaveBeenCalled();
  });

  describe("hub-vs-franchise distance comparison", () => {
    // Customer is essentially at the same spot as HUB_COORDS; the
    // franchise is ~380km away (Ahmedabad) — hub must win.
    const HUB_COORDS = [75.858, 22.72]; // [lng, lat]
    const FAR_FRANCHISE = {
      _id: "partner-far",
      userId: "user-far",
      location: { type: "Point", coordinates: [72.5714, 23.0225] },
    };
    // Franchise essentially at the customer's spot; hub is ~380km away.
    const NEAR_FRANCHISE = {
      _id: "partner-near-geo",
      userId: "user-near-geo",
      location: { type: "Point", coordinates: [75.858, 22.72] },
    };
    const FAR_HUB_COORDS = [72.5714, 23.0225];

    it("routes to the hub (no franchise) when the hub is geographically closer than the only nearby franchise", async () => {
      mockCartIsHubOnly.mockResolvedValue(true);
      mockNearestPartner(FAR_FRANCHISE);
      mockGetHubSellerId.mockResolvedValue("hub-seller-id");
      mockSellerFindById.mockReturnValue(
        sellerQueryChain({ location: { type: "Point", coordinates: HUB_COORDS } }),
      );

      const partner = await resolveFranchisePartner({
        address: DELIVERY_ADDRESS,
        hydratedItems: [{ productId: "prod-1", quantity: 1 }],
      });

      expect(partner).toBeNull();
      // Hub won on distance before any stock lookup was needed.
      expect(mockLedgerFind).not.toHaveBeenCalled();
    });

    it("still routes to the franchise when it's geographically closer than the hub (and has stock)", async () => {
      mockCartIsHubOnly.mockResolvedValue(true);
      mockNearestPartner(NEAR_FRANCHISE);
      mockGetHubSellerId.mockResolvedValue("hub-seller-id");
      mockSellerFindById.mockReturnValue(
        sellerQueryChain({ location: { type: "Point", coordinates: FAR_HUB_COORDS } }),
      );
      mockLedgerFind.mockReturnValue(
        ledgerQueryChain([
          { franchisePartnerId: "partner-near-geo", productId: "prod-1", quantity: 5 },
        ]),
      );

      const partner = await resolveFranchisePartner({
        address: DELIVERY_ADDRESS,
        hydratedItems: [{ productId: "prod-1", quantity: 1 }],
      });

      expect(partner).toEqual(NEAR_FRANCHISE);
    });
  });

  it("falls back to the hub seller (hubFallback) when the nearest partner has no stock for a hub cart", async () => {
    mockCartIsHubOnly.mockResolvedValue(true);
    mockNearestPartner(NEAR_PARTNER);
    mockLedgerFind.mockReturnValue(ledgerQueryChain([]));

    const routing = await resolveFranchiseOrderRouting({
      hydratedItems: [{ productId: "prod-1", quantity: 1, sellerId: "hub-seller" }],
      address: DELIVERY_ADDRESS,
      customerId: "customer-1",
    });

    expect(routing.hubFallback).toBe(true);
    expect(routing.franchisePartner).toBeNull();
    expect(routing.fields).toEqual({
      franchisePartnerId: null,
      franchiseRoutedAt: null,
      franchiseStatus: null,
    });
  });

  it("routes hub carts to the nearest partner with franchise fields populated", async () => {
    mockCartIsHubOnly.mockResolvedValue(true);
    mockNearestPartner(NEAR_PARTNER);
    mockLedgerFind.mockReturnValue(
      ledgerQueryChain([
        { franchisePartnerId: "partner-near", productId: "prod-1", quantity: 4 },
      ]),
    );

    const routing = await resolveFranchiseOrderRouting({
      hydratedItems: [{ productId: "prod-1", quantity: 2, sellerId: "hub-seller" }],
      address: DELIVERY_ADDRESS,
      customerId: "customer-1",
    });

    expect(routing.hubFallback).toBe(false);
    expect(routing.franchisePartner).toEqual(NEAR_PARTNER);
    expect(routing.fields.franchisePartnerId).toBe("partner-near");
    expect(routing.fields.franchiseStatus).toBeTruthy();
  });

  it("leaves general-seller carts on the standard seller workflow", async () => {
    mockCartIsHubOnly.mockResolvedValue(false);
    mockSellerExists.mockResolvedValue(false);

    const routing = await resolveFranchiseOrderRouting({
      hydratedItems: [{ productId: "prod-9", quantity: 1, sellerId: "seller-general" }],
      address: DELIVERY_ADDRESS,
      customerId: "customer-1",
    });

    expect(routing.hubFallback).toBe(false);
    expect(routing.franchisePartner).toBeNull();
    expect(routing.fields.franchisePartnerId).toBeNull();
    expect(mockPartnerFind).not.toHaveBeenCalled();
  });
});
