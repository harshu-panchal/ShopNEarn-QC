import mongoose from "mongoose";
import LedgerEntry from "../../models/ledgerEntry.js";
import FranchiseWalletTopUp from "../../models/franchiseWalletTopUp.js";
import Order from "../../models/order.js";
import {
  OWNER_TYPE,
  LEDGER_TRANSACTION_TYPE,
  ORDER_PAYMENT_STATUS,
} from "../../constants/finance.js";
import { FRANCHISE_TOPUP_STATUS } from "../../constants/franchise.js";
import { getFranchiseWalletBalance } from "./franchiseWalletService.js";

export const FRANCHISE_TRANSACTION_CATEGORIES = [
  { value: "all", label: "All" },
  { value: "topup", label: "Wallet Top-ups" },
  { value: "stock", label: "Stock Purchases" },
  { value: "orders", label: "Customer Orders" },
  { value: "adjustment", label: "Adjustments" },
];

const FRANCHISE_LEDGER_TYPES = [
  LEDGER_TRANSACTION_TYPE.FRANCHISE_REGISTRATION_PAYMENT,
  LEDGER_TRANSACTION_TYPE.FRANCHISE_WALLET_TOPUP_CREDIT,
  LEDGER_TRANSACTION_TYPE.FRANCHISE_STOCK_PURCHASE,
  LEDGER_TRANSACTION_TYPE.FRANCHISE_MANUAL_ADJUSTMENT,
];

const WALLET_ONLY_CATEGORIES = new Set(["topup", "stock", "adjustment", "registration"]);

function categoryLedgerFilter(category) {
  switch (String(category || "").toLowerCase()) {
    case "topup":
      return { type: LEDGER_TRANSACTION_TYPE.FRANCHISE_WALLET_TOPUP_CREDIT };
    case "stock":
      return { type: LEDGER_TRANSACTION_TYPE.FRANCHISE_STOCK_PURCHASE };
    case "adjustment":
      return { type: LEDGER_TRANSACTION_TYPE.FRANCHISE_MANUAL_ADJUSTMENT };
    case "registration":
      return { type: LEDGER_TRANSACTION_TYPE.FRANCHISE_REGISTRATION_PAYMENT };
    default:
      return { type: { $in: FRANCHISE_LEDGER_TYPES } };
  }
}

function customerOrderQuery(franchisePartnerId) {
  return {
    franchisePartnerId,
    isFranchiseStockOrder: { $ne: true },
    paymentStatus: { $ne: ORDER_PAYMENT_STATUS.CREATED },
  };
}

function orderTotalAmount(order) {
  return Number(
    order.paymentBreakdown?.grandTotal ??
      order.pricing?.grandTotal ??
      order.pricing?.total ??
      0,
  );
}

function formatLedgerRow(row) {
  return {
    id: String(row._id),
    source: "ledger",
    transactionId: row.transactionId,
    type: row.type,
    direction: row.direction,
    amount: row.amount,
    status: row.status || "COMPLETED",
    description: row.description || null,
    reference: row.reference || null,
    orderId: row.orderId ? String(row.orderId) : null,
    balanceBefore: row.balanceBefore,
    balanceAfter: row.balanceAfter,
    metadata: row.metadata || {},
    createdAt: row.createdAt,
  };
}

function formatTopUpRow(topUp) {
  const multiplier = topUp.creditMultiplierSnapshot || 2;
  return {
    id: `topup-${topUp._id}`,
    source: "topup_request",
    type: "FRANCHISE_WALLET_TOPUP_REQUEST",
    direction: "NEUTRAL",
    amount: topUp.amount,
    status: topUp.status,
    description: `Wallet top-up request — ${topUp.status === FRANCHISE_TOPUP_STATUS.REJECTED ? "rejected" : "awaiting admin review"}`,
    reference: String(topUp._id),
    orderId: null,
    balanceBefore: null,
    balanceAfter: null,
    metadata: {
      depositedAmount: topUp.amount,
      multiplier,
      expectedCredit: Math.round(topUp.amount * multiplier * 100) / 100,
      rejectionReason: topUp.rejectionReason || null,
    },
    createdAt: topUp.updatedAt || topUp.createdAt,
  };
}

