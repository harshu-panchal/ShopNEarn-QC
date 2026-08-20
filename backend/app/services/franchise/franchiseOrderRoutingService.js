import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import Seller from "../../models/seller.js";
import { cartIsHubOnly } from "./franchiseCatalogService.js";
import { getHubSellerId } from "./franchiseConfigService.js";
import {
  findNearestFranchisePartner,
  resolveNearestFulfillmentSource,
} from "./franchiseStockResolver.js";
import {
  extractPincodeFromAddress,
  normalizeAddressForFranchiseRouting,
} from "./franchiseAddressUtils.js";
import * as logger from "../logger.js";

import { FRANCHISE_ORDER_STATUS } from "../../constants/franchise.js";

/**
 * Single-nearest-franchise fulfillment model: a hub-catalog order is
 * offered to ONLY the customer's single nearest active franchise
 * partner. If that partner doesn't hold full stock for the cart (or
 * later rejects/times out), fulfillment falls straight through to the
 * hub seller — there is no cascading through additional candidates.
 */

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
 * True when `partner`'s franchise stock ledger covers every cart line
 * in full.
 */
async function partnerCoversFullStock(partner, required) {
  if (!partner || required.size === 0) return false;

  const rows = await FranchiseStockLedger.find({
    franchisePartnerId: partner._id,
    productId: { $in: [...required.keys()] },
  })
    .select("productId quantity")
    .lean();

  const stockByProduct = new Map();
  for (const row of rows) {
    stockByProduct.set(String(row.productId), Number(row.quantity) || 0);
  }

  for (const [productId, qty] of required) {
    if ((stockByProduct.get(productId) || 0) < qty) return false;
  }
  return true;
}

/**
 * Resolve the customer's single nearest active franchise partner for a
 * hub-catalog order — UNLESS the hub itself is geographically closer,
 * in which case the hub fulfils directly regardless of franchise stock
 * (see `resolveNearestFulfillmentSource`). Returns the franchise
 * partner ONLY when it's the closer option AND its own ledger covers
 * the entire cart; returns `null` otherwise (hub fulfills). Never
 * routes a franchise partner to themselves.
 *
 * When `hydratedItems` is omitted (legacy callers, e.g. delivery-fee
 * distance lookups with no cart context), nearest-partner semantics
 * apply with no stock check.
 */
export async function resolveFranchisePartner({ address, customerId, hydratedItems } = {}) {
  const normalizedAddress = normalizeAddressForFranchiseRouting(address);
  const excludeCustomerId = customerId || null;
  const coords = extractDeliveryCoordinates(normalizedAddress);
  const pincode = extractPincodeFromAddress(normalizedAddress);

  const { type, franchisePartner: nearest, nearestFranchise } = await resolveNearestFulfillmentSource({
    lat: coords?.lat,
    lng: coords?.lng,
    pincode,
    excludeUserId: excludeCustomerId,
  });

  if (type === "franchise" && nearest) {
    const required = aggregateRequiredQuantities(hydratedItems);
    // Legacy callers without cart lines keep nearest-partner semantics.
    if (required.size === 0) return nearest;
    const covers = await partnerCoversFullStock(nearest, required);
    return covers ? nearest : null;
  }

  // Hub won on distance (a franchise candidate existed but the hub is
  // closer) — that's not a self-routing situation, just hub fulfilling.
  // Only check self-routing when there was NO franchise candidate at all.
  if (excludeCustomerId && !nearestFranchise) {
    const nearestIncludingSelf = await findNearestFranchisePartner({
      lat: coords?.lat,
      lng: coords?.lng,
      pincode,
    });
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
    // franchiseCandidates/currentFranchiseIndex/routedFranchiseHistory are
    // left out here — the Order schema's own defaults ([], 0, []) apply.
    return {
      franchisePartnerId: null,
      franchiseRoutedAt: null,
      franchiseStatus: null,
    };
  }

  const now = new Date();
  return {
    franchisePartnerId: franchisePartner._id,
    franchiseRoutedAt: now,
    franchiseStatus: FRANCHISE_ORDER_STATUS.PENDING,
    franchiseCandidates: [franchisePartner._id],
    currentFranchiseIndex: 0,
    routedFranchiseHistory: [
      {
        franchisePartnerId: franchisePartner._id,
        status: "PENDING",
        routedAt: now,
      },
    ],
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

/**
 * Resolve franchise routing for an order: whether it should route to
 * the customer's nearest franchise (if that partner has full stock) or
 * fall back to the hub. Convenience wrapper around `resolveFranchisePartner`
 * + `buildFranchiseOrderFields` for callers that don't already have a
 * resolved partner from `checkoutPricingService`'s pricing snapshot.
 */
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

  if (!franchisePartner) {
    logger.info("[franchiseRouting] hub-seller fallback: nearest partner has no coverage", {
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
