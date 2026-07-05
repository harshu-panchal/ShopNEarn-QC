import FranchisePartner from "../../models/franchisePartner.js";
import Seller from "../../models/seller.js";
import { cartIsHubOnly } from "./franchiseCatalogService.js";
import { getHubSellerId } from "./franchiseConfigService.js";
import {
  extractPincodeFromAddress,
  normalizeAddressForFranchiseRouting,
} from "./franchiseAddressUtils.js";

import { FRANCHISE_ORDER_STATUS, FRANCHISE_PARTNER_STATUS } from "../../constants/franchise.js";

function extractDeliveryCoordinates(address = {}) {
  const lat = Number(address?.location?.lat ?? address?.lat);
  const lng = Number(address?.location?.lng ?? address?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function franchiseTerritoryUnavailableError() {
  const err = new Error(
    "Home Shoppy is not available in your delivery area yet. No franchise partner serves this location.",
  );
  err.statusCode = 422;
  err.code = "FRANCHISE_TERRITORY_UNAVAILABLE";
  return err;
}

export function franchiseSelfRoutingError() {
  const err = new Error(
    "As a Home Shoppy franchise partner, you cannot place a customer order to yourself. Use Buy Stock for inventory, or choose a delivery address outside your franchise area.",
  );
  err.statusCode = 422;
  err.code = "FRANCHISE_SELF_ROUTING_BLOCKED";
  return err;
}

function activePartnerFilter(excludeCustomerId = null) {
  const filter = { status: FRANCHISE_PARTNER_STATUS.ACTIVE };
  if (excludeCustomerId) {
    filter.userId = { $ne: excludeCustomerId };
  }
  return filter;
}

/**
 * Nearest active partner by geo, then pincode. Optionally skips the
 * ordering customer so franchise partners are not routed to themselves.
 */
async function findNearestActivePartner(normalizedAddress, { excludeCustomerId } = {}) {
  const coords = extractDeliveryCoordinates(normalizedAddress);
  if (coords) {
    const partner = await FranchisePartner.findOne({
      ...activePartnerFilter(excludeCustomerId),
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [coords.lng, coords.lat] },
        },
      },
    }).lean();

    if (partner) return partner;
  }

  const pincode = extractPincodeFromAddress(normalizedAddress);
  if (!pincode) return null;

  return FranchisePartner.findOne({
    ...activePartnerFilter(excludeCustomerId),
    territoryPincodes: pincode,
  })
    .sort({ registeredAt: 1 })
    .lean();
}

/**
 * Route hub orders to the nearest active franchise partner by delivery
 * coordinates. Falls back to pincode match when coordinates are unavailable.
 * Never routes to the customer placing the order when they are a partner.
 */
export async function resolveFranchisePartner({ address, customerId } = {}) {
  const normalizedAddress = normalizeAddressForFranchiseRouting(address);
  const excludeCustomerId = customerId || null;

  const partner = await findNearestActivePartner(normalizedAddress, {
    excludeCustomerId,
  });
  if (partner) return partner;

  if (excludeCustomerId) {
    const nearestIncludingSelf = await findNearestActivePartner(normalizedAddress, {});
    if (
      nearestIncludingSelf &&
      String(nearestIncludingSelf.userId) === String(excludeCustomerId)
    ) {
      throw franchiseSelfRoutingError();
    }
  }

  return null;
}

export function buildFranchiseOrderFields(franchisePartner) {
  if (!franchisePartner?._id) {
    return {
      franchisePartnerId: null,
      franchiseRoutedAt: null,
      franchiseStatus: null,
    };
  }
  return {
    franchisePartnerId: franchisePartner._id,
    franchiseRoutedAt: new Date(),
    franchiseStatus: FRANCHISE_ORDER_STATUS.PENDING,
  };
}

export async function shouldRouteOrderToFranchise(hydratedItems = []) {
  if (!Array.isArray(hydratedItems) || hydratedItems.length === 0) return false;

  const sellerIds = [
    ...new Set(
      hydratedItems
        .map((item) => String(item?.sellerId || "").trim())
        .filter(Boolean),
    ),
  ];
  // Mixed-seller carts stay on the standard seller workflow.
  if (sellerIds.length !== 1) return false;

  if (await cartIsHubOnly(hydratedItems)) return true;

  const soleSellerId = sellerIds[0];
  const configuredHubId = await getHubSellerId();
  if (configuredHubId && String(configuredHubId) === soleSellerId) return true;

  return !!(await Seller.exists({ _id: soleSellerId, isPlatformHub: true }));
}

export async function resolveFranchiseOrderRouting({ hydratedItems, address, customerId } = {}) {
  const shouldRoute = await shouldRouteOrderToFranchise(hydratedItems);
  if (!shouldRoute) {
    return { franchisePartner: null, fields: buildFranchiseOrderFields(null) };
  }

  const normalizedAddress = normalizeAddressForFranchiseRouting(address);
  const franchisePartner = await resolveFranchisePartner({
    address: normalizedAddress,
    customerId,
  });

  if (!franchisePartner) {
    throw franchiseTerritoryUnavailableError();
  }

  return {
    franchisePartner,
    fields: buildFranchiseOrderFields(franchisePartner),
  };
}
