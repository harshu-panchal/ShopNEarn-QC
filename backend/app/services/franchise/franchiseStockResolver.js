import FranchisePartner from "../../models/franchisePartner.js";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import { FRANCHISE_PARTNER_STATUS } from "../../constants/franchise.js";

/**
 * Find up to 5 nearest active Franchise Partners.
 * Order of priority:
 * 1. Geo-nearest active partners ($near by coordinates)
 * 2. Territory pincode matches
 * 3. General active partners ordered by registration date
 */
export async function findTop5NearestFranchisePartners({ lat, lng, pincode } = {}) {
  const candidates = [];
  const seen = new Set();

  const pushUnique = (partner) => {
    const id = String(partner._id);
    if (!seen.has(id)) {
      seen.add(id);
      candidates.push(partner);
    }
  };

  const numLat = Number(lat);
  const numLng = Number(lng);
  const hasCoords = Number.isFinite(numLat) && Number.isFinite(numLng) &&
    numLat >= -90 && numLat <= 90 && numLng >= -180 && numLng <= 180;

  if (hasCoords) {
    try {
      const geoPartners = await FranchisePartner.find({
        status: FRANCHISE_PARTNER_STATUS.ACTIVE,
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [numLng, numLat] },
          },
        },
      })
        .limit(5)
        .lean();

      geoPartners.forEach(pushUnique);
    } catch {
      // Fallback if 2d index is not active or query fails
    }
  }

  const cleanPincode = String(pincode || "").trim();
  if (candidates.length < 5 && cleanPincode) {
    const territoryPartners = await FranchisePartner.find({
      status: FRANCHISE_PARTNER_STATUS.ACTIVE,
      $or: [{ territoryPincodes: cleanPincode }, { pincode: cleanPincode }],
    })
      .sort({ registeredAt: 1 })
      .limit(5 - candidates.length)
      .lean();

    territoryPartners.forEach(pushUnique);
  }

  if (candidates.length < 5) {
    const defaultPartners = await FranchisePartner.find({
      status: FRANCHISE_PARTNER_STATUS.ACTIVE,
    })
      .sort({ registeredAt: 1 })
      .limit(5 - candidates.length)
      .lean();

    defaultPartners.forEach(pushUnique);
  }

  return candidates.slice(0, 5);
}

/**
 * Resolve product and variant stock for a list of catalog products.
 * Sums stock across up to 5 nearest Franchise Partners from FranchiseStockLedger.
 * Falls back to original Product.stock and Product.variants[].stock if no franchise stock exists.
 *
 * @param {Array<Object>} products - List of product documents (plain objects or Mongoose docs)
 * @param {Object} location - { lat, lng, pincode }
 * @returns {Promise<Array<Object>>} Resolved products with updated stock & variant stock
 */
export async function resolveCatalogStockForProducts(products = [], { lat, lng, pincode } = {}) {
  if (!Array.isArray(products) || products.length === 0) {
    return products;
  }

  const partners = await findTop5NearestFranchisePartners({ lat, lng, pincode });
  if (!partners || partners.length === 0) {
    // No active franchise partners found -> Hub fallback
    return products;
  }

  const partnerIds = partners.map((p) => p._id);
  const productIds = products
    .map((p) => p?._id || p?.id)
    .filter(Boolean);

  if (productIds.length === 0) {
    return products;
  }

  const ledgers = await FranchiseStockLedger.find({
    franchisePartnerId: { $in: partnerIds },
    productId: { $in: productIds },
  }).lean();

  if (!ledgers || ledgers.length === 0) {
    // No franchise stock ledgers found for these products -> Hub fallback
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
      // Leave product stock & variant stock untouched (Hub fallback)
      continue;
    }

    let franchiseMasterSum = 0;
    const variantStockSumMap = new Map();

    for (const ledger of productLedgers) {
      const qty = Math.max(0, Number(ledger.quantity) || 0);
      const sku = String(ledger.variantSku || "").trim();

      if (sku) {
        variantStockSumMap.set(sku, (variantStockSumMap.get(sku) || 0) + qty);
      } else {
        franchiseMasterSum += qty;
      }
    }

    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    let totalFranchiseVariantSum = 0;

    if (hasVariants) {
      for (const variant of product.variants) {
        const skuKey = String(variant.sku || "").trim();
        const nameKey = String(variant.name || "").trim();

        const variantStock =
          (skuKey ? variantStockSumMap.get(skuKey) : undefined) ??
          (nameKey ? variantStockSumMap.get(nameKey) : undefined) ??
          0;

        variant.stock = variantStock;
        totalFranchiseVariantSum += variantStock;
      }
    }

    const calculatedFranchiseTotal = hasVariants
      ? Math.max(franchiseMasterSum, totalFranchiseVariantSum)
      : franchiseMasterSum;

    const hasAnyFranchiseLedgerEntry = productLedgers.some(
      (l) => Number(l.quantity) > 0,
    );

    if (hasAnyFranchiseLedgerEntry || calculatedFranchiseTotal > 0) {
      product.stock = calculatedFranchiseTotal;
    }
  }

  return products;
}
