/**
 * Resolve sellable quantity for a product line.
 * Variant lines are limited by both variant stock and master product.stock
 * because checkout reserves against both counters atomically.
 */

export function sumVariantStock(variants = []) {
  if (!Array.isArray(variants) || variants.length === 0) return 0;
  return variants.reduce(
    (sum, variant) => sum + Math.max(0, Number(variant?.stock || 0)),
    0,
  );
}

export function findVariantBySkuOrName(variants = [], variantSku = "") {
  const normalized = String(variantSku || "").trim();
  if (!normalized || !Array.isArray(variants)) return null;

  return (
    variants.find((variant) => {
      const sku = String(variant?.sku || "").trim();
      const name = String(variant?.name || "").trim();
      return (sku && sku === normalized) || name === normalized;
    }) || null
  );
}

export function resolveAvailableStock(product, variantSku = "") {
  if (!product) return 0;

  const masterStock = Math.max(0, Number(product?.stock || 0));
  const normalized = String(variantSku || "").trim();
  if (normalized) {
    const hit = findVariantBySkuOrName(product.variants, normalized);
    if (!hit) return 0;
    const variantStock = Math.max(0, Number(hit.stock || 0));
    return Math.min(variantStock, masterStock);
  }

  return masterStock;
}

export function syncMasterStockFromVariants(productData = {}) {
  if (!productData || !Array.isArray(productData.variants) || productData.variants.length === 0) {
    return productData;
  }

  productData.stock = sumVariantStock(productData.variants);
  return productData;
}

export function buildInsufficientStockMessage(available, productName = "Product") {
  if (available <= 0) {
    return `${productName} is out of stock`;
  }
  return `Only ${available} unit(s) of ${productName} available`;
}

export function assertHydratedItemsStock(hydratedItems = [], productMap = new Map()) {
  for (const item of hydratedItems) {
    const product = productMap.get(String(item.productId));
    const available = resolveAvailableStock(product, item.variantSku);
    const quantity = Math.max(0, Number(item.quantity || 0));
    if (quantity <= available) continue;

    const variantSku = String(item.variantSku || "").trim();
    const productName = item.productName || product?.name || "Product";
    const err = new Error(
      variantSku
        ? `Insufficient stock for product: ${productName} (variant: ${variantSku})`
        : buildInsufficientStockMessage(available, productName),
    );
    err.statusCode = 409;
    err.code = "INSUFFICIENT_STOCK";
    throw err;
  }
}

export function resolveSellingPrice(product, variantSku = "") {
  if (!product) return 0;
  const normalized = String(variantSku || "").trim();
  if (normalized && Array.isArray(product.variants)) {
    const hit = findVariantBySkuOrName(product.variants, normalized);
    if (hit) {
      const vsp = Number(hit.salePrice);
      const vp = Number(hit.price);
      if (!isNaN(vsp) && vsp > 0) return vsp;
      if (!isNaN(vp) && vp > 0) return vp;
    }
  }

  if (Array.isArray(product.variants) && product.variants.length > 0) {
    const v = product.variants.find((item) => Number(item?.salePrice) > 0) ||
              product.variants.find((item) => Number(item?.price) > 0) ||
              product.variants[0];
    if (v) {
      const vsp = Number(v.salePrice);
      const vp = Number(v.price);
      if (!isNaN(vsp) && vsp > 0) return vsp;
      if (!isNaN(vp) && vp > 0) return vp;
    }
  }

  const sp = Number(product.salePrice);
  if (!isNaN(sp) && sp > 0) return sp;

  const mrp = Number(product.price);
  return (!isNaN(mrp) && mrp > 0) ? mrp : 0;
}
