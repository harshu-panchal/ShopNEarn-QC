/**
 * Resolve sellable quantity for a product line.
 * Variant lines are limited by both variant stock and master product.stock
 * because checkout reserves against both counters atomically.
 */
export function getAvailableStock(product, variantSku = "") {
  if (!product) return 0;

  const masterStock = Math.max(0, Number(product?.stock || 0));
  const normalized = String(variantSku || "").trim();
  if (normalized) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const hit = variants.find((variant) => {
      const sku = String(variant?.sku || "").trim();
      const name = String(variant?.name || "").trim();
      return (sku && sku === normalized) || name === normalized;
    });
    if (!hit) return 0;
    const variantStock = Math.max(0, Number(hit.stock || 0));
    return Math.min(variantStock, masterStock);
  }

  return masterStock;
}

export function isAtStockLimit(product, variantSku, quantity) {
  const available = getAvailableStock(product, variantSku);
  return Number(quantity || 0) >= available;
}

export function stockLimitToastMessage(product, variantSku, available) {
  const name = product?.name || "This product";
  const stock = available ?? getAvailableStock(product, variantSku);
  if (stock <= 0) {
    return `${name} is out of stock`;
  }
  return `Only ${stock} unit(s) of ${name} available`;
}

export function getProductSellingPrice(product, variantSku = "") {
  if (!product) return 0;
  const normalized = String(variantSku || "").trim();
  if (normalized && Array.isArray(product.variants)) {
    const hit = product.variants.find((variant) => {
      const sku = String(variant?.sku || "").trim();
      const name = String(variant?.name || "").trim();
      return (sku && sku === normalized) || name === normalized;
    });
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

export function getProductMrp(product, variantSku = "") {
  if (!product) return 0;
  const normalized = String(variantSku || "").trim();
  if (normalized && Array.isArray(product.variants)) {
    const hit = product.variants.find((variant) => {
      const sku = String(variant?.sku || "").trim();
      const name = String(variant?.name || "").trim();
      return (sku && sku === normalized) || name === normalized;
    });
    if (hit) {
      const vp = Number(hit.price);
      if (!isNaN(vp) && vp > 0) return vp;
    }
  }

  if (Array.isArray(product.variants) && product.variants.length > 0) {
    const v = product.variants.find((item) => Number(item?.price) > 0) || product.variants[0];
    if (v) {
      const vp = Number(v.price);
      if (!isNaN(vp) && vp > 0) return vp;
    }
  }

  const mrp = Number(product.price);
  return (!isNaN(mrp) && mrp > 0) ? mrp : 0;
}
