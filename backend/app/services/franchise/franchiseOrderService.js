import Order from "../../models/order.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Seller from "../../models/seller.js";
import Delivery from "../../models/delivery.js";
import mongoose from "mongoose";
import {
  FRANCHISE_ORDER_STATUS,
  FRANCHISE_HUB_ACCEPTANCE_STATUS,
  FRANCHISE_SHIPMENT_STATUS,
} from "../../constants/franchise.js";
import {
  WORKFLOW_STATUS,
  legacyStatusFromWorkflow,
} from "../../constants/orderWorkflow.js";
import { ORDER_PAYMENT_STATUS } from "../../constants/finance.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { emitOrderStatusUpdate } from "../orderSocketEmitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import logger from "../logger.js";
import { requireCanonicalOrderId } from "../../utils/orderLookup.js";
import {
  decrementFranchiseStock,
  restoreFranchiseStock,
} from "../inventory/inventoryMovementService.js";
import { FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";
import { getHubSellerId } from "./franchiseConfigService.js";

/**
 * Restore franchise ledger stock if this order had consumed inventory on fulfill.
 * Idempotent via order.franchiseStockConsumed.
 */
export async function restoreFranchiseStockForOrder(order, { session } = {}) {
  if (!order?.franchisePartnerId || order.isFranchiseStockOrder) {
    return order;
  }
  if (!order.franchiseStockConsumed) {
    return order;
  }

  const run = async (sess) => {
    for (const item of order.items || []) {
      const productId = item.product?._id || item.product;
      const qty = Math.max(1, Number(item.quantity) || 1);
      if (!productId) continue;
      await restoreFranchiseStock({
        franchisePartnerId: order.franchisePartnerId,
        productId,
        quantity: qty,
        session: sess,
        type: FRANCHISE_STOCK_TYPES.RETURN_IN,
        note: `Order #${order.orderId} cancelled — stock restored`,
        orderId: order._id,
      });
    }
    order.franchiseStockConsumed = false;
    await order.save({ session: sess });
  };

  if (session) {
    await run(session);
  } else {
    const localSession = await mongoose.startSession();
    try {
      await localSession.withTransaction(() => run(localSession));
    } finally {
      await localSession.endSession();
    }
  }

  return order;
}

export async function listFranchisePartnerOrders(
  franchisePartnerId,
  { status, page = 1, limit = 25 } = {},
) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const query = {
    franchisePartnerId,
    isFranchiseStockOrder: { $ne: true },
    isFranchisePosSale: { $ne: true },
    // Online gateway orders stay hidden until payment is captured.
    paymentStatus: { $ne: ORDER_PAYMENT_STATUS.CREATED },
  };
  if (status) query.franchiseStatus = status;

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("customer", "name phone")
      .populate("items.product", "name mainImage price salePrice")
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

async function assertPartnerOwnsOrder(franchisePartnerId, orderId) {
  const order = await Order.findById(orderId);
  if (
    !order ||
    String(order.franchisePartnerId) !== String(franchisePartnerId)
  ) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }
  return order;
}

async function loadFranchisePartnerUserId(franchisePartnerId) {
  const partner = await FranchisePartner.findById(franchisePartnerId)
    .select("userId displayName")
    .lean();
  return partner?.userId ? String(partner.userId) : null;
}

export async function acceptFranchiseOrder({ franchisePartnerId, orderId }) {
  const order = await assertPartnerOwnsOrder(franchisePartnerId, orderId);
  if (
    order.paymentMode === "ONLINE" &&
    order.paymentStatus !== ORDER_PAYMENT_STATUS.PAID
  ) {
    const err = new Error("Order payment is not completed yet");
    err.statusCode = 422;
    err.code = "PAYMENT_NOT_CAPTURED";
    throw err;
  }
  if (order.franchiseStatus !== FRANCHISE_ORDER_STATUS.PENDING) {
    const err = new Error("Order is not awaiting franchise acceptance");
    err.statusCode = 422;
    throw err;
  }

  const now = new Date();
  order.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
  order.hubAcceptanceStatus = FRANCHISE_HUB_ACCEPTANCE_STATUS.ACCEPTED;
  order.hubAcceptedAt = now;
  order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.PENDING;
  order.shipmentCreatedAt = null;
  order.shipmentReference = null;
  order.workflowStatus = WORKFLOW_STATUS.FRANCHISE_ACCEPTED;
  order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.FRANCHISE_ACCEPTED);
  order.orderStatus = order.status;
  order.acceptedAt = now;
  await order.save();

  emitOrderStatusUpdate(
    order.orderId,
    { workflowStatus: order.workflowStatus },
    order.customer,
  );

  return order;
}