function formatOrderRow(order) {
  return {
    id: `order-${order._id}`,
    source: "customer_order",
    type: "FRANCHISE_CUSTOMER_ORDER",
    direction: "NEUTRAL",
    amount: orderTotalAmount(order),
    status: order.franchiseStatus || "pending",
    description: `Customer order ${order.orderId}`,
    reference: order.orderId,
    orderId: String(order._id),
    orderNumber: order.orderId,
    balanceBefore: null,
    balanceAfter: null,
    metadata: {
      customerName: order.customer?.name || null,
      paymentMode: order.paymentMode || null,
      paymentStatus: order.paymentStatus || null,
      itemCount: order.items?.length || 0,
      franchiseStatus: order.franchiseStatus || "pending",
    },
    createdAt: order.createdAt,
  };
}

async function attachOrderNumbers(items) {
  const orderIds = items.filter((row) => row.orderId).map((row) => row.orderId);
  if (!orderIds.length) return items;

  const orders = await Order.find({ _id: { $in: orderIds } })
    .select("orderId pricing.total paymentBreakdown")
    .lean();
  const orderMap = Object.fromEntries(orders.map((order) => [String(order._id), order]));
  return items.map((item) => ({
    ...item,
    orderNumber: item.orderNumber || (item.orderId ? orderMap[item.orderId]?.orderId || null : null),
  }));
}

async function buildLedgerQuery(franchisePartnerId, { category, direction } = {}) {
  const { walletId } = await getFranchiseWalletBalance(franchisePartnerId);
  const query = {
    walletId,
    actorType: OWNER_TYPE.FRANCHISE,
    actorId: new mongoose.Types.ObjectId(String(franchisePartnerId)),
    ...categoryLedgerFilter(category),
  };
  if (direction && ["CREDIT", "DEBIT"].includes(String(direction).toUpperCase())) {
    query.direction = String(direction).toUpperCase();
  }
  return query;
}

async function listLedgerTransactions(
  franchisePartnerId,
  { page, limit, direction, category, includePendingTopUps },
) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const baseQuery = await buildLedgerQuery(franchisePartnerId, { category, direction });

  const showPendingTopUps =
    includePendingTopUps &&
    safePage === 1 &&
    (!category || category === "all" || category === "topup") &&
    !direction;

  const [ledgerRows, ledgerTotal, pendingTopUps] = await Promise.all([
    LedgerEntry.find(baseQuery).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    LedgerEntry.countDocuments(baseQuery),
    showPendingTopUps
      ? FranchiseWalletTopUp.find({
          franchisePartnerId,
          status: {
            $in: [
              FRANCHISE_TOPUP_STATUS.CREATED,
              FRANCHISE_TOPUP_STATUS.PENDING_REVIEW,
              FRANCHISE_TOPUP_STATUS.REJECTED,
            ],
          },
        })
          .sort({ updatedAt: -1 })
          .limit(20)
          .lean()
      : Promise.resolve([]),
  ]);

  let items = ledgerRows.map(formatLedgerRow);
  if (pendingTopUps.length) {
    items = [...pendingTopUps.map(formatTopUpRow), ...items];
  }
  items = await attachOrderNumbers(items);

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total: ledgerTotal,
    totalPages: Math.ceil(ledgerTotal / safeLimit) || 1,
    categories: FRANCHISE_TRANSACTION_CATEGORIES,
  };
}

async function listOrderTransactions(franchisePartnerId, { page, limit }) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const query = customerOrderQuery(franchisePartnerId);

  const [orders, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("customer", "name phone")
      .lean(),
    Order.countDocuments(query),
  ]);

  return {
    items: orders.map(formatOrderRow),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
    categories: FRANCHISE_TRANSACTION_CATEGORIES,
  };
}

