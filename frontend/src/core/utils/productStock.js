/**
 * Resolve sellable quantity for a product line.
 * When variantSku is set, uses variants[].stock; otherwise Product.stock.
 */
export function getAvailableStock(product, variantSku = "") {
  if (!product) return 0;

  const normalized = String(variantSku || "").trim();
  if (normalized) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const hit = variants.find((variant) => {
      const sku = String(variant?.sku || "").trim();
      const name = String(variant?.name || "").trim();
      return (sku && sku === normalized) || name === normalized;
    });
    return hit ? Math.max(0, Number(hit.stock || 0)) : 0;
  }

  return Math.max(0, Number(product?.stock || 0));
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
