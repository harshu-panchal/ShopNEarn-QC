/**
 * Unit tests for stock-aware franchise order routing.
 *
 * A hub-catalog order must go to the nearest active franchise partner
 * holding FULL stock for every cart line. When no partner qualifies the
 * routing falls back to the hub seller (null partner + hubFallback flag)
 * so the hub receives the standard seller new-order alert.
 */
import { jest } from "@jest/globals";

const mockPartnerFind = jest.fn();
const mockLedgerFind = jest.fn();
const mockSellerExists = jest.fn().mockResolvedValue(false);
const mockCartIsHubOnly = jest.fn().mockResolvedValue(false);
const mockGetHubSellerId = jest.fn().mockResolvedValue(null);

jest.unstable_mockModule("../app/models/franchisePartner.js", () => ({
  default: { find: mockPartnerFind },
}));

jest.unstable_mockModule("../app/models/franchiseStockLedger.js", () => ({
  default: { find: mockLedgerFind },
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: { exists: mockSellerExists },
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

/** Geo query carries `location`; pincode query carries `territoryPincodes`. */
function mockPartners({ geo = [], territory = [] } = {}) {
  mockPartnerFind.mockImplementation((query = {}) => {
    if (query.location) return partnerQueryChain(geo);
    return partnerQueryChain(territory);
  });
}

const DELIVERY_ADDRESS = {
  pincode: "452001",
  location: { lat: 22.7196, lng: 75.8577 },
};

const NEAR_PARTNER = { _id: "partner-near", userId: "user-near" };
const FAR_PARTNER = { _id: "partner-far", userId: "user-far" };

describe("stock-aware franchise partner routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSellerExists.mockResolvedValue(false);
    mockCartIsHubOnly.mockResolvedValue(false);
    mockGetHubSellerId.mockResolvedValue(null);
  });

  it("skips the nearest unstocked partner and picks the next one with full stock", async () => {
    mockPartners({ geo: [NEAR_PARTNER, FAR_PARTNER] });
    mockLedgerFind.mockReturnValue(
      ledgerQueryChain([
        { franchisePartnerId: "partner-far", productId: "prod-1", quantity: 5 },
      ]),
    );

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
      hydratedItems: [{ productId: "prod-1", quantity: 2 }],
    });

    expect(partner).toEqual(FAR_PARTNER);
  });

  it("returns null when partners exist but none covers the full quantity", async () => {
    mockPartners({ geo: [NEAR_PARTNER, FAR_PARTNER] });
    mockLedgerFind.mockReturnValue(
      ledgerQueryChain([
        { franchisePartnerId: "partner-near", productId: "prod-1", quantity: 1 },
        { franchisePartnerId: "partner-far", productId: "prod-1", quantity: 2 },
      ]),
    );

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
      hydratedItems: [{ productId: "prod-1", quantity: 3 }],
    });

    expect(partner).toBeNull();
  });

  it("requires a partner to cover EVERY cart line, not just some", async () => {
    mockPartners({ geo: [NEAR_PARTNER] });
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
    mockPartners({ geo: [NEAR_PARTNER, FAR_PARTNER] });

    const partner = await resolveFranchisePartner({
      address: DELIVERY_ADDRESS,
    });

    expect(partner).toEqual(NEAR_PARTNER);
    expect(mockLedgerFind).not.toHaveBeenCalled();
  });

  it("falls back to the hub seller (hubFallback) when no partner holds stock for a hub cart", async () => {
    mockCartIsHubOnly.mockResolvedValue(true);
    mockPartners({ geo: [NEAR_PARTNER] });
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

  it("routes hub carts to a stocked partner with franchise fields populated", async () => {
    mockCartIsHubOnly.mockResolvedValue(true);
    mockPartners({ geo: [NEAR_PARTNER] });
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
