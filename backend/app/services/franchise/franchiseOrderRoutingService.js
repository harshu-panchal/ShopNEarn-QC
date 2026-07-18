import FranchisePartner from "../../models/franchisePartner.js";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import Seller from "../../models/seller.js";
import { cartIsHubOnly } from "./franchiseCatalogService.js";
import { getHubSellerId } from "./franchiseConfigService.js";
import {
  extractPincodeFromAddress,
  normalizeAddressForFranchiseRouting,
} from "./franchiseAddressUtils.js";
import * as logger from "../logger.js";

import { FRANCHISE_ORDER_STATUS, FRANCHISE_PARTNER_STATUS } from "../../constants/franchise.js";

// How many nearby partners we consider when looking for one that holds
// full stock for the cart before falling back to the hub seller.
const MAX_PARTNER_CANDIDATES = 10;

function extractDeliveryCoordinates(address = {}) {
  const lat = Number(address?.location?.lat ?? address?.lat);
  const lng = Number(address?.location?.lng ?? address?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
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
 * Active partners ordered by preference: geo-nearest first, then pincode
 * territory matches (earliest registered first). Optionally skips the
 * ordering customer so franchise partners are not routed to themselves.
 */
async function findActivePartnerCandidates(normalizedAddress, { excludeCustomerId } = {}) {
  const candidates = [];
  const seen = new Set();
  const pushUnique = (partner) => {
    const id = String(partner._id);
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(partner);
  };

  const coords = extractDeliveryCoordinates(normalizedAddress);
  if (coords) {
    const geoPartners = await FranchisePartner.find({
      ...activePartnerFilter(excludeCustomerId),
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [coords.lng, coords.lat] },
        },
      },
    })
      .limit(MAX_PARTNER_CANDIDATES)
      .lean();
    geoPartners.forEach(pushUnique);
  }

  const pincode = extractPincodeFromAddress(normalizedAddress);
  if (pincode) {
    const territoryPartners = await FranchisePartner.find({
      ...activePartnerFilter(excludeCustomerId),
      territoryPincodes: pincode,
    })
      .sort({ registeredAt: 1 })
      .limit(MAX_PARTNER_CANDIDATES)
      .lean();
    territoryPartners.forEach(pushUnique);
  }

  return candidates;
}

/** Total quantity needed per productId across the cart lines. */
function aggregateRequiredQuantities(items = []) {
  const required = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const productId = String(item?.productId || item?.product || "").trim();
    if (!productId) continue;
    const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    required.set(productId, (required.get(productId) || 0) + qty);
  }
  return required;
}

/**
 * First candidate (in preference order) whose franchise stock ledger
 * covers every cart line in full. Returns null when nobody can fulfill.
 */
async function findFirstPartnerWithFullStock(candidates, required) {
  if (candidates.length === 0 || required.size === 0) return null;

  const ledgers = await FranchiseStockLedger.find({
    franchisePartnerId: { $in: candidates.map((partner) => partner._id) },
    productId: { $in: [...required.keys()] },
  })
    .select("franchisePartnerId productId quantity")
    .lean();

  const stockByPartner = new Map();
  for (const row of ledgers) {
    const partnerId = String(row.franchisePartnerId);
    if (!stockByPartner.has(partnerId)) stockByPartner.set(partnerId, new Map());
    stockByPartner
      .get(partnerId)
      .set(String(row.productId), Number(row.quantity) || 0);
  }

  for (const partner of candidates) {
    const stock = stockByPartner.get(String(partner._id));
    if (!stock) continue;
    let coversAll = true;
    for (const [productId, qty] of required) {
      if ((stock.get(productId) || 0) < qty) {
        coversAll = false;
        break;
      }
    }
    if (coversAll) return partner;
  }
  return null;
}

/**
 * Route hub orders to the nearest active franchise partner by delivery
 * coordinates. Falls back to pincode match when coordinates are unavailable.
 * Never routes to the customer placing the order when they are a partner.
 *
 * When `hydratedItems` are provided, only partners holding FULL stock for
 * every line are eligible; returns null (hub-seller fallback) when no
 * candidate can fulfill the whole cart.
 */
export async function resolveFranchisePartner({ address, customerId, hydratedItems } = {}) {
  const normalizedAddress = normalizeAddressForFranchiseRouting(address);
  const excludeCustomerId = customerId || null;

  const candidates = await findActivePartnerCandidates(normalizedAddress, {
    excludeCustomerId,
  });

  if (candidates.length > 0) {
    const required = aggregateRequiredQuantities(hydratedItems);
    // Legacy callers without cart lines keep nearest-partner semantics.
    if (required.size === 0) return candidates[0];
    return findFirstPartnerWithFullStock(candidates, required);
  }

  if (excludeCustomerId) {
    const nearestIncludingSelf = await findActivePartnerCandidates(normalizedAddress, {});
    if (
      nearestIncludingSelf.length > 0 &&
      String(nearestIncludingSelf[0].userId) === String(excludeCustomerId)
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
    return {
      franchisePartner: null,
      fields: buildFranchiseOrderFields(null),
      hubFallback: false,
    };
  }

  const normalizedAddress = normalizeAddressForFranchiseRouting(address);
  const franchisePartner = await resolveFranchisePartner({
    address: normalizedAddress,
    customerId,
    hydratedItems,
  });

  // No partner covers the territory, or none holds full stock for the
  // cart: the hub seller fulfills directly through the standard seller
  // workflow (hub gets the new-order alert instead of a partner).
  if (!franchisePartner) {
    logger.info("[franchiseRouting] hub-seller fallback: no stocked partner", {
      customerId: customerId ? String(customerId) : null,
      productIds: (hydratedItems || []).map((item) =>
        String(item?.productId || item?.product || ""),
      ),
    });
    return {
      franchisePartner: null,
      fields: buildFranchiseOrderFields(null),
      hubFallback: true,
    };
  }

  return {
    franchisePartner,
    fields: buildFranchiseOrderFields(franchisePartner),
    hubFallback: false,
  };
}
