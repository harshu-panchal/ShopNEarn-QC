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
  };
  if (q) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { name: rx },
      { productName: rx },
      { title: rx },
      { description: rx },
      { sku: rx },
      { brand: rx },
    ];
  }

  const [items, total] = await Promise.all([
    Product.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    Product.countDocuments(query),
  ]);

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
