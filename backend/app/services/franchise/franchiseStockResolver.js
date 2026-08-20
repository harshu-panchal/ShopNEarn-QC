import FranchisePartner from "../../models/franchisePartner.js";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import Seller from "../../models/seller.js";
import { FRANCHISE_PARTNER_STATUS } from "../../constants/franchise.js";
import { getHubSellerId } from "./franchiseConfigService.js";
import { distanceMeters } from "../../utils/geoUtils.js";

/**
 * Find the single nearest active Franchise Partner for a customer.
 * Order of priority:
 * 1. Geo-nearest active partner ($near by coordinates)
 * 2. Territory pincode match (earliest registered first)
 * 3. General active partner ordered by registration date
 *
 * `excludeUserId` skips a partner whose OWN customer-facing account
 * placed the order (a franchise partner cannot be routed to themselves)
 * — used by order routing, not by catalog display.
 */
export async function findNearestFranchisePartner({ lat, lng, pincode, excludeUserId = null } = {}) {
  const baseFilter = { status: FRANCHISE_PARTNER_STATUS.ACTIVE };
  if (excludeUserId) {
    baseFilter.userId = { $ne: excludeUserId };
  }

  const numLat = Number(lat);
  const numLng = Number(lng);
  const hasCoords = Number.isFinite(numLat) && Number.isFinite(numLng) &&
    numLat >= -90 && numLat <= 90 && numLng >= -180 && numLng <= 180;

  if (hasCoords) {
    try {
      const [geoPartner] = await FranchisePartner.find({
        ...baseFilter,
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [numLng, numLat] },
          },
        },
      })
        .limit(1)
        .lean();
      if (geoPartner) return geoPartner;
    } catch {
      // Fallback if 2d index is not active or query fails
    }
  }

  const cleanPincode = String(pincode || "").trim();
  if (cleanPincode) {
    const [territoryPartner] = await FranchisePartner.find({
      ...baseFilter,
      $or: [{ territoryPincodes: cleanPincode }, { pincode: cleanPincode }],
    })
      .sort({ registeredAt: 1 })
      .limit(1)
      .lean();
    if (territoryPartner) return territoryPartner;
  }

  const [defaultPartner] = await FranchisePartner.find(baseFilter)
    .sort({ registeredAt: 1 })
    .limit(1)
    .lean();
  return defaultPartner || null;
}

/**
 * Compare the customer's distance to their nearest active franchise
 * partner against their distance to Harsh's Hub itself. Whichever is
 * geographically closer fulfils — if the hub is nearer, the caller
 * should use the hub's own catalog/stock directly rather than routing
 * to a franchise, even if that franchise has stock.
 *
 * Falls back to "franchise wins" whenever the comparison can't be made
 * (no customer coordinates, no franchise/hub location on file) — this
 * only affects the geo-distance tie-break; the underlying franchise
 * lookup already has its own pincode/registration-order fallback tiers
 * for when coordinates aren't available at all.
 *
 * Returns `{ type, franchisePartner, nearestFranchise }` — `franchisePartner`
 * is the entity that should actually FULFIL (null when the hub wins);
 * `nearestFranchise` is always the nearest franchise found (if any),
 * regardless of who wins, so callers that need to know "was there a
 * franchise candidate at all" (e.g. the self-routing-block check) don't
 * lose that information just because the hub happened to be closer.
 */
export async function resolveNearestFulfillmentSource({ lat, lng, pincode, excludeUserId } = {}) {
  const nearestFranchise = await findNearestFranchisePartner({
    lat,
    lng,
    pincode,
    excludeUserId,
  });
  if (!nearestFranchise) {
    return { type: "hub", franchisePartner: null, nearestFranchise: null };
  }

  const numLat = Number(lat);
  const numLng = Number(lng);
  const hasCustomerCoords = Number.isFinite(numLat) && Number.isFinite(numLng);
  const franchiseCoords = nearestFranchise?.location?.coordinates;
  const hasFranchiseCoords = Array.isArray(franchiseCoords) && franchiseCoords.length >= 2;
  if (!hasCustomerCoords || !hasFranchiseCoords) {
    return { type: "franchise", franchisePartner: nearestFranchise, nearestFranchise };
  }

  const hubSellerId = await getHubSellerId();
  const hubSeller = hubSellerId
    ? await Seller.findById(hubSellerId).select("location").lean()
    : null;
  const hubCoords = hubSeller?.location?.coordinates;
  const hasHubCoords = Array.isArray(hubCoords) && hubCoords.length >= 2;
  if (!hasHubCoords) {
    return { type: "franchise", franchisePartner: nearestFranchise, nearestFranchise };
  }

  const [franchiseLng, franchiseLat] = franchiseCoords;
  const [hubLng, hubLat] = hubCoords;
  const franchiseDistance = distanceMeters(numLat, numLng, franchiseLat, franchiseLng);
  const hubDistance = distanceMeters(numLat, numLng, hubLat, hubLng);

  if (hubDistance <= franchiseDistance) {
    return { type: "hub", franchisePartner: null, nearestFranchise };
  }
  return { type: "franchise", franchisePartner: nearestFranchise, nearestFranchise };
}