async function hydrateMergedSlice(slice) {
  const ledgerIds = slice.filter((row) => row.kind === "ledger").map((row) => row.id);
  const orderIds = slice.filter((row) => row.kind === "order").map((row) => row.id);
  const topUpIds = slice.filter((row) => row.kind === "topup").map((row) => row.id);

  const [ledgers, orders, topUps] = await Promise.all([
    ledgerIds.length
      ? LedgerEntry.find({ _id: { $in: ledgerIds } }).lean()
      : Promise.resolve([]),
    orderIds.length
      ? Order.find({ _id: { $in: orderIds } }).populate("customer", "name phone").lean()
      : Promise.resolve([]),
    topUpIds.length
      ? FranchiseWalletTopUp.find({ _id: { $in: topUpIds } }).lean()
      : Promise.resolve([]),
  ]);

  const ledgerMap = Object.fromEntries(ledgers.map((row) => [String(row._id), row]));
  const orderMap = Object.fromEntries(orders.map((row) => [String(row._id), row]));
  const topUpMap = Object.fromEntries(topUps.map((row) => [String(row._id), row]));

  return slice
    .map((entry) => {
      if (entry.kind === "ledger") {
        const row = ledgerMap[String(entry.id)];
        return row ? formatLedgerRow(row) : null;
      }
      if (entry.kind === "order") {
        const row = orderMap[String(entry.id)];
        return row ? formatOrderRow(row) : null;
      }
      if (entry.kind === "topup") {
        const row = topUpMap[String(entry.id)];
        return row ? formatTopUpRow(row) : null;
      }
      return null;
    })
    .filter(Boolean);
}

async function listMergedTransactions(franchisePartnerId, { page, limit }) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const ledgerQuery = await buildLedgerQuery(franchisePartnerId, { category: "all" });
  const orderQuery = customerOrderQuery(franchisePartnerId);

  const [ledgerMeta, orderMeta, pendingTopUps] = await Promise.all([
    LedgerEntry.find(ledgerQuery).select("_id createdAt").sort({ createdAt: -1 }).lean(),
    Order.find(orderQuery).select("_id createdAt").sort({ createdAt: -1 }).lean(),
    FranchiseWalletTopUp.find({
      franchisePartnerId,
      status: {
        $in: [
          FRANCHISE_TOPUP_STATUS.CREATED,
          FRANCHISE_TOPUP_STATUS.PENDING_REVIEW,
          FRANCHISE_TOPUP_STATUS.REJECTED,
        ],
      },
    })
      .select("_id updatedAt createdAt")
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  const mergedMeta = [
    ...ledgerMeta.map((row) => ({
      kind: "ledger",
      id: row._id,
      at: row.createdAt,
    })),
    ...orderMeta.map((row) => ({
      kind: "order",
      id: row._id,
      at: row.createdAt,
    })),
    ...pendingTopUps.map((row) => ({
      kind: "topup",
      id: row._id,
      at: row.updatedAt || row.createdAt,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const total = mergedMeta.length;
  const slice = mergedMeta.slice(skip, skip + safeLimit);
  let items = await hydrateMergedSlice(slice);
  items = await attachOrderNumbers(items);

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
    categories: FRANCHISE_TRANSACTION_CATEGORIES,
  };
}

export async function listFranchiseTransactionHistory(
  franchisePartnerId,
  { page = 1, limit = 25, direction = null, category = null } = {},
) {
  const normalizedCategory = String(category || "all").toLowerCase();

  if (normalizedCategory === "orders") {
    return listOrderTransactions(franchisePartnerId, { page, limit });
  }

  if (
    direction &&
    ["CREDIT", "DEBIT"].includes(String(direction).toUpperCase())
  ) {
    return listLedgerTransactions(franchisePartnerId, {
      page,
      limit,
      direction,
      category: WALLET_ONLY_CATEGORIES.has(normalizedCategory)
        ? normalizedCategory
        : "all",
      includePendingTopUps: normalizedCategory === "all" || normalizedCategory === "topup",
    });
  }

  if (WALLET_ONLY_CATEGORIES.has(normalizedCategory)) {
    return listLedgerTransactions(franchisePartnerId, {
      page,
      limit,
      direction,
      category: normalizedCategory,
      includePendingTopUps: normalizedCategory === "topup",
    });
  }

  return listMergedTransactions(franchisePartnerId, { page, limit });
}
