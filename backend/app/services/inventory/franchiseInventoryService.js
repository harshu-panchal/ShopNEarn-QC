import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import FranchiseStockMovement from "../../models/franchiseStockMovement.js";
import Product from "../../models/product.js";
import {
  FRANCHISE_STOCK_TYPES,
  franchiseDirectionForType,
  INCOMING_FRANCHISE_TYPES,
  OUTGOING_FRANCHISE_TYPES,
} from "../../constants/inventory.js";
import {
  decrementFranchiseStock,
  incrementFranchiseStock,
} from "./inventoryMovementService.js";

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function getFranchiseInventorySummary(franchisePartnerId) {
  const rows = await FranchiseStockLedger.find({ franchisePartnerId }).lean();
  const productIds = rows.map((r) => r.productId);
  const products = productIds.length
    ? await Product.find(
        { _id: { $in: productIds } },
        { name: 1, price: 1, salePrice: 1, mainImage: 1, galleryImages: 1 },
      ).lean()
    : [];
  const pmap = new Map(products.map((p) => [String(p._id), p]));

  let totalUnits = 0;
  let valuation = 0;
  let lowStock = 0;
  let outOfStock = 0;
  const LOW_THRESHOLD = 5;

  const items = rows.map((row) => {
    const product = pmap.get(String(row.productId)) || null;
    const qty = Number(row.quantity) || 0;
    const price = Number(product?.salePrice ?? product?.price) || 0;
    totalUnits += qty;
    valuation += qty * price;
    if (qty === 0) outOfStock += 1;
    else if (qty <= LOW_THRESHOLD) lowStock += 1;
    return { ...row, product };
  });

  return {
    skuCount: items.length,
    totalUnits,
    valuation: Math.round(valuation),
    lowStock,
    outOfStock,
    items,
  };
}

export async function listFranchiseStockMovements(franchisePartnerId, options = {}) {
  const page = parsePositiveInt(options.page, 1);
  const limit = Math.min(parsePositiveInt(options.limit, 25), 100);
  const skip = (page - 1) * limit;

  const query = { franchisePartnerId };

  if (options.productId) {
    query.productId = options.productId;
  }

  if (options.type) {
    query.type = options.type;
  }

  if (options.direction === "incoming") {
    query.type = { $in: [...INCOMING_FRANCHISE_TYPES] };
    query.quantity = { $gt: 0 };
  } else if (options.direction === "outgoing") {
    query.$or = [
      { type: { $in: [...OUTGOING_FRANCHISE_TYPES] }, quantity: { $lt: 0 } },
      { type: FRANCHISE_STOCK_TYPES.FULFILLMENT },
      { type: FRANCHISE_STOCK_TYPES.DAMAGE },
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
    FranchiseStockMovement.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("productId", "name sku mainImage price salePrice")
      .lean(),
    FranchiseStockMovement.countDocuments(query),
  ]);

  const formatted = items.map((item) => ({
    id: item._id,
    productId: item.productId?._id || item.productId,
    productName: item.productId?.name || "Deleted Product",
    sku: item.productId?.sku || "N/A",
    type: item.type,
    direction: franchiseDirectionForType(item.type),
    quantity: item.quantity,
    quantityLabel:
      item.quantity > 0 ? `+${item.quantity}` : `${item.quantity}`,
    balanceAfter: item.balanceAfter,
    date: item.createdAt,
    note: item.note,
    transferGroupId: item.transferGroupId,
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

export async function adjustFranchiseInventory({
  franchisePartnerId,
  productId,
  type,
  quantity,
  note,
  userId = null,
}) {
  const allowedTypes = [
    FRANCHISE_STOCK_TYPES.DAMAGE,
    FRANCHISE_STOCK_TYPES.CORRECTION,
    FRANCHISE_STOCK_TYPES.RESTOCK,
  ];
  if (!allowedTypes.includes(type)) {
    const err = new Error(`Invalid adjustment type: ${type}`);
    err.statusCode = 400;
    throw err;
  }

  const qtyRaw = Number(quantity) || 0;
  const qty = Math.abs(qtyRaw);
  if (qty <= 0) {
    const err = new Error("Quantity must be non-zero");
    err.statusCode = 400;
    throw err;
  }

  if (type === FRANCHISE_STOCK_TYPES.RESTOCK) {
    const ledger = await incrementFranchiseStock({
      franchisePartnerId,
      productId,
      quantity: qty,
      type,
      note: note || `Manual ${type}`,
      createdBy: userId,
    });
    return { newQuantity: ledger.quantity, ledger };
  }

  if (type === FRANCHISE_STOCK_TYPES.CORRECTION) {
    if (qtyRaw > 0) {
      const ledger = await incrementFranchiseStock({
        franchisePartnerId,
        productId,
        quantity: qty,
        type,
        note: note || "Manual correction (+)",
        createdBy: userId,
      });
      return { newQuantity: ledger.quantity, ledger };
    }
    const ledger = await decrementFranchiseStock({
      franchisePartnerId,
      productId,
      quantity: qty,
      type,
      note: note || "Manual correction (-)",
      createdBy: userId,
    });
    return { newQuantity: ledger.quantity, ledger };
  }

  // DAMAGE — always outgoing
  const ledger = await decrementFranchiseStock({
    franchisePartnerId,
    productId,
    quantity: qty,
    type,
    note: note || `Manual ${type}`,
    createdBy: userId,
  });
  return { newQuantity: ledger.quantity, ledger };
}
