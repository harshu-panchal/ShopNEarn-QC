import Product from "../../models/product.js";
import Seller from "../../models/seller.js";
import { getFranchiseConfig, resolveHubSellerId } from "./franchiseConfigService.js";

export async function getHubSeller() {
  const cfg = await getFranchiseConfig();
  const hubId = await resolveHubSellerId(cfg);
  if (!hubId) return null;
  return Seller.findById(hubId).lean();
}

export async function listHubCatalogProducts({ page = 1, limit = 50, q } = {}) {
  const cfg = await getFranchiseConfig();
  const hubId = await resolveHubSellerId(cfg);
  if (!hubId) return { items: [], page: 1, limit, total: 0, totalPages: 0, hubSellerId: null };

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const query = {
    sellerId: hubId,
    status: "active",
  };
  if (q) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ name: rx }, { description: rx }];
  }

  const [rawItems, total] = await Promise.all([
    Product.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    Product.countDocuments(query),
  ]);

  const items = rawItems.map((item) => {
    const variants = Array.isArray(item.variants) ? item.variants : [];
    if (variants.length > 0) {
      const variantSum = variants.reduce((sum, v) => sum + Math.max(0, Number(v.stock || 0)), 0);
      item.stock = Math.max(Number(item.stock || 0), variantSum);
    }
    return item;
  });

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
    hubSellerId: String(hubId),
    hubShopDisplayName: cfg.hubShopDisplayName || "Harsh's Hub",
  };
}

export async function isHubProduct(productId) {
  const cfg = await getFranchiseConfig();
  const hubId = await resolveHubSellerId(cfg);
  if (!hubId || !productId) return false;
  const product = await Product.findById(productId).select({ sellerId: 1 }).lean();
  return product && String(product.sellerId) === String(hubId);
}

export async function cartIsHubOnly(hydratedItems = []) {
  if (!Array.isArray(hydratedItems) || hydratedItems.length === 0) return false;
  const cfg = await getFranchiseConfig();
  const hubId = await resolveHubSellerId(cfg);
  if (!hubId) return false;
  return hydratedItems.every((item) => String(item.sellerId || "") === String(hubId));
}
