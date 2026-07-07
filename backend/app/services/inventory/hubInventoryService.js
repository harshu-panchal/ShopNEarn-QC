import Product from "../../models/product.js";
import StockHistory from "../../models/stockHistory.js";
import {
  HUB_STOCK_TYPES,
  hubDirectionForType,
  INCOMING_HUB_TYPES,
  OUTGOING_HUB_TYPES,
} from "../../constants/inventory.js";

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getHubInventorySummary(sellerId) {
  const products = await Product.find({ sellerId })
    .select("stock price salePrice lowStockAlert")
    .lean();

  let totalUnits = 0;
  let valuation = 0;
  let lowStock = 0;
  let outOfStock = 0;

  for (const p of products) {
    const stock = Number(p.stock) || 0;
    const price = Number(p.salePrice ?? p.price) || 0;
    const threshold = Number(p.lowStockAlert) || 5;
    totalUnits += stock;
    valuation += stock * price;
    if (stock === 0) outOfStock += 1;
    else if (stock <= threshold) lowStock += 1;
  }

  return {
    skuCount: products.length,
    totalUnits,
    valuation: Math.round(valuation),
    lowStock,
    outOfStock,
  };
}

export async function listHubStockMovements(sellerId, options = {}) {
  const page = parsePositiveInt(options.page, 1);
  const limit = Math.min(parsePositiveInt(options.limit, 25), 100);
  const skip = (page - 1) * limit;

  const query = { seller: sellerId };

  if (options.productId) {
    query.product = options.productId;
  }

  if (options.type) {
    query.type = options.type;
  }

  if (options.direction === "incoming") {
    query.type = { $in: [...INCOMING_HUB_TYPES] };
    query.quantity = { $gt: 0 };
  } else if (options.direction === "outgoing") {
    query.$or = [
      { type: { $in: [...OUTGOING_HUB_TYPES] }, quantity: { $lt: 0 } },
      { type: HUB_STOCK_TYPES.SALE },
      { type: HUB_STOCK_TYPES.RESERVATION },
      { type: HUB_STOCK_TYPES.TRANSFER_OUT },
      { type: HUB_STOCK_TYPES.DAMAGE },
    ];
  }

  if (options.startDate || options.endDate) {
    query.createdAt = {};
    if (options.startDate) {
      query.createdAt.$gte = new Date(options.startDate);
    }
    if (options.endDate) {
      const end = new Date(options.endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const [items, total] = await Promise.all([
    StockHistory.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("product", "name sku mainImage")
      .lean(),
    StockHistory.countDocuments(query),
  ]);

  const formatted = items.map((item) => ({
    id: item._id,
    productId: item.product?._id || item.product,
    productName: item.product?.name || "Deleted Product",
    sku: item.product?.sku || "N/A",
    type: item.type,
    direction: hubDirectionForType(item.type),
    quantity: item.quantity,
    quantityLabel:
      item.quantity > 0 ? `+${item.quantity}` : `${item.quantity}`,
    date: item.createdAt,
    note: item.note,
    transferGroupId: item.transferGroupId,
    variantSku: item.variantSku,
    orderId: item.order,
  }));

  return {
    items: formatted,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function adjustHubProductStock({
  sellerId,
  productId,
  type,
  quantity,
  note,
  variantSku = null,
}) {
  const product = await Product.findOne({ _id: productId, sellerId });
  if (!product) {
    const err = new Error("Product not found or unauthorized");
    err.statusCode = 404;
    throw err;
  }

  const allowedTypes = [
    HUB_STOCK_TYPES.RESTOCK,
    HUB_STOCK_TYPES.CORRECTION,
    HUB_STOCK_TYPES.DAMAGE,
  ];
  if (!allowedTypes.includes(type)) {
    const err = new Error(`Invalid adjustment type: ${type}`);
    err.statusCode = 400;
    throw err;
  }

  const qtyAbs = Math.abs(Number(quantity) || 0);
  if (qtyAbs <= 0) {
    const err = new Error("Quantity must be non-zero");
    err.statusCode = 400;
    throw err;
  }

  let signedQty;
  if (type === HUB_STOCK_TYPES.RESTOCK) {
    signedQty = qtyAbs;
  } else if (type === HUB_STOCK_TYPES.DAMAGE) {
    signedQty = -qtyAbs;
  } else if (type === HUB_STOCK_TYPES.CORRECTION) {
    signedQty = Number(quantity) || 0;
    if (signedQty === 0) {
      const err = new Error("Correction quantity cannot be zero");
      err.statusCode = 400;
      throw err;
    }
  } else {
    signedQty = -qtyAbs;
  }

  const previousStock = Number(product.stock) || 0;
  const finalStock = previousStock + signedQty;

  if (finalStock < 0) {
    const err = new Error("Stock cannot be negative");
    err.statusCode = 400;
    throw err;
  }

  product.stock = finalStock;

  if (variantSku && Array.isArray(product.variants) && product.variants.length) {
    const idx = product.variants.findIndex(
      (v) => v.sku === variantSku || v.name === variantSku,
    );
    if (idx >= 0) {
      const vStock = Number(product.variants[idx].stock) || 0;
      const vFinal = vStock + signedQty;
      if (vFinal < 0) {
        const err = new Error("Variant stock cannot be negative");
        err.statusCode = 400;
        throw err;
      }
      product.variants[idx].stock = vFinal;
      product.markModified("variants");
    }
  }

  await product.save();

  const historyEntry = await StockHistory.create({
    product: productId,
    seller: sellerId,
    type,
    quantity: signedQty,
    note: note || `Manual ${type}`,
    variantSku: variantSku || undefined,
  });

  return {
    newStock: product.stock,
    historyEntry,
    previousStock,
  };
}
