import mongoose from "mongoose";
import Product from "../../models/product.js";
import Order from "../../models/order.js";
import StockHistory from "../../models/stockHistory.js";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import FranchiseStockMovement from "../../models/franchiseStockMovement.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Seller from "../../models/seller.js";
import User from "../../models/customer.js";
import { HUB_STOCK_TYPES, FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";
import { getHubInventorySummary, listHubStockMovements } from "./hubInventoryService.js";
import {
  getFranchiseInventorySummary,
  listFranchiseStockMovements,
} from "./franchiseInventoryService.js";

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildDateMatch(startDate, endDate) {
  if (!startDate && !endDate) return null;
  const createdAt = {};
  if (startDate) createdAt.$gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }
  return { createdAt };
}

function toCsv(rows = []) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

async function aggregateTrend(model, match, idField) {
  const rows = await model.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          day: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: "Asia/Kolkata",
            },
          },
        },
        incomingUnits: {
          $sum: {
            $cond: [{ $gt: ["$quantity", 0] }, "$quantity", 0],
          },
        },
        outgoingUnits: {
          $sum: {
            $cond: [{ $lt: ["$quantity", 0] }, { $abs: "$quantity" }, 0],
          },
        },
        movementCount: { $sum: 1 },
      },
    },
    { $sort: { "_id.day": 1 } },
  ]);
  return rows.map((row) => ({
    day: row._id.day,
    incomingUnits: row.incomingUnits,
    outgoingUnits: row.outgoingUnits,
    movementCount: row.movementCount,
    [idField]: true,
  }));
}

export async function getSellerInventoryReport(sellerId, filters = {}) {
  const summary = await getHubInventorySummary(sellerId);
  const movements = await listHubStockMovements(sellerId, filters);
  const dateMatch = buildDateMatch(filters.startDate, filters.endDate);
  const baseMatch = { seller: new mongoose.Types.ObjectId(String(sellerId)) };
  const match = dateMatch ? { ...baseMatch, ...dateMatch } : baseMatch;

  const [restock, shrinkage, lowStock, trends] = await Promise.all([
    StockHistory.aggregate([
      { $match: { ...match, type: HUB_STOCK_TYPES.RESTOCK } },
      {
        $group: {
          _id: null,
          units: { $sum: "$quantity" },
          events: { $sum: 1 },
        },
      },
    ]),
    StockHistory.aggregate([
      { $match: { ...match, type: HUB_STOCK_TYPES.DAMAGE } },
      {
        $group: {
          _id: null,
          units: { $sum: { $abs: "$quantity" } },
          events: { $sum: 1 },
        },
      },
    ]),
    Product.find({
      sellerId,
      $expr: { $lte: ["$stock", { $ifNull: ["$lowStockAlert", 5] }] },
    })
      .select("name sku stock lowStockAlert price salePrice")
      .sort({ stock: 1 })
      .lean(),
    aggregateTrend(StockHistory, match, "seller"),
  ]);

  return {
    summary,
    movements,
    restock: restock[0] || { units: 0, events: 0 },
    shrinkage: shrinkage[0] || { units: 0, events: 0 },
    lowStock,
    trends,
  };
}