export async function rerouteOrTransferFranchiseOrder(order, { currentPartnerId, reason = "" } = {}) {
  const now = new Date();

  if (Array.isArray(order.routedFranchiseHistory)) {
    const currentHist = order.routedFranchiseHistory.find(
      (h) => String(h.franchisePartnerId) === String(currentPartnerId) && h.status === "PENDING"
    );
    if (currentHist) {
      currentHist.status = "REJECTED";
      currentHist.respondedAt = now;
      currentHist.reason = String(reason || "").slice(0, 240);
    }
  }

  if (order.franchiseStockConsumed) {
    await restoreFranchiseStockForOrder(order);
  }

  const candidates = Array.isArray(order.franchiseCandidates) ? order.franchiseCandidates : [];
  const currentIndex = typeof order.currentFranchiseIndex === "number" ? order.currentFranchiseIndex : 0;
  const nextIndex = currentIndex + 1;

  if (nextIndex < candidates.length && nextIndex < 5) {
    const nextPartnerId = candidates[nextIndex];
    order.currentFranchiseIndex = nextIndex;
    order.franchisePartnerId = nextPartnerId;
    order.franchiseRoutedAt = now;
    order.franchiseStatus = FRANCHISE_ORDER_STATUS.PENDING;
    order.hubAcceptanceStatus = null;
    order.workflowStatus = WORKFLOW_STATUS.FRANCHISE_PENDING;
    order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.FRANCHISE_PENDING);
    order.orderStatus = order.status;

    if (!Array.isArray(order.routedFranchiseHistory)) order.routedFranchiseHistory = [];
    order.routedFranchiseHistory.push({
      franchisePartnerId: nextPartnerId,
      status: "PENDING",
      routedAt: now,
    });

    await order.save();

    emitOrderStatusUpdate(
      order.orderId,
      { workflowStatus: order.workflowStatus, franchisePartnerId: String(nextPartnerId) },
      order.customer,
    );

    const nextPartner = await FranchisePartner.findById(nextPartnerId).select("userId displayName").lean();
    if (nextPartner?.userId) {
      emitNotificationEvent(NOTIFICATION_EVENTS.FRANCHISE_NEW_ORDER, {
        userId: String(nextPartner.userId),
        orderId: order.orderId,
        data: { orderId: String(order._id), publicOrderId: order.orderId },
      });
    }

    emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_STATUS_CHANGED, {
      orderId: order.orderId,
      customerId: order.customer,
      userId: order.customer,
      customerMessage: "Your order is being rerouted to another nearby Home Shoppy partner.",
    });

    return order;
  }

  const configuredHubId = await getHubSellerId();
  order.franchisePartnerId = null;
  if (configuredHubId) {
    order.seller = configuredHubId;
  }
  order.franchiseStatus = "passed_to_hub";
  order.hubAcceptanceStatus = null;
  order.workflowStatus = WORKFLOW_STATUS.PENDING_SELLER;
  order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.PENDING_SELLER);
  order.orderStatus = order.status;

  if (!Array.isArray(order.routedFranchiseHistory)) order.routedFranchiseHistory = [];
  order.routedFranchiseHistory.push({
    franchisePartnerId: null,
    status: "PASSED_TO_HUB",
    routedAt: now,
    reason: "All franchise partner candidates rejected or unavailable",
  });

  await order.save();

  emitOrderStatusUpdate(
    order.orderId,
    { workflowStatus: order.workflowStatus, franchiseStatus: order.franchiseStatus },
    order.customer,
  );

  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_STATUS_CHANGED, {
    orderId: order.orderId,
    customerId: order.customer,
    userId: order.customer,
    customerMessage: "Your order has been transferred directly to Harsh's Main Hub for dispatch.",
  });

  return order;
}

export async function rejectFranchiseOrder({
  franchisePartnerId,
  orderId,
  reason,
}) {
  const order = await assertPartnerOwnsOrder(franchisePartnerId, orderId);
  return rerouteOrTransferFranchiseOrder(order, {
    currentPartnerId: franchisePartnerId,
    reason,
  });
}

