import Order from "../../models/order.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Seller from "../../models/seller.js";
import Delivery from "../../models/delivery.js";
import { FRANCHISE_ORDER_STATUS } from "../../constants/franchise.js";
import { WORKFLOW_STATUS, legacyStatusFromWorkflow } from "../../constants/orderWorkflow.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { emitOrderStatusUpdate } from "../orderSocketEmitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import { requireCanonicalOrderId } from "../../utils/orderLookup.js";

export async function listFranchisePartnerOrders(franchisePartnerId, { status, page = 1, limit = 25 } = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const query = {
    franchisePartnerId,
    isFranchiseStockOrder: { $ne: true },
  };
  if (status) query.franchiseStatus = status;

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("customer", "name phone")
      .lean(),
    Order.countDocuments(query),
  ]);
  return { items, page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 };
}

async function assertPartnerOwnsOrder(franchisePartnerId, orderId) {
  const order = await Order.findById(orderId);
  if (!order || String(order.franchisePartnerId) !== String(franchisePartnerId)) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }
  return order;
}

export async function acceptFranchiseOrder({ franchisePartnerId, orderId }) {
  const order = await assertPartnerOwnsOrder(franchisePartnerId, orderId);
  order.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
  order.workflowStatus = WORKFLOW_STATUS.FRANCHISE_ACCEPTED;
  order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.FRANCHISE_ACCEPTED);
  order.orderStatus = order.status;
  await order.save();
  emitOrderStatusUpdate(order.orderId, { workflowStatus: order.workflowStatus }, order.customer);
  return order;
}

export async function rejectFranchiseOrder({ franchisePartnerId, orderId, reason }) {
  const order = await assertPartnerOwnsOrder(franchisePartnerId, orderId);
  order.franchiseStatus = FRANCHISE_ORDER_STATUS.REJECTED;
  order.workflowStatus = WORKFLOW_STATUS.CANCELLED;
  order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.CANCELLED);
  order.orderStatus = order.status;
  if (reason) order.cancelReason = String(reason).slice(0, 240);
  await order.save();
  emitOrderStatusUpdate(order.orderId, { workflowStatus: order.workflowStatus }, order.customer);
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CANCELLED, {
    orderId: order.orderId,
    customerId: order.customer,
    userId: order.customer,
    customerMessage: reason || "Your Home Shoppy partner could not fulfill this order.",
  });
  return order;
}

export async function fulfillFranchiseOrder({ franchisePartnerId, orderId }) {
  const order = await assertPartnerOwnsOrder(franchisePartnerId, orderId);
  order.franchiseStatus = FRANCHISE_ORDER_STATUS.FULFILLED;
  order.workflowStatus = WORKFLOW_STATUS.DELIVERED;
  order.status = legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED);
  order.orderStatus = order.status;
  order.deliveredAt = new Date();
  await order.save();
  emitOrderStatusUpdate(order.orderId, { workflowStatus: order.workflowStatus }, order.customer);
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

  if (dispatchStatus === "awaiting_dispatch") {
    query.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
    query.workflowStatus = WORKFLOW_STATUS.FRANCHISE_ACCEPTED;
    query.deliveryBoy = null;
  } else if (dispatchStatus === "pending_partner") {
    query.franchiseStatus = FRANCHISE_ORDER_STATUS.PENDING;
    query.workflowStatus = WORKFLOW_STATUS.FRANCHISE_PENDING;
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
      .populate("franchisePartnerId", "displayName referralCode territoryPincodes")
      .populate("deliveryBoy", "name phone")
      .lean(),
    Order.countDocuments(query),
  ]);

  return { items, page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 };
}

export async function assignFranchiseOrderDelivery({ orderId, deliveryBoyId, adminId }) {
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
  if (![WORKFLOW_STATUS.FRANCHISE_ACCEPTED, WORKFLOW_STATUS.DELIVERY_ASSIGNED].includes(order.workflowStatus)) {
    const err = new Error("Order is not ready for delivery assignment");
    err.statusCode = 422;
    throw err;
  }

  const rider = await Delivery.findById(deliveryBoyId).select("_id name phone isVerified isOnline");
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
  if (!franchisePartner?.userId) return;
  try {
    emitNotificationEvent("FRANCHISE_ORDER_ROUTED", {
      userId: String(franchisePartner.userId),
      data: {
        orderId: String(order._id),
        publicOrderId: order.orderId,
      },
    });
  } catch (_) {
    /* non-fatal */
  }
}

export async function listAllFranchisePartners({ page = 1, limit = 25, q } = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);
  const skip = (safePage - 1) * safeLimit;
  const query = {};
  if (q) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ referralCode: rx }, { displayName: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    FranchisePartner.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit)
      .populate("userId", "name phone email")
      .lean(),
    FranchisePartner.countDocuments(query),
  ]);
  return { items, page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 };
}

export async function updateFranchisePartnerTerritory({ franchisePartnerId, territoryPincodes, adminId }) {
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