/**
 * Resolve product and variant stock for a list of catalog products.
 * Reads stock from the customer's SINGLE nearest Franchise Partner's
 * FranchiseStockLedger — UNLESS the hub itself is geographically closer
 * than that franchise, in which case the hub's own Product.stock is
 * shown directly (see `resolveNearestFulfillmentSource`). Falls back to
 * the original Product.stock and Product.variants[].stock when the
 * franchise has NO ledger entry at all for the product (not when it has
 * an entry at 0 — that means genuinely out of stock at that franchise).
 *
 * @param {Array<Object>} products - List of product documents (plain objects or Mongoose docs)
 * @param {Object} location - { lat, lng, pincode }
 * @returns {Promise<Array<Object>>} Resolved products with updated stock & variant stock
 */
export async function resolveCatalogStockForProducts(products = [], { lat, lng, pincode } = {}) {
  if (!Array.isArray(products) || products.length === 0) {
    return products;
  }

  const { type, franchisePartner: partner } = await resolveNearestFulfillmentSource({
    lat,
    lng,
    pincode,
  });
  if (type === "hub" || !partner) {
    // Hub is closer (or no active franchise partner found) -> Hub's own stock.
    return products;
  }

  const productIds = products
    .map((p) => p?._id || p?.id)
    .filter(Boolean);

  if (productIds.length === 0) {
    return products;
  }

  const ledgers = await FranchiseStockLedger.find({
    franchisePartnerId: partner._id,
    productId: { $in: productIds },
  }).lean();

  if (!ledgers || ledgers.length === 0) {
    // Nearest franchise has no ledger entries for these products -> Hub fallback
    return products;
  }

  // Group ledgers by productId
  const ledgersByProduct = new Map();
  for (const ledger of ledgers) {
    const pId = String(ledger.productId);
    if (!ledgersByProduct.has(pId)) {
      ledgersByProduct.set(pId, []);
    }
    ledgersByProduct.get(pId).push(ledger);
  }

  for (const product of products) {
    const pId = String(product._id || product.id);
    const productLedgers = ledgersByProduct.get(pId);

    if (!productLedgers || productLedgers.length === 0) {
      // No ledger entry at this franchise for this product -> Hub fallback
      continue;
    }

    let franchiseMasterQty = 0;
    const variantStockMap = new Map();

    for (const ledger of productLedgers) {
      const qty = Math.max(0, Number(ledger.quantity) || 0);
      const sku = String(ledger.variantSku || "").trim();

      if (sku) {
        variantStockMap.set(sku, (variantStockMap.get(sku) || 0) + qty);
      } else {
        franchiseMasterQty += qty;
      }
    }

    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    let totalFranchiseVariantQty = 0;

    if (hasVariants) {
      for (const variant of product.variants) {
        const skuKey = String(variant.sku || "").trim();
        const nameKey = String(variant.name || "").trim();

        const variantStock =
          (skuKey ? variantStockMap.get(skuKey) : undefined) ??
          (nameKey ? variantStockMap.get(nameKey) : undefined) ??
          0;

        variant.stock = variantStock;
        totalFranchiseVariantQty += variantStock;
      }
    }

    const calculatedFranchiseTotal = hasVariants
      ? Math.max(franchiseMasterQty, totalFranchiseVariantQty)
      : franchiseMasterQty;

    const hasAnyFranchiseLedgerEntry = productLedgers.some(
      (l) => Number(l.quantity) > 0,
    );

    if (hasAnyFranchiseLedgerEntry || calculatedFranchiseTotal > 0) {
      product.stock = calculatedFranchiseTotal;
    }
  }

  return products;
}