export async function acceptHubFranchiseOrder({ sellerId, orderId }) {
  const canonicalOrderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({ orderId: canonicalOrderId });
  if (!order?.franchisePartnerId) {
    const err = new Error("Franchise order not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(order.seller) !== String(sellerId)) {
    const err = new Error("Only the hub seller can accept this order");
    err.statusCode = 403;
    throw err;
  }
  if (order.franchiseStatus !== FRANCHISE_ORDER_STATUS.ACCEPTED) {
    const err = new Error("Franchise partner must accept the order first");
    err.statusCode = 422;
    throw err;
  }
  if (order.hubAcceptanceStatus !== FRANCHISE_HUB_ACCEPTANCE_STATUS.PENDING) {
    const err = new Error("Order is not awaiting hub acceptance");
    err.statusCode = 422;
    throw err;
  }

  const now = new Date();
  order.hubAcceptanceStatus = FRANCHISE_HUB_ACCEPTANCE_STATUS.ACCEPTED;
  order.hubAcceptedAt = now;
  order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.PENDING;
  await order.save();

  emitOrderStatusUpdate(
    order.orderId,
    { hubAcceptanceStatus: order.hubAcceptanceStatus },
    order.customer,
  );

  const partnerUserId = await loadFranchisePartnerUserId(
    order.franchisePartnerId,
  );
  if (partnerUserId) {
    emitNotificationEvent(NOTIFICATION_EVENTS.FRANCHISE_HUB_ACCEPTED, {
      userId: partnerUserId,
      orderId: order.orderId,
      data: { orderId: String(order._id), publicOrderId: order.orderId },
    });
  }

  return order;
}

export async function rejectHubFranchiseOrder({ sellerId, orderId, reason }) {
  const canonicalOrderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({ orderId: canonicalOrderId });
  if (!order?.franchisePartnerId) {
    const err = new Error("Franchise order not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(order.seller) !== String(sellerId)) {
    const err = new Error("Only the hub seller can reject this order");
    err.statusCode = 403;
    throw err;
  }
  if (order.hubAcceptanceStatus !== FRANCHISE_HUB_ACCEPTANCE_STATUS.PENDING) {
    const err = new Error("Order is not awaiting hub acceptance");
    err.statusCode = 422;
    throw err;
  }

  order.hubAcceptanceStatus = FRANCHISE_HUB_ACCEPTANCE_STATUS.REJECTED;
  order.franchiseStatus = FRANCHISE_ORDER_STATUS.REJECTED;
  order.workflowStatus = WORKFLOW_STATUS.CANCELLED;
  order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.CANCELLED);
  order.orderStatus = order.status;
  if (reason) order.cancelReason = String(reason).slice(0, 240);
  await order.save();

  emitOrderStatusUpdate(
    order.orderId,
    { workflowStatus: order.workflowStatus },
    order.customer,
  );
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CANCELLED, {
    orderId: order.orderId,
    customerId: order.customer,
    userId: order.customer,
    customerMessage:
      reason || "Harsh's Hub could not fulfill this franchise order.",
  });

  return order;
}

export async function createFranchiseOrderShipment({
  franchisePartnerId,
  orderId,
  shipmentReference,
}) {
  const order = await assertPartnerOwnsOrder(franchisePartnerId, orderId);
  if (order.franchiseStatus !== FRANCHISE_ORDER_STATUS.ACCEPTED) {
    const err = new Error("Order must be accepted before creating shipment");
    err.statusCode = 422;
    throw err;
  }
  if (order.shipmentStatus === FRANCHISE_SHIPMENT_STATUS.CREATED) {
    const err = new Error("Shipment already created for this order");
    err.statusCode = 409;
    throw err;
  }

  const now = new Date();
  order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.CREATED;
  order.shipmentCreatedAt = now;
  order.shipmentReference =
    String(shipmentReference || "").trim() ||
    `HS-${order.orderId}-${now.getTime().toString(36).toUpperCase()}`;
  order.status = "packed";
  order.orderStatus = "packed";
  await order.save();

  emitOrderStatusUpdate(
    order.orderId,
    {
      shipmentStatus: order.shipmentStatus,
      shipmentReference: order.shipmentReference,
    },
    order.customer,
  );

  return order;
}

