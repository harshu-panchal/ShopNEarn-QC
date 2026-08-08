import mongoose from "mongoose";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Product from "../../models/product.js";
import Order from "../../models/order.js";
import { generateUniquePublicOrderId } from "../orderIdService.js";
import {
  FRANCHISE_IDEMPOTENCY_PREFIX,
  FRANCHISE_STOCK_ORDER_STATUS,
} from "../../constants/franchise.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../../constants/finance.js";
import { WORKFLOW_STATUS } from "../../constants/orderWorkflow.js";
import { debitWallet, creditWallet } from "../finance/walletService.js";
import { listHubCatalogProducts } from "./franchiseCatalogService.js";
import { getFranchiseWalletBalance } from "./franchiseWalletService.js";
import {
  buildInsufficientStockMessage,
  resolveAvailableStock,
  resolveSellingPrice,
} from "../../utils/productStockUtils.js";
import {
  createTransferGroupId,
  decrementHubProductStock,
  incrementFranchiseStock,
  restoreHubProductStock,
} from "../inventory/inventoryMovementService.js";
import { HUB_STOCK_TYPES, FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import { requireCanonicalOrderId } from "../../utils/orderLookup.js";

export async function getFranchiseStockSummary(franchisePartnerId) {
  const rows = await FranchiseStockLedger.find({ franchisePartnerId }).lean();
  const productIds = rows.map((r) => r.productId);
  const products = productIds.length
    ? await Product.find(
        { _id: { $in: productIds } },
        { name: 1, price: 1, salePrice: 1, mainImage: 1, galleryImages: 1, variants: 1 },
      ).lean()
    : [];
  const pmap = new Map(products.map((p) => [String(p._id), p]));
  return rows.map((row) => ({
    ...row,
    product: pmap.get(String(row.productId)) || null,
  }));
}

/**
 * Franchise B2B stock purchase from Harsh's Hub catalog using wallet balance.
 * Creates a Franchise Stock Order in REQUESTED status.
 * Wallet is debited, order is sent to Harsh's Hub seller.
 */
export async function purchaseFranchiseStock({
  franchisePartnerId,
  userId,
  items,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("Cart is empty");
    err.statusCode = 400;
    throw err;
  }

  const partner = await FranchisePartner.findById(franchisePartnerId);
  if (!partner || String(partner.userId) !== String(userId)) {
    const err = new Error("Franchise partner not found");
    err.statusCode = 404;
    throw err;
  }

  if (!partner.hasCompletedFirstTopup) {
    const err = new Error(
      "First top-up must be fulfilled by Admin. Self-purchasing stock is available after your first top-up is completed.",
    );
    err.statusCode = 400;
    err.code = "FIRST_TOPUP_PENDING_ADMIN_SELECTION";
    throw err;
  }

  const catalog = await listHubCatalogProducts({ limit: 2000 });
  const hubProductIds = new Set(catalog.items.map((p) => String(p._id)));

  let totalCost = 0;
  const lineItems = [];
  for (const line of items) {
    const productId = String(line.productId || "");
    const variantSku = String(line.variantSku || "").trim();
    const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
    if (!hubProductIds.has(productId)) {
      const err = new Error("Product is not available in hub catalog");
      err.statusCode = 422;
      throw err;
    }
    const product = catalog.items.find((p) => String(p._id) === productId);

    let variantName = "";
    if (variantSku && Array.isArray(product?.variants)) {
      const hit = product.variants.find(
        (v) => String(v.sku || "").trim() === variantSku || String(v.name || "").trim() === variantSku
      );
      if (hit) variantName = hit.name || "";
    }

    const available = resolveAvailableStock(product, variantSku);
    if (qty > available) {
      const displayName = variantName ? `${product?.name} (${variantName})` : product?.name;
      const err = new Error(buildInsufficientStockMessage(available, displayName));
      err.statusCode = 422;
      err.code = "INSUFFICIENT_STOCK";
      throw err;
    }
    const unitPrice = resolveSellingPrice(product, variantSku);
    const lineTotal = unitPrice * qty;
    totalCost += lineTotal;
    lineItems.push({
      productId,
      variantSku,
      variantName,
      qty,
      unitPrice,
      lineTotal,
      name: variantName ? `${product.name} (${variantName})` : product.name,
    });
  }

  const wallet = await getFranchiseWalletBalance(franchisePartnerId);
  if (wallet.availableBalance < totalCost) {
    const err = new Error("Insufficient franchise wallet balance");
    err.statusCode = 422;
    err.code = "INSUFFICIENT_FRANCHISE_WALLET";
    throw err;
  }

  const session = await mongoose.startSession();
  const transferGroupId = createTransferGroupId();

  try {
    let stockOrderId;
    let stockOrderDocId;
    await session.withTransaction(async () => {
      const idempotencyKey = `${FRANCHISE_IDEMPOTENCY_PREFIX.STOCK_PURCHASE}-${franchisePartnerId}-${Date.now()}`;
      await debitWallet({
        ownerType: OWNER_TYPE.FRANCHISE,
        ownerId: franchisePartnerId,
        amount: totalCost,
        bucket: "available",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_STOCK_PURCHASE,
        ledgerReference: idempotencyKey,
        ledgerDescription: `Franchise stock purchase (${lineItems.length} SKU)`,
        idempotencyKey,
        metadata: { lineItems, transferGroupId },
        syncUserWalletBalance: false,
      });

      const publicOrderId = await generateUniquePublicOrderId({ session });
      const order = await Order.create(
        [
          {
            orderId: publicOrderId,
            customer: userId,
            seller: catalog.hubSellerId,
            address: {
              type: "Work",
              name: partner.displayName || "Franchise",
              address: "Stock purchase",
            },
            items: lineItems.map((l) => ({
              product: l.productId,
              variantSku: l.variantSku || null,
              variantName: l.variantName || null,
              quantity: l.qty,
              price: l.unitPrice,
              name: l.name,
            })),
            isFranchiseStockOrder: true,
            franchisePartnerId,
            franchiseStockStatus: FRANCHISE_STOCK_ORDER_STATUS.REQUESTED,
            status: "pending",
            orderStatus: "pending",
            workflowStatus: WORKFLOW_STATUS.PENDING_HUB_DISPATCH,
            paymentMode: "ONLINE",
            paymentStatus: "PAID",
            pricing: { total: totalCost, grandTotal: totalCost },
          },
        ],
        { session },
      );
      stockOrderDocId = order[0]._id;
      stockOrderId = publicOrderId;
    });

    emitNotificationEvent(NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_REQUESTED, {
      orderId: stockOrderId,
      sellerId: catalog.hubSellerId,
      franchisePartnerId: String(franchisePartnerId),
    });

    return { stockOrderId, stockOrderDocId, totalCost, lineItems, transferGroupId };
  } finally {
    await session.endSession();
  }
}

/**
 * Harsh's Hub seller (or Admin) dispatches a Franchise Stock Order.
 * Hub product stock is decremented and status changes to DISPATCHED_PENDING_RECEIPT.
 * Sends a confirmation request to the franchise partner.
 */
export async function dispatchFranchiseStockOrder({ sellerId, orderId, adminId }) {
  const canonicalOrderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({ orderId: canonicalOrderId, isFranchiseStockOrder: true });
  if (!order) {
    const err = new Error("Franchise stock order not found");
    err.statusCode = 404;
    throw err;
  }
  if (sellerId && String(order.seller) !== String(sellerId)) {
    const err = new Error("Only the hub seller or admin can dispatch this stock order");
    err.statusCode = 403;
    throw err;
  }
  if (order.franchiseStockStatus !== FRANCHISE_STOCK_ORDER_STATUS.REQUESTED) {
    const err = new Error("Stock order is not in REQUESTED state");
    err.statusCode = 422;
    throw err;
  }

  const session = await mongoose.startSession();
  const transferGroupId = createTransferGroupId();
  try {
    await session.withTransaction(async () => {
      for (const item of order.items || []) {
        const productId = item.product?._id || item.product;
        const qty = Math.max(1, Number(item.quantity) || 1);
        if (!productId) continue;

        await decrementHubProductStock({
          productId,
          sellerId: order.seller,
          quantity: qty,
          session,
          type: HUB_STOCK_TYPES.TRANSFER_OUT,
          note: `Transfer to franchise partner (${order.orderId})`,
          orderId: order._id,
          transferGroupId,
          variantSku: item.variantSku || null,
        });
      }

      order.franchiseStockStatus = FRANCHISE_STOCK_ORDER_STATUS.DISPATCHED_PENDING_RECEIPT;
      order.status = "shipped";
      order.orderStatus = "shipped";
      order.workflowStatus = WORKFLOW_STATUS.DISPATCHED_PENDING_RECEIPT;
      order.hubDispatchedAt = new Date();
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }

  emitNotificationEvent(NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_DISPATCHED, {
    orderId: order.orderId,
    userId: String(order.customer),
    franchisePartnerId: String(order.franchisePartnerId),
  });

  return order;
}

/**
 * Franchise Partner approves receipt of products for a dispatched stock order.
 * Updates stock in FranchiseStockLedger and sets status to DELIVERED.
 */
export async function approveFranchiseStockOrderReceipt({ franchisePartnerId, orderId, userId }) {
  const canonicalOrderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({ orderId: canonicalOrderId, isFranchiseStockOrder: true });
  if (!order) {
    const err = new Error("Franchise stock order not found");
    err.statusCode = 404;
    throw err;
  }
  if (franchisePartnerId && String(order.franchisePartnerId) !== String(franchisePartnerId)) {
    const err = new Error("Order does not belong to this franchise partner");
    err.statusCode = 403;
    throw err;
  }
  if (order.franchiseStockStatus !== FRANCHISE_STOCK_ORDER_STATUS.DISPATCHED_PENDING_RECEIPT) {
    const err = new Error("Stock order is not awaiting franchise receipt confirmation");
    err.statusCode = 422;
    throw err;
  }

  const session = await mongoose.startSession();
  const transferGroupId = createTransferGroupId();
  try {
    await session.withTransaction(async () => {
      for (const item of order.items || []) {
        const productId = item.product?._id || item.product;
        const qty = Math.max(1, Number(item.quantity) || 1);
        if (!productId) continue;

        await incrementFranchiseStock({
          franchisePartnerId: order.franchisePartnerId,
          productId,
          quantity: qty,
          session,
          type: FRANCHISE_STOCK_TYPES.TRANSFER_IN,
          note: `Stock purchase received from hub (${order.orderId})`,
          orderId: order._id,
          transferGroupId,
          createdBy: userId || null,
          variantSku: item.variantSku || "",
          variantName: item.variantName || "",
        });
      }

      order.franchiseStockStatus = FRANCHISE_STOCK_ORDER_STATUS.DELIVERED;
      order.status = "delivered";
      order.orderStatus = "delivered";
      order.workflowStatus = WORKFLOW_STATUS.DELIVERED;
      order.franchiseReceivedAt = new Date();
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }

  emitNotificationEvent(NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_RECEIVED, {
    orderId: order.orderId,
    sellerId: String(order.seller),
    franchisePartnerId: String(order.franchisePartnerId),
  });

  return order;
}

/**
 * Cancel a Franchise Stock Order.
 * If dispatched previously, restores Hub product stock.
 * Refunds the total cost back to Franchise wallet.
 */
export async function cancelFranchiseStockOrder({ sellerId, franchisePartnerId, orderId, reason, adminId }) {
  const canonicalOrderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({ orderId: canonicalOrderId, isFranchiseStockOrder: true });
  if (!order) {
    const err = new Error("Franchise stock order not found");
    err.statusCode = 404;
    throw err;
  }

  if (sellerId && String(order.seller) !== String(sellerId)) {
    const err = new Error("Not authorized to cancel this stock order");
    err.statusCode = 403;
    throw err;
  }

  if (franchisePartnerId && String(order.franchisePartnerId) !== String(franchisePartnerId)) {
    const err = new Error("Not authorized to cancel this stock order");
    err.statusCode = 403;
    throw err;
  }

  if (
    ![
      FRANCHISE_STOCK_ORDER_STATUS.REQUESTED,
      FRANCHISE_STOCK_ORDER_STATUS.DISPATCHED_PENDING_RECEIPT,
    ].includes(order.franchiseStockStatus)
  ) {
    const err = new Error("Stock order cannot be cancelled in its current state");
    err.statusCode = 422;
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // If already dispatched, restore Hub seller stock
      if (order.franchiseStockStatus === FRANCHISE_STOCK_ORDER_STATUS.DISPATCHED_PENDING_RECEIPT) {
        for (const item of order.items || []) {
          const productId = item.product?._id || item.product;
          const qty = Math.max(1, Number(item.quantity) || 1);
          if (!productId) continue;
          await restoreHubProductStock({
            productId,
            sellerId: order.seller,
            quantity: qty,
            session,
            note: `Restored stock for cancelled order #${order.orderId}`,
            orderId: order._id,
            variantSku: item.variantSku || null,
          });
        }
      }

      // Refund franchise wallet
      const refundAmount = Number(order.pricing?.grandTotal || order.pricing?.total || 0);
      if (refundAmount > 0) {
        const idempotencyKey = `${FRANCHISE_IDEMPOTENCY_PREFIX.STOCK_PURCHASE}-refund-${order._id}`;
        await creditWallet({
          ownerType: OWNER_TYPE.FRANCHISE,
          ownerId: order.franchisePartnerId,
          amount: refundAmount,
          bucket: "available",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_STOCK_PURCHASE,
          ledgerReference: idempotencyKey,
          ledgerDescription: `Refund for cancelled stock order #${order.orderId}`,
          idempotencyKey,
          metadata: { orderId: String(order._id), reason: reason || "" },
          syncUserWalletBalance: false,
        });
      }

      order.franchiseStockStatus = FRANCHISE_STOCK_ORDER_STATUS.CANCELLED;
      order.status = "cancelled";
      order.orderStatus = "cancelled";
      order.workflowStatus = WORKFLOW_STATUS.CANCELLED;
      if (reason) order.cancelReason = String(reason).slice(0, 240);
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }

  emitNotificationEvent(NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_CANCELLED, {
    orderId: order.orderId,
    userId: String(order.customer),
    franchisePartnerId: String(order.franchisePartnerId),
  });

  return order;
}

/**
 * List Franchise Stock Orders history for Franchise, Seller, or Admin.
 */
export async function listFranchiseStockOrders({
  franchisePartnerId,
  sellerId,
  status,
  page = 1,
  limit = 25,
} = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const query = { isFranchiseStockOrder: true };
  if (franchisePartnerId) query.franchisePartnerId = franchisePartnerId;
  if (sellerId) query.seller = sellerId;
  if (status && status !== "ALL") query.franchiseStockStatus = status;

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("customer", "name phone email")
      .populate("franchisePartnerId", "displayName referralCode phone address")
      .populate("items.product", "name mainImage price salePrice variants")
      .lean(),
    Order.countDocuments(query),
  ]);

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}
