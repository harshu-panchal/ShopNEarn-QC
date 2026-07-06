/**
 * Resolve sellable quantity for a product line.
 * When variantSku is set, uses variants[].stock; otherwise Product.stock.
 */
export function resolveAvailableStock(product, variantSku = "") {
  if (!product) return 0;

  const normalized = String(variantSku || "").trim();
  if (normalized) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const hit = variants.find((variant) => {
      const sku = String(variant?.sku || "").trim();
      const name = String(variant?.name || "").trim();
      return (sku && sku === normalized) || name === normalized;
    });
    return hit ? Math.max(0, Number(hit.stock || 0)) : 0;
  }

  return Math.max(0, Number(product.stock || 0));
}

export function buildInsufficientStockMessage(available, productName = "Product") {
  if (available <= 0) {
    return `${productName} is out of stock`;
  }
  return `Only ${available} unit(s) of ${productName} available`;
}