export async function fulfillFranchiseOrder({ franchisePartnerId, orderId }) {
  const order = await assertPartnerOwnsOrder(franchisePartnerId, orderId);
  if (order.franchiseStatus !== FRANCHISE_ORDER_STATUS.ACCEPTED) {
    const err = new Error("Order must be accepted before marking fulfilled");
    err.statusCode = 422;
    throw err;
  }
  if (order.shipmentStatus !== FRANCHISE_SHIPMENT_STATUS.CREATED) {
    const err = new Error(
      "Create shipment before marking this order as delivered",
    );
    err.statusCode = 422;
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (!order.franchiseStockConsumed) {
        for (const item of order.items || []) {
          const productId = item.product?._id || item.product;
          const qty = Math.max(1, Number(item.quantity) || 1);
          if (!productId) continue;
          await decrementFranchiseStock({
            franchisePartnerId,
            productId,
            quantity: qty,
            session,
            type: FRANCHISE_STOCK_TYPES.FULFILLMENT,
            note: `Fulfilled order #${order.orderId}`,
            orderId: order._id,
            variantSku: item.variantSku || item.sku || "",
          });
        }
        order.franchiseStockConsumed = true;
      }

      order.franchiseStatus = FRANCHISE_ORDER_STATUS.FULFILLED;
      order.workflowStatus = WORKFLOW_STATUS.DELIVERED;
      order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED);
      order.orderStatus = order.status;
      order.deliveredAt = new Date();
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }

  emitOrderStatusUpdate(
    order.orderId,
    { workflowStatus: order.workflowStatus },
    order.customer,
  );
  return order;
}

export async function listFranchiseOrdersForAdmin({
  dispatchStatus = "awaiting_dispatch",
  page = 1,
  limit = 25,
} = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const query = {
    franchisePartnerId: { $ne: null },
    isFranchiseStockOrder: { $ne: true },
  };

  if (dispatchStatus === "pending_partner") {
    query.franchiseStatus = FRANCHISE_ORDER_STATUS.PENDING;
    query.workflowStatus = WORKFLOW_STATUS.FRANCHISE_PENDING;
  } else if (dispatchStatus === "awaiting_shipment") {
    query.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
    query.$or = [
      { shipmentStatus: FRANCHISE_SHIPMENT_STATUS.PENDING },
      { shipmentStatus: null },
    ];
  } else if (dispatchStatus === "awaiting_dispatch") {
    query.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
    query.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.CREATED;
    query.deliveryBoy = null;
  } else if (dispatchStatus === "in_transit") {
    query.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
    query.deliveryBoy = { $ne: null };
    query.workflowStatus = {
      $in: [
        WORKFLOW_STATUS.DELIVERY_ASSIGNED,
        WORKFLOW_STATUS.OUT_FOR_DELIVERY,
        WORKFLOW_STATUS.PICKUP_READY,
      ],
    };
  }

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("customer", "name phone")
      .populate(
        "franchisePartnerId",
        "displayName referralCode territoryPincodes",
      )
      .populate("deliveryBoy", "name phone")
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

export async function assignFranchiseOrderDelivery({
  orderId,
  deliveryBoyId,
  adminId,
}) {
  const canonicalOrderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({ orderId: canonicalOrderId });
  if (!order?.franchisePartnerId) {
    const err = new Error("Franchise order not found");
    err.statusCode = 404;
    throw err;
  }
  if (order.isFranchiseStockOrder) {
    const err = new Error("Stock purchase orders cannot be dispatched");
    err.statusCode = 422;
    throw err;
  }
  if (order.franchiseStatus !== FRANCHISE_ORDER_STATUS.ACCEPTED) {
    const err = new Error("Partner must accept the order before dispatch");
    err.statusCode = 422;
    throw err;
  }
  if (order.shipmentStatus !== FRANCHISE_SHIPMENT_STATUS.CREATED) {
    const err = new Error(
      "Franchise partner must create shipment before dispatch",
    );
    err.statusCode = 422;
    throw err;
  }
  if (
    ![
      WORKFLOW_STATUS.FRANCHISE_ACCEPTED,
      WORKFLOW_STATUS.DELIVERY_ASSIGNED,
    ].includes(order.workflowStatus)
  ) {
    const err = new Error("Order is not ready for delivery assignment");
    err.statusCode = 422;
    throw err;
  }

  const rider = await Delivery.findById(deliveryBoyId).select(
    "_id name phone isVerified isOnline",
  );
  if (!rider) {
    const err = new Error("Delivery partner not found");
    err.statusCode = 404;
    throw err;
  }

  const now = new Date();
  order.deliveryBoy = rider._id;
  order.workflowStatus = WORKFLOW_STATUS.DELIVERY_ASSIGNED;
  order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERY_ASSIGNED);
  order.orderStatus = order.status;
  order.assignedAt = now;
  order.deliveryRiderStep = 1;
  await order.save();

  emitNotificationEvent(NOTIFICATION_EVENTS.DELIVERY_ASSIGNED, {
    orderId: order.orderId,
    deliveryId: rider._id,
    customerId: order.customer,
    sellerId: order.seller,
  });
  emitOrderStatusUpdate(
    order.orderId,
    { workflowStatus: order.workflowStatus, deliveryBoyId: String(rider._id) },
    order.customer,
  );

  return order;
}