export async function getHubB2BTransferReport(hubSellerId, filters = {}) {
  const page = parsePositiveInt(filters.page, 1);
  const limit = Math.min(parsePositiveInt(filters.limit, 25), 100);
  const skip = (page - 1) * limit;
  const dateMatch = buildDateMatch(filters.startDate, filters.endDate);

  const query = {
    seller: hubSellerId,
    type: HUB_STOCK_TYPES.TRANSFER_OUT,
  };
  if (dateMatch) Object.assign(query, dateMatch);

  const [movements, total, orders] = await Promise.all([
    StockHistory.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("product", "name sku")
      .lean(),
    StockHistory.countDocuments(query),
    Order.find({ isFranchiseStockOrder: true, seller: hubSellerId })
      .select(
        "orderId franchisePartnerId pricing.total paymentBreakdown.grandTotal items createdAt",
      )
      .populate("franchisePartnerId", "displayName referralCode")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
  ]);

  const purchaseTotals = orders.reduce(
    (acc, row) => {
      const amount = Number(row?.paymentBreakdown?.grandTotal ?? row?.pricing?.total) || 0;
      const units = Array.isArray(row.items)
        ? row.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
        : 0;
      acc.totalAmount += amount;
      acc.totalUnits += units;
      return acc;
    },
    { totalAmount: 0, totalUnits: 0 },
  );

  return {
    summary: {
      transferEvents: total,
      transferUnits: movements.reduce((sum, m) => sum + Math.abs(Number(m.quantity) || 0), 0),
      purchaseOrders: orders.length,
      purchaseAmount: Math.round(purchaseTotals.totalAmount),
      purchaseUnits: purchaseTotals.totalUnits,
    },
    transfers: {
      items: movements.map((row) => ({
        id: row._id,
        transferGroupId: row.transferGroupId || null,
        productName: row.product?.name || "Deleted Product",
        sku: row.product?.sku || "N/A",
        quantity: Math.abs(Number(row.quantity) || 0),
        note: row.note || "",
        createdAt: row.createdAt,
      })),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
    purchases: orders.map((row) => ({
      id: row._id,
      orderId: row.orderId,
      partnerName:
        row.franchisePartnerId?.displayName || row.franchisePartnerId?.referralCode || "Unknown",
      amount: Number(row?.paymentBreakdown?.grandTotal ?? row?.pricing?.total) || 0,
      itemCount: Array.isArray(row.items) ? row.items.length : 0,
      createdAt: row.createdAt,
    })),
  };
}

export async function getTransferReconciliationReport({ hubSellerId, transferGroupId } = {}) {
  const hubQuery = { type: HUB_STOCK_TYPES.TRANSFER_OUT };
  if (hubSellerId) hubQuery.seller = hubSellerId;
  if (transferGroupId) hubQuery.transferGroupId = transferGroupId;

  const [hubRows, franchiseRows] = await Promise.all([
    StockHistory.find(hubQuery)
      .select("transferGroupId quantity seller product createdAt")
      .lean(),
    FranchiseStockMovement.find(
      transferGroupId
        ? { transferGroupId, type: FRANCHISE_STOCK_TYPES.TRANSFER_IN }
        : { type: FRANCHISE_STOCK_TYPES.TRANSFER_IN },
    )
      .select("transferGroupId quantity franchisePartnerId productId createdAt")
      .lean(),
  ]);

  const map = new Map();
  for (const row of hubRows) {
    const key = row.transferGroupId || `hub-${row._id}`;
    map.set(key, {
      transferGroupId: row.transferGroupId || null,
      hubQuantity: Math.abs(Number(row.quantity) || 0),
      franchiseQuantity: 0,
      hubCreatedAt: row.createdAt,
      franchiseCreatedAt: null,
      matched: false,
    });
  }
  for (const row of franchiseRows) {
    const key = row.transferGroupId || `fr-${row._id}`;
    if (!map.has(key)) {
      map.set(key, {
        transferGroupId: row.transferGroupId || null,
        hubQuantity: 0,
        franchiseQuantity: Number(row.quantity) || 0,
        hubCreatedAt: null,
        franchiseCreatedAt: row.createdAt,
        matched: false,
      });
      continue;
    }
    const existing = map.get(key);
    existing.franchiseQuantity = Number(row.quantity) || 0;
    existing.franchiseCreatedAt = row.createdAt;
    existing.matched = existing.hubQuantity === Math.abs(existing.franchiseQuantity);
  }

  const items = [...map.values()];
  return {
    summary: {
      total: items.length,
      matched: items.filter((x) => x.matched).length,
      unmatched: items.filter((x) => !x.matched).length,
    },
    items,
  };
}

export async function getFranchiseInventoryReport(franchisePartnerId, filters = {}) {
  const summary = await getFranchiseInventorySummary(franchisePartnerId);
  const movements = await listFranchiseStockMovements(franchisePartnerId, filters);
  const dateMatch = buildDateMatch(filters.startDate, filters.endDate);
  const match = {
    franchisePartnerId: new mongoose.Types.ObjectId(String(franchisePartnerId)),
    ...(dateMatch || {}),
  };
  const [stockPurchases, fulfillment, trends] = await Promise.all([
    Order.find({ franchisePartnerId, isFranchiseStockOrder: true })
      .select("orderId items paymentBreakdown.grandTotal pricing.total createdAt")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    FranchiseStockMovement.aggregate([
      { $match: { ...match, type: FRANCHISE_STOCK_TYPES.FULFILLMENT } },
      {
        $group: {
          _id: null,
          units: { $sum: { $abs: "$quantity" } },
          events: { $sum: 1 },
        },
      },
    ]),
    aggregateTrend(FranchiseStockMovement, match, "franchise"),
  ]);

  return {
    summary,
    movements,
    stockPurchases: stockPurchases.map((row) => ({
      orderId: row.orderId,
      amount: Number(row?.paymentBreakdown?.grandTotal ?? row?.pricing?.total) || 0,
      itemCount: Array.isArray(row.items) ? row.items.length : 0,
      units: Array.isArray(row.items)
        ? row.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
        : 0,
      createdAt: row.createdAt,
    })),
    fulfillment: fulfillment[0] || { units: 0, events: 0 },
    trends,
  };
}

export async function getCustomerRetailPurchaseReport(customerId, filters = {}) {
  const page = parsePositiveInt(filters.page, 1);
  const limit = Math.min(parsePositiveInt(filters.limit, 20), 100);
  const skip = (page - 1) * limit;
  const dateMatch = buildDateMatch(filters.startDate, filters.endDate);
  const query = {
    customer: customerId,
    isFranchiseStockOrder: { $ne: true },
  };
  if (dateMatch) Object.assign(query, dateMatch);

  const [orders, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("orderId items paymentBreakdown.grandTotal pricing.total createdAt")
      .populate("items.product", "name categoryId")
      .lean(),
    Order.countDocuments(query),
  ]);

  const lines = orders.flatMap((order) =>
    (order.items || []).map((item) => ({
      orderId: order.orderId,
      productId: item.product?._id || null,
      productName: item.name || item.product?.name || "Product",
      quantity: Number(item.quantity) || 0,
      price: Number(item.price) || 0,
      amount: (Number(item.quantity) || 0) * (Number(item.price) || 0),
      createdAt: order.createdAt,
    })),
  );

  const spend = orders.reduce(
    (sum, row) => sum + (Number(row?.paymentBreakdown?.grandTotal ?? row?.pricing?.total) || 0),
    0,
  );

  const topProductMap = new Map();
  for (const row of lines) {
    const key = row.productId ? String(row.productId) : row.productName;
    const existing = topProductMap.get(key) || {
      productName: row.productName,
      units: 0,
      spend: 0,
    };
    existing.units += row.quantity;
    existing.spend += row.amount;
    topProductMap.set(key, existing);
  }

  const topProducts = [...topProductMap.values()]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  return {
    summary: {
      totalOrders: total,
      totalSpend: Math.round(spend),
      averageOrderValue: total ? Math.round(spend / total) : 0,
      totalItems: lines.reduce((sum, row) => sum + row.quantity, 0),
    },
    topProducts,
    lines: {
      items: lines,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getAdminInventoryReport(filters = {}) {
  const dateMatch = buildDateMatch(filters.startDate, filters.endDate);
  const [sellerCount, franchiseCount, retailOrders, b2bOrders, hubSellers] = await Promise.all([
    Seller.countDocuments({ isActive: true }),
    FranchisePartner.countDocuments({}),
    Order.countDocuments({
      isFranchiseStockOrder: { $ne: true },
      ...(dateMatch || {}),
    }),
    Order.countDocuments({
      isFranchiseStockOrder: true,
      ...(dateMatch || {}),
    }),
    Seller.find({ $or: [{ isPlatformHub: true }, { isFranchiseCatalogSource: true }] })
      .select("_id shopName")
      .lean(),
  ]);

  return {
    overview: {
      activeSellers: sellerCount,
      activeFranchisePartners: franchiseCount,
      retailOrders,
      b2bPurchaseOrders: b2bOrders,
      hubsConfigured: hubSellers.length,
    },
    hubs: hubSellers,
  };
}

export async function getAdminSellerRows(filters = {}) {
  const sellers = await Seller.find({ isActive: true })
    .select("_id name shopName isPlatformHub isFranchiseCatalogSource")
    .sort({ shopName: 1 })
    .lean();
  const rows = await Promise.all(
    sellers.map(async (seller) => {
      const summary = await getHubInventorySummary(seller._id);
      return {
        sellerId: seller._id,
        sellerName: seller.shopName || seller.name,
        skuCount: summary.skuCount,
        totalUnits: summary.totalUnits,
        valuation: summary.valuation,
        lowStock: summary.lowStock,
        outOfStock: summary.outOfStock,
        isHub: Boolean(seller.isPlatformHub || seller.isFranchiseCatalogSource),
      };
    }),
  );
  return rows;
}

export async function getAdminFranchiseRows() {
  const partners = await FranchisePartner.find({})
    .select("_id displayName referralCode userId")
    .sort({ createdAt: -1 })
    .lean();
  const rows = await Promise.all(
    partners.map(async (partner) => {
      const summary = await getFranchiseInventorySummary(partner._id);
      return {
        partnerId: partner._id,
        partnerName: partner.displayName || partner.referralCode,
        skuCount: summary.skuCount,
        totalUnits: summary.totalUnits,
        valuation: summary.valuation,
        lowStock: summary.lowStock,
        outOfStock: summary.outOfStock,
      };
    }),
  );
  return rows;
}

export async function getAdminCustomerRetailRows(filters = {}) {
  const dateMatch = buildDateMatch(filters.startDate, filters.endDate);
  const query = { isFranchiseStockOrder: { $ne: true } };
  if (dateMatch) Object.assign(query, dateMatch);
  const orders = await Order.find(query)
    .select("orderId customer items paymentBreakdown.grandTotal pricing.total createdAt")
    .populate("customer", "name phone email")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  return orders.map((order) => ({
    orderId: order.orderId,
    customerName: order.customer?.name || "Customer",
    customerPhone: order.customer?.phone || "",
    amount: Number(order?.paymentBreakdown?.grandTotal ?? order?.pricing?.total) || 0,
    itemCount: Array.isArray(order.items) ? order.items.length : 0,
    createdAt: order.createdAt,
  }));
}

export async function exportReportCsv(reportType, payload = {}) {
  switch (reportType) {
    case "seller-overview":
      return toCsv((payload.lowStock || []).map((item) => ({
        productName: item.name || "",
        sku: item.sku || "",
        stock: Number(item.stock) || 0,
        threshold: Number(item.lowStockAlert) || 0,
      })));
    case "movements":
      return toCsv((payload.items || []).map((row) => ({
        productName: row.productName || "",
        sku: row.sku || "",
        type: row.type || "",
        direction: row.direction || "",
        quantity: row.quantity || 0,
        date: row.date || row.createdAt || "",
        transferGroupId: row.transferGroupId || "",
      })));
    case "orders":
      return toCsv(payload.rows || []);
    default:
      return toCsv(payload.rows || []);
  }
}

export async function getAdminB2BPurchaseRows(filters = {}) {
  const dateMatch = buildDateMatch(filters.startDate, filters.endDate);
  const query = { isFranchiseStockOrder: true };
  if (dateMatch) Object.assign(query, dateMatch);
  const orders = await Order.find(query)
    .select("orderId franchisePartnerId seller items paymentBreakdown.grandTotal pricing.total createdAt")
    .populate("franchisePartnerId", "displayName referralCode")
    .populate("seller", "shopName name")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  return orders.map((row) => ({
    orderId: row.orderId,
    partnerName:
      row.franchisePartnerId?.displayName || row.franchisePartnerId?.referralCode || "Unknown",
    sellerName: row.seller?.shopName || row.seller?.name || "Seller",
    amount: Number(row?.paymentBreakdown?.grandTotal ?? row?.pricing?.total) || 0,
    itemCount: Array.isArray(row.items) ? row.items.length : 0,
    createdAt: row.createdAt,
  }));
}

export async function getAdminHubRows(filters = {}) {
  const hubs = await Seller.find({ $or: [{ isPlatformHub: true }, { isFranchiseCatalogSource: true }] })
    .select("_id shopName name")
    .lean();
  const items = await Promise.all(
    hubs.map(async (hub) => {
      const report = await getHubB2BTransferReport(hub._id, filters);
      return {
        hubId: hub._id,
        hubName: hub.shopName || hub.name,
        transferEvents: report.summary.transferEvents,
        transferUnits: report.summary.transferUnits,
        purchaseOrders: report.summary.purchaseOrders,
        purchaseAmount: report.summary.purchaseAmount,
      };
    }),
  );
  return items;
}

export async function getCustomerReportRows(filters = {}) {
  const page = parsePositiveInt(filters.page, 1);
  const limit = Math.min(parsePositiveInt(filters.limit, 100), 500);
  const skip = (page - 1) * limit;
  const users = await User.find({})
    .select("_id name phone")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const rows = await Promise.all(
    users.map(async (user) => {
      const data = await getCustomerRetailPurchaseReport(user._id, filters);
      return {
        customerId: user._id,
        customerName: user.name || "Customer",
        phone: user.phone || "",
        totalOrders: data.summary.totalOrders,
        totalSpend: data.summary.totalSpend,
        avgOrderValue: data.summary.averageOrderValue,
      };
    }),
  );
  return rows;
}
