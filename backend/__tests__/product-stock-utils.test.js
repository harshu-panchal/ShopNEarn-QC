import { describe, expect, it } from "@jest/globals";
import {
  assertHydratedItemsStock,
  resolveAvailableStock,
  sumVariantStock,
  syncMasterStockFromVariants,
} from "../app/utils/productStockUtils.js";

describe("productStockUtils", () => {
  const product = {
    name: "Glow Mask",
    stock: 0,
    variants: [{ sku: "glowm-001-apul", name: "1 BOX", stock: 8 }],
  };

  it("limits variant availability by master stock", () => {
    expect(resolveAvailableStock(product, "glowm-001-apul")).toBe(0);
    expect(resolveAvailableStock({ ...product, stock: 5 }, "glowm-001-apul")).toBe(5);
    expect(resolveAvailableStock({ ...product, stock: 20 }, "glowm-001-apul")).toBe(8);
  });

  it("sums variant stock for master sync", () => {
    expect(sumVariantStock(product.variants)).toBe(8);
    const payload = syncMasterStockFromVariants({
      variants: [
        { stock: 3 },
        { stock: 5 },
      ],
    });
    expect(payload.stock).toBe(8);
  });

  it("rejects checkout when master stock is below requested quantity", () => {
    expect(() =>
      assertHydratedItemsStock(
        [
          {
            productId: "p1",
            productName: "Glow Mask",
            variantSku: "glowm-001-apul",
            quantity: 1,
          },
        ],
        new Map([["p1", product]]),
      ),
    ).toThrow(/Insufficient stock for product: Glow Mask/);
  });
});