export async function markFranchiseOrderDeliveredFromWorkflow(order) {
  if (!order?.franchisePartnerId || order.isFranchiseStockOrder) return order;
  if (order.franchiseStatus === FRANCHISE_ORDER_STATUS.FULFILLED) return order;
  order.franchiseStatus = FRANCHISE_ORDER_STATUS.FULFILLED;
  await order.save();
  return order;
}

export async function notifyFranchisePartnerNewOrder(franchisePartner, order) {
  try {
    let partner = franchisePartner;
    if (!partner?.userId && order?.franchisePartnerId) {
      partner = await FranchisePartner.findById(order.franchisePartnerId)
        .select("userId")
        .lean();
    }
    if (!partner?.userId) {
      logger.warn(
        "[franchise] skipped partner order notification — no userId",
        {
          orderId: order?.orderId,
          franchisePartnerId: order?.franchisePartnerId
            ? String(order.franchisePartnerId)
            : null,
        },
      );
      return;
    }

    const { notify } =
      await import("../../modules/notifications/notification.service.js");
    const result = await notify(NOTIFICATION_EVENTS.FRANCHISE_ORDER_ROUTED, {
      userId: String(partner.userId),
      orderId: order.orderId,
      franchisePartnerId: String(order.franchisePartnerId || partner._id),
    });

    if (!result.enqueued && !result.notificationIds?.length) {
      logger.warn("[franchise] partner order notification not enqueued", {
        orderId: order.orderId,
        partnerUserId: String(partner.userId),
        skipped: result.skipped,
        duplicates: result.duplicates,
      });
    }
  } catch (error) {
    logger.error("[franchise] partner order notification failed", {
      orderId: order?.orderId,
      message: error.message,
    });
  }
}

export async function listAllFranchisePartners({
  page = 1,
  limit = 25,
  q,
} = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);
  const skip = (safePage - 1) * safeLimit;
  const query = {};
  if (q) {
    const rx = new RegExp(
      String(q)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    query.$or = [{ referralCode: rx }, { displayName: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    FranchisePartner.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("userId", "name phone email")
      .lean(),
    FranchisePartner.countDocuments(query),
  ]);
  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

export async function updateFranchisePartnerTerritory({
  franchisePartnerId,
  territoryPincodes,
  adminId,
}) {
  const partner = await FranchisePartner.findById(franchisePartnerId);
  if (!partner) {
    const err = new Error("Partner not found");
    err.statusCode = 404;
    throw err;
  }
  partner.territoryPincodes = Array.isArray(territoryPincodes)
    ? territoryPincodes.map((p) => String(p).trim()).filter(Boolean)
    : [];
  partner.updatedBy = adminId || null;
  await partner.save();
  return partner;
}

export async function setHubSellerFlags({ sellerId, isPlatformHub = true }) {
  if (isPlatformHub) {
    await Seller.updateMany(
      { isPlatformHub: true },
      { $set: { isPlatformHub: false, isFranchiseCatalogSource: false } },
    );
  }
  const seller = await Seller.findByIdAndUpdate(
    sellerId,
    { $set: { isPlatformHub, isFranchiseCatalogSource: isPlatformHub } },
    { new: true },
  );
  return seller;
}
