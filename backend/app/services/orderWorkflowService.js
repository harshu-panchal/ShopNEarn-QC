import mongoose from "mongoose";
import Order from "../models/order.js";
import DeliveryAssignment from "../models/deliveryAssignment.js";
import OrderOtp from "../models/orderOtp.js";
import Seller from "../models/seller.js";
import Delivery from "../models/delivery.js";
import {
  clearOrderTracking,
  clearRiderPresence,
} from "./firebaseService.js";
import {
  WORKFLOW_STATUS,
  legacyStatusFromWorkflow,
  workflowFromLegacyStatus,
  DEFAULT_SELLER_TIMEOUT_MS,
  DEFAULT_DELIVERY_TIMEOUT_MS,
  DEFAULT_RETURN_PICKUP_TIMEOUT_MS,
  RETURN_PICKUP_SEARCH_MAX_ATTEMPTS,
  INITIAL_RETURN_PICKUP_RADIUS_M,
  RETURN_PICKUP_RADIUS_MULTIPLIER,
} from "../constants/orderWorkflow.js";
import { compensateOrderCancellation } from "./orderCompensation.js";
import { getRedisClient } from "../config/redis.js";
import {
  scheduleSellerTimeout,
  removeSellerTimeout,
  scheduleDeliveryTimeout,
  removeDeliveryTimeout,
  scheduleReturnPickupTimeout,
  removeReturnPickupTimeout,
} from "./workflow/jobSchedulerPort.js";
import {
  emitOrderStatusUpdate,
  emitToSeller,
  emitDeliveryBroadcastForSeller,
  emitReturnBroadcastForCustomer,
  emitToCustomer,
  emitToOrder,
  retractDeliveryBroadcastForOrder,
} from "./orderSocketEmitter.js";
import { distanceMeters } from "../utils/geoUtils.js";
import { applyDeliveredSettlement } from "./orderSettlement.js";
import { requireCanonicalOrderId } from "../utils/orderLookup.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import logger from "./logger.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";

const DELIVERY_SEARCH_MAX_ATTEMPTS = () =>
  parseInt(process.env.DELIVERY_SEARCH_MAX_ATTEMPTS || "3", 10);

const DELIVERY_RADIUS_MULTIPLIER = () =>
  parseFloat(process.env.DELIVERY_RADIUS_MULTIPLIER || "1.5");
const INITIAL_DELIVERY_RADIUS_M = () =>
  parseInt(process.env.INITIAL_DELIVERY_RADIUS_METERS || "5000", 10);

/** Payload for `delivery:broadcast` + Notification.data — lets the app show a modal without relying on GET /available alone. */
function deliveryBroadcastPayloadFromOrder(order, extra = {}) {
  const seller =
    order.seller && typeof order.seller === "object" && order.seller !== null
      ? order.seller
      : null;
  const pickup = seller?.shopName || "Seller";
  const drop =
    typeof order.address?.address === "string" && order.address.address.trim()
      ? order.address.address.trim()
      : "Customer address";
  const meta = order.deliverySearchMeta || {};
  const sid = seller?._id ?? order.seller;
  return {
    orderId: order.orderId,
    workflowStatus: order.workflowStatus || WORKFLOW_STATUS.DELIVERY_SEARCH,
    sellerId: sid != null ? String(sid) : undefined,
    radiusMeters: meta.radiusMeters ?? INITIAL_DELIVERY_RADIUS_M(),
    preview: {
      pickup,
      drop,
      total: order.pricing?.total ?? 0,
    },
    deliverySearchExpiresAt: order.deliverySearchExpiresAt,
    ...extra,
  };
}
const PICKUP_RADIUS_M = () =>
  parseInt(process.env.PICKUP_RADIUS_METERS || "150", 10);
const OTP_RADIUS_M = () =>
  parseInt(process.env.DELIVERY_OTP_RADIUS_METERS || "150", 10);
const OTP_EXPIRY_MS = () =>
  parseInt(process.env.DELIVERY_OTP_EXPIRY_MS || "300000", 10);

export function resolveWorkflowStatus(order) {
  if (order.workflowVersion >= 2 && order.workflowStatus) {
    return order.workflowStatus;
  }
  return workflowFromLegacyStatus(order.status);
}

/**
 * After creating a new order document (v2), schedule seller timeout and emit.
 */
export async function afterPlaceOrderV2(orderDoc) {
  const orderId = orderDoc.orderId;
  await scheduleSellerTimeoutJob(orderId);
  emitToSeller(orderDoc.seller?.toString(), {
    event: "order:new",
    payload: {
      orderId,
      workflowStatus: WORKFLOW_STATUS.SELLER_PENDING,
      sellerPendingExpiresAt: orderDoc.sellerPendingExpiresAt,
    },
  });
}

// Workflow timeout scheduling delegates to the jobSchedulerPort (P2.6).
// The function names below remain for in-file callers; the implementation
// lives in services/workflow/bullJobScheduler.js behind the port.
export async function scheduleSellerTimeoutJob(orderId) {
  return scheduleSellerTimeout(orderId);
}

export async function removeSellerTimeoutJob(orderId) {
  return removeSellerTimeout(orderId);
}

export async function scheduleDeliveryTimeoutJob(orderId, attempt = 1) {
  return scheduleDeliveryTimeout(orderId, attempt);
}

export async function removeDeliveryTimeoutJob(orderId, attempt = 1) {
  return removeDeliveryTimeout(orderId, attempt);
}

export async function scheduleReturnPickupTimeoutJob(orderId, attempt = 1) {
  return scheduleReturnPickupTimeout(orderId, attempt);
}

export async function removeReturnPickupTimeoutJob(orderId, attempt = 1) {
  return removeReturnPickupTimeout(orderId, attempt);
}

/**
 * Seller accepts: SELLER_PENDING -> DELIVERY_SEARCH (atomic).
 */
export async function sellerAcceptAtomic(sellerId, orderId) {
  orderId = await requireCanonicalOrderId(orderId);
  const now = new Date();
  const sellerMs = DEFAULT_SELLER_TIMEOUT_MS();
  const deliveryMs = DEFAULT_DELIVERY_TIMEOUT_MS();

  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      seller: sellerId,
      workflowVersion: { $gte: 2 },
      workflowStatus: WORKFLOW_STATUS.SELLER_PENDING,
      sellerPendingExpiresAt: { $gt: now },
      $or: [
        { paymentMode: { $ne: "ONLINE" } },
        { paymentStatus: "PAID" },
      ],
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.DELIVERY_SEARCH,
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERY_SEARCH),
        sellerAcceptedAt: now,
        deliverySearchExpiresAt: new Date(now.getTime() + deliveryMs),
        deliverySearchMeta: {
          radiusMeters: INITIAL_DELIVERY_RADIUS_M(),
          attempt: 1,
          lastBroadcastAt: now,
        },
      },
      // CRITICAL FIX: Remove expiresAt to prevent TTL index from auto-deleting the order
      $unset: { expiresAt: 1 },
    },
    { new: true },
  )
    .populate("customer", "name phone")
    .populate("seller", "shopName address name location serviceRadius");

  if (!updated) {
    const err = new Error("Order not available for acceptance or expired");
    err.statusCode = 409;
    throw err;
  }

  await removeSellerTimeoutJob(orderId);
  await scheduleDeliveryTimeoutJob(orderId, 1);

  await DeliveryAssignment.create({
    orderMongoId: updated._id,
    orderId: updated.orderId,
    status: "broadcasting",
    radiusMeters: INITIAL_DELIVERY_RADIUS_M(),
    attempt: 1,
    expiresAt: updated.deliverySearchExpiresAt,
  });

  emitOrderStatusUpdate(
    updated.orderId,
    {
      workflowStatus: WORKFLOW_STATUS.DELIVERY_SEARCH,
      deliverySearchExpiresAt: updated.deliverySearchExpiresAt,
    },
    updated.customer?._id || updated.customer,
  );
  await emitDeliveryBroadcastForSeller(
    updated.seller,
    deliveryBroadcastPayloadFromOrder(updated),
  );

  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CONFIRMED, {
    orderId: updated.orderId,
    customerId: updated.customer?._id || updated.customer,
    userId: updated.customer?._id || updated.customer,
    sellerId: updated.seller?._id || updated.seller,
  });

  return updated;
}

/**
 * Seller rejects: SELLER_PENDING -> CANCELLED + compensation.
 */
export async function sellerRejectAtomic(sellerId, orderId) {
  orderId = await requireCanonicalOrderId(orderId);
  const now = new Date();
  const order = await Order.findOneAndUpdate(
    {
      orderId,
      seller: sellerId,
      workflowVersion: { $gte: 2 },
      workflowStatus: WORKFLOW_STATUS.SELLER_PENDING,
      sellerPendingExpiresAt: { $gt: now },
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.CANCELLED,
        status: "cancelled",
        cancelledBy: "seller",
        cancelReason: "Rejected by seller",
      },
    },
    { new: true },
  );

  if (!order) {
    const err = new Error("Order not available to reject");
    err.statusCode = 409;
    throw err;
  }

  await removeSellerTimeoutJob(orderId);
  await compensateOrderCancellation(order, orderId);

  emitOrderStatusUpdate(order.orderId, {
    workflowStatus: WORKFLOW_STATUS.CANCELLED,
  }, order.customer);
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CANCELLED, {
    orderId: order.orderId,
    customerId: order.customer,
    userId: order.customer,
    sellerId: order.seller,
    customerMessage: "Your order was cancelled by the seller.",
    sellerMessage: `Order #${order.orderId} was cancelled.`,
  });
  return order;
}

function toDeliveryObjectId(deliveryId) {
  if (deliveryId == null) return null;
  try {
    const s = String(deliveryId);
    if (!mongoose.Types.ObjectId.isValid(s)) return null;
    return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
}

/**
 * First delivery partner to accept wins (atomic).
 */
export async function deliveryAcceptAtomic(deliveryId, orderId, idempotencyKey) {
  orderId = await requireCanonicalOrderId(orderId);
  const deliveryOid = toDeliveryObjectId(deliveryId);
  if (!deliveryOid) {
    const err = new Error("Invalid delivery account");
    err.statusCode = 400;
    throw err;
  }

  if (idempotencyKey) {
    try {
      const redis = getRedisClient();
      if (redis) {
        const cacheKey = `idem:delivery_accept:${orderId}:${idempotencyKey}`;
        const hit = await redis.get(cacheKey);
        if (hit) {
          const order = await Order.findOne({ orderId }).lean();
          return { order, duplicate: true };
        }
      }
    } catch {
      /* idempotency optional if Redis unavailable */
    }
  }

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      workflowVersion: { $gte: 2 },
      workflowStatus: WORKFLOW_STATUS.DELIVERY_SEARCH,
      deliveryBoy: null,
      deliverySearchExpiresAt: { $gt: now },
      skippedBy: { $nin: [deliveryOid] },
    },
    {
      $set: {
        deliveryBoy: deliveryOid,
        workflowStatus: WORKFLOW_STATUS.DELIVERY_ASSIGNED,
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERY_ASSIGNED),
        assignedAt: now,
        deliveryRiderStep: 1,
      },
      $inc: { assignmentVersion: 1 },
    },
    { new: true },
  );

  if (!updated) {
    const o = await Order.findOne({ orderId }).lean();
    if (!o) {
      const err = new Error("Order not found");
      err.statusCode = 404;
      throw err;
    }
    let msg = "Order already assigned or not available";
    if (o.deliverySearchExpiresAt && new Date(o.deliverySearchExpiresAt) <= now) {
      msg =
        "Accept window has expired. Wait for the next delivery request.";
    } else if (o.deliveryBoy) {
      msg = "Another rider already accepted this order.";
    } else if (
      (o.skippedBy || []).some((id) => id.toString() === deliveryOid.toString())
    ) {
      msg =
        "You rejected this order earlier, so it cannot be accepted now.";
    } else if (o.workflowStatus !== WORKFLOW_STATUS.DELIVERY_SEARCH) {
      msg = "This order is no longer open for delivery.";
    }
    const err = new Error(msg);
    err.statusCode = 409;
    throw err;
  }

  await removeDeliveryTimeoutJob(orderId, updated.deliverySearchMeta?.attempt || 1);

  const lastBroadcast = await DeliveryAssignment.findOne({
    orderId,
    status: "broadcasting",
  }).sort({ createdAt: -1 });
  if (lastBroadcast) {
    lastBroadcast.status = "assigned";
    lastBroadcast.winnerDeliveryId = deliveryOid;
    await lastBroadcast.save();
  }

  if (idempotencyKey) {
    try {
      const redis = getRedisClient();
      if (redis) {
        await redis.set(
          `idem:delivery_accept:${orderId}:${idempotencyKey}`,
          "1",
          "EX",
          86400,
        );
      }
    } catch {
      /* ignore */
    }
  }

  emitNotificationEvent(NOTIFICATION_EVENTS.DELIVERY_ASSIGNED, {
    orderId: updated.orderId,
    deliveryId: deliveryOid,
    customerId: updated.customer,
    sellerId: updated.seller,
  });

  await retractDeliveryBroadcastForOrder(updated.orderId, deliveryOid);

  emitOrderStatusUpdate(
    updated.orderId,
    {
      workflowStatus: WORKFLOW_STATUS.DELIVERY_ASSIGNED,
      deliveryBoyId: deliveryOid.toString(),
    },
    updated.customer,
  );

  return { order: updated, duplicate: false };
}

export async function processSellerTimeoutJob({ orderId }) {
  const now = new Date();
  const order = await Order.findOne({ orderId, workflowVersion: { $gte: 2 } });
  if (!order || order.workflowStatus !== WORKFLOW_STATUS.SELLER_PENDING) return;

  if (order.sellerPendingExpiresAt && order.sellerPendingExpiresAt > now) {
    return;
  }

  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      workflowVersion: { $gte: 2 },
      workflowStatus: WORKFLOW_STATUS.SELLER_PENDING,
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.CANCELLED,
        status: "cancelled",
        cancelledBy: "system",
        cancelReason: "Seller timeout (60s)",
      },
    },
    { new: true },
  );

  if (!updated) return;

  await compensateOrderCancellation(updated, orderId);

  emitOrderStatusUpdate(orderId, { workflowStatus: WORKFLOW_STATUS.CANCELLED }, updated.customer);
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CANCELLED, {
    orderId: updated.orderId,
    customerId: updated.customer,
    userId: updated.customer,
    sellerId: updated.seller,
    customerMessage: "Your order was cancelled because seller did not accept in time.",
    sellerMessage: `Order #${updated.orderId} was cancelled due to timeout.`,
  });
}

export async function processDeliveryTimeoutJob({ orderId, attempt }) {
  const now = new Date();
  const order = await Order.findOne({ orderId, workflowVersion: { $gte: 2 } });
  if (!order || order.workflowStatus !== WORKFLOW_STATUS.DELIVERY_SEARCH) return;

  if (order.deliverySearchExpiresAt && order.deliverySearchExpiresAt > now) {
    return;
  }

  const meta = order.deliverySearchMeta || {};
  const currentAttempt = meta.attempt || attempt || 1;
  const maxAttempts = DELIVERY_SEARCH_MAX_ATTEMPTS();

  if (currentAttempt < maxAttempts) {
    const nextRadius = Math.round(
      (meta.radiusMeters || INITIAL_DELIVERY_RADIUS_M()) *
        DELIVERY_RADIUS_MULTIPLIER(),
    );
    const deliveryMs = DEFAULT_DELIVERY_TIMEOUT_MS();
    const nextExpiry = new Date(now.getTime() + deliveryMs);

    await Order.findOneAndUpdate(
      {
        orderId,
        workflowVersion: { $gte: 2 },
        workflowStatus: WORKFLOW_STATUS.DELIVERY_SEARCH,
      },
      {
        $set: {
          deliverySearchExpiresAt: nextExpiry,
          deliverySearchMeta: {
            radiusMeters: nextRadius,
            attempt: currentAttempt + 1,
            lastBroadcastAt: now,
          },
        },
      },
    );

    await scheduleDeliveryTimeoutJob(orderId, currentAttempt + 1);

    const orderRich = await Order.findOne({ orderId })
      .populate("seller", "shopName address name location serviceRadius")
      .lean();
    if (orderRich) {
      await emitDeliveryBroadcastForSeller(
        orderRich.seller,
        deliveryBroadcastPayloadFromOrder(orderRich, {
          retryAttempt: currentAttempt + 1,
        }),
      );
    }
    return;
  }

  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      workflowVersion: { $gte: 2 },
      workflowStatus: WORKFLOW_STATUS.DELIVERY_SEARCH,
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.CANCELLED,
        status: "cancelled",
        cancelledBy: "system",
        cancelReason: "No delivery partner (timeout)",
      },
    },
    { new: true },
  );

  if (!updated) return;

  await compensateOrderCancellation(updated, orderId);
  emitOrderStatusUpdate(orderId, { workflowStatus: WORKFLOW_STATUS.CANCELLED }, updated.customer);
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CANCELLED, {
    orderId: updated.orderId,
    customerId: updated.customer,
    userId: updated.customer,
    sellerId: updated.seller,
    customerMessage:
      "Order was cancelled because no delivery partner was available.",
    sellerMessage:
      `Order #${updated.orderId} was cancelled because no delivery partner was available.`,
  });
}

/**
 * Build a return-pickup broadcast payload that mirrors the delivery-broadcast
 * shape used by riders today. Keeping fields stable means delivery clients
 * don't need to be updated when this state machine fires re-broadcasts.
 */
function returnPickupBroadcastPayloadFromOrder(order, extra = {}) {
  const meta = order.returnSearchMeta || {};
  const items = Array.isArray(order.items)
    ? order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        image: item.image || item.thumbnail,
      }))
    : [];
  return {
    orderId: order.orderId,
    type: "RETURN_PICKUP",
    isReturnPickup: true,
    radiusMeters: meta.radiusMeters ?? INITIAL_RETURN_PICKUP_RADIUS_M(),
    items,
    preview: {
      pickup: order.address?.completeAddress || "Customer Address",
      drop: order.sellerBranchArea || "Seller Store",
      total: order.pricing?.total ?? 0,
      earnings: order.riderEarnings ?? 0,
    },
    deliverySearchExpiresAt: order.returnSearchExpiresAt,
    ...extra,
  };
}

/**
 * Kick off a return-pickup broadcast with a real timeout / retry state
 * machine — analogous to delivery search. Persists `returnSearchExpiresAt`
 * + `returnSearchMeta`, emits the broadcast, and schedules attempt 1's
 * timeout job. Idempotent: if a search is already in flight we bail out
 * so re-triggering the seller flow can't blow up the schedule.
 */
export async function startReturnPickupBroadcast(order) {
  if (!order || !order.orderId) return null;

  const now = new Date();
  const returnMs = DEFAULT_RETURN_PICKUP_TIMEOUT_MS();
  const radius = INITIAL_RETURN_PICKUP_RADIUS_M();
  const expiresAt = new Date(now.getTime() + returnMs);

  const updated = await Order.findOneAndUpdate(
    {
      orderId: order.orderId,
      returnStatus: "return_pickup_assigned",
      returnDeliveryBoy: null,
    },
    {
      $set: {
        returnSearchExpiresAt: expiresAt,
        returnSearchMeta: {
          radiusMeters: radius,
          attempt: 1,
          lastBroadcastAt: now,
        },
      },
    },
    { new: true },
  );
  if (!updated) return null;

  await scheduleReturnPickupTimeoutJob(updated.orderId, 1);

  const customerLocation = updated.address?.location;
  await emitReturnBroadcastForCustomer(
    customerLocation,
    returnPickupBroadcastPayloadFromOrder(updated),
  );

  return updated;
}

/**
 * Bull processor for return-pickup timeout jobs. On each fire:
 *   - If the pickup was accepted / status moved on → exit.
 *   - If still in flight and the expiry has lapsed:
 *       - Under max attempts → expand radius, re-broadcast, schedule next.
 *       - At max attempts → revert to "return_approved" and ping the seller.
 */
export async function processReturnPickupTimeoutJob({ orderId, attempt }) {
  const now = new Date();
  const order = await Order.findOne({ orderId });
  if (!order) return;

  if (
    order.returnStatus !== "return_pickup_assigned" ||
    order.returnDeliveryBoy
  ) {
    return;
  }

  if (order.returnSearchExpiresAt && order.returnSearchExpiresAt > now) {
    return;
  }

  const meta = order.returnSearchMeta || {};
  const currentAttempt = meta.attempt || attempt || 1;
  const maxAttempts = RETURN_PICKUP_SEARCH_MAX_ATTEMPTS();

  if (currentAttempt < maxAttempts) {
    const nextRadius = Math.round(
      (meta.radiusMeters || INITIAL_RETURN_PICKUP_RADIUS_M()) *
        RETURN_PICKUP_RADIUS_MULTIPLIER(),
    );
    const returnMs = DEFAULT_RETURN_PICKUP_TIMEOUT_MS();
    const nextExpiry = new Date(now.getTime() + returnMs);

    const updated = await Order.findOneAndUpdate(
      {
        orderId,
        returnStatus: "return_pickup_assigned",
        returnDeliveryBoy: null,
      },
      {
        $set: {
          returnSearchExpiresAt: nextExpiry,
          returnSearchMeta: {
            radiusMeters: nextRadius,
            attempt: currentAttempt + 1,
            lastBroadcastAt: now,
          },
        },
      },
      { new: true },
    );
    if (!updated) return;

    await scheduleReturnPickupTimeoutJob(orderId, currentAttempt + 1);

    const customerLocation = updated.address?.location;
    await emitReturnBroadcastForCustomer(
      customerLocation,
      returnPickupBroadcastPayloadFromOrder(updated, {
        retryAttempt: currentAttempt + 1,
      }),
    );
    return;
  }

  // Out of attempts — back to "approved" so the seller can re-assign manually.
  const reverted = await Order.findOneAndUpdate(
    {
      orderId,
      returnStatus: "return_pickup_assigned",
      returnDeliveryBoy: null,
    },
    {
      $set: { returnStatus: "return_approved" },
      $unset: { returnSearchExpiresAt: 1, returnSearchMeta: 1 },
    },
    { new: true },
  );
  if (!reverted) return;

  try {
    await retractDeliveryBroadcastForOrder(reverted.orderId, null);
  } catch (e) {
    logger.warn("processReturnPickupTimeoutJob retract failed", {
      scope: "processReturnPickupTimeoutJob",
      orderId,
      error: e.message,
    });
  }

  emitNotificationEvent(NOTIFICATION_EVENTS.RETURN_REJECTED, {
    orderId: reverted.orderId,
    sellerId: reverted.seller,
    customerId: reverted.customer,
    data: {
      reason:
        "No delivery partner was available for the return pickup. Please reassign manually.",
    },
  });
}

export async function customerCancelV2(customerId, orderId, reason) {
  orderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({ orderId, customer: customerId });
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  const ws = resolveWorkflowStatus(order);
  if (ws !== WORKFLOW_STATUS.SELLER_PENDING) {
    const err = new Error("Order cannot be cancelled after confirmation");
    err.statusCode = 400;
    throw err;
  }

  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      customer: customerId,
      workflowStatus: WORKFLOW_STATUS.SELLER_PENDING,
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.CANCELLED,
        status: "cancelled",
        cancelledBy: "customer",
        cancelReason: reason || "Cancelled by customer",
      },
    },
    { new: true },
  );

  if (!updated) {
    const err = new Error("Unable to cancel");
    err.statusCode = 400;
    throw err;
  }

  await removeSellerTimeoutJob(orderId);
  await compensateOrderCancellation(updated, orderId);
  emitOrderStatusUpdate(orderId, { workflowStatus: WORKFLOW_STATUS.CANCELLED }, updated.customer);
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CANCELLED, {
    orderId: updated.orderId,
    customerId: updated.customer,
    userId: updated.customer,
    sellerId: updated.seller,
    customerMessage: "Your order has been cancelled successfully.",
    sellerMessage: `Order #${updated.orderId} was cancelled by customer.`,
  });
  return updated;
}

/**
 * Rider at seller location — step 1 → 2 (DELIVERY_ASSIGNED → PICKUP_READY).
 */
export async function markArrivedAtStoreAtomic(deliveryId, orderId, lat, lng) {
  orderId = await requireCanonicalOrderId(orderId);
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    const err = new Error("Valid lat/lng required");
    err.statusCode = 400;
    throw err;
  }

  const order = await Order.findOne({
    orderId,
    deliveryBoy: deliveryId,
    workflowVersion: { $gte: 2 },
  });

  if (!order || order.workflowStatus !== WORKFLOW_STATUS.DELIVERY_ASSIGNED) {
    const err = new Error("Invalid state: arrive at store first");
    err.statusCode = 409;
    throw err;
  }

  const seller = await Seller.findById(order.seller).select("location").lean();
  const coords = seller?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    const err = new Error("Seller location not configured");
    err.statusCode = 400;
    throw err;
  }
  const [slng, slat] = coords;
  const d = distanceMeters(lat, lng, slat, slng);
  /*
  if (d > PICKUP_RADIUS_M()) {
    const err = new Error(`Too far from store (>${PICKUP_RADIUS_M()}m)`);
    err.statusCode = 400;
    throw err;
  }
  */

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      workflowStatus: WORKFLOW_STATUS.DELIVERY_ASSIGNED,
      deliveryBoy: deliveryId,
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.PICKUP_READY,
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.PICKUP_READY),
        pickupReadyAt: now,
        deliveryRiderStep: 2,
      },
    },
    { new: true },
  );

  if (!updated) {
    const err = new Error("Could not mark arrived at store");
    err.statusCode = 409;
    throw err;
  }

  emitOrderStatusUpdate(
    orderId,
    { workflowStatus: WORKFLOW_STATUS.PICKUP_READY },
    updated.customer,
  );
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_PACKED, {
    orderId: updated.orderId,
    customerId: updated.customer,
    userId: updated.customer,
    sellerId: updated.seller,
    deliveryId: updated.deliveryBoy,
  });
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_READY, {
    orderId: updated.orderId,
    deliveryId: updated.deliveryBoy,
    sellerId: updated.seller,
  });
  return updated;
}

export async function confirmPickupAtomic(deliveryId, orderId, lat, lng) {
  orderId = await requireCanonicalOrderId(orderId);
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    const err = new Error("Valid lat/lng required");
    err.statusCode = 400;
    throw err;
  }

  const order = await Order.findOne({
    orderId,
    deliveryBoy: deliveryId,
    workflowVersion: { $gte: 2 },
  });

  const prePickup = new Set([
    WORKFLOW_STATUS.DELIVERY_ASSIGNED,
    WORKFLOW_STATUS.PICKUP_READY,
  ]);
  if (!order || !prePickup.has(order.workflowStatus)) {
    const err = new Error("Invalid state for pickup confirmation");
    err.statusCode = 409;
    throw err;
  }

  const seller = await Seller.findById(order.seller).select("location").lean();
  const coords = seller?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    const err = new Error("Seller location not configured");
    err.statusCode = 400;
    throw err;
  }
  const [slng, slat] = coords;
  const d = distanceMeters(lat, lng, slat, slng);
  /*
  if (d > PICKUP_RADIUS_M()) {
    const err = new Error(`Too far from store (>${PICKUP_RADIUS_M()}m)`);
    err.statusCode = 400;
    throw err;
  }
  */

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      workflowStatus: { $in: [...prePickup] },
      deliveryBoy: deliveryId,
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.OUT_FOR_DELIVERY,
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.OUT_FOR_DELIVERY),
        pickupConfirmedAt: now,
        outForDeliveryAt: now,
        deliveryRiderStep: 3,
      },
    },
    { new: true },
  );

  if (!updated) {
    const err = new Error("Pickup confirm failed");
    err.statusCode = 409;
    throw err;
  }

  emitOrderStatusUpdate(
    orderId,
    {
      workflowStatus: WORKFLOW_STATUS.OUT_FOR_DELIVERY,
    },
    updated.customer,
  );
  emitNotificationEvent(NOTIFICATION_EVENTS.OUT_FOR_DELIVERY, {
    orderId: updated.orderId,
    customerId: updated.customer,
    userId: updated.customer,
    deliveryId: updated.deliveryBoy,
    sellerId: updated.seller,
  });
  return updated;
}

/**
 * OUT_FOR_DELIVERY (or legacy out_for_delivery): advance UI step 3 → 4 (near customer / ready for OTP).
 */
export async function advanceDeliveryRiderUiAtomic(deliveryId, orderId) {
  orderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({
    orderId,
    deliveryBoy: deliveryId,
  });

  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  const v2 = order.workflowVersion >= 2;
  if (v2) {
    if (order.workflowStatus !== WORKFLOW_STATUS.OUT_FOR_DELIVERY) {
      const err = new Error("Order is not out for delivery");
      err.statusCode = 409;
      throw err;
    }
  } else if (order.status !== "out_for_delivery") {
    const err = new Error("Order is not out for delivery");
    err.statusCode = 409;
    throw err;
  }

  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      deliveryBoy: order.deliveryBoy,
    },
    { $set: { deliveryRiderStep: 4 } },
    { new: true },
  );

  if (!updated) {
    const err = new Error("Could not update progress");
    err.statusCode = 409;
    throw err;
  }

  return updated;
}

/**
 * Resolve the rider's current location. Mirrors the legacy fallback:
 *   - if body lat/lng provided and valid → use it,
 *   - else read Delivery.location (GeoJSON [lng, lat]) and require it to
 *     be both non-default and refreshed within the last 5 minutes
 *     (so we never grant proximity bypass via stale cache).
 * Throws structured statusCode/code errors that the controller surfaces verbatim.
 */
async function resolveRiderLocation(deliveryId, bodyLat, bodyLng) {
  const fromBody =
    typeof bodyLat === "number" &&
    typeof bodyLng === "number" &&
    Number.isFinite(bodyLat) &&
    Number.isFinite(bodyLng);

  if (fromBody) {
    if (
      bodyLat < -90 ||
      bodyLat > 90 ||
      bodyLng < -180 ||
      bodyLng > 180
    ) {
      const err = new Error(
        "Latitude must be between -90 and 90, longitude between -180 and 180",
      );
      err.statusCode = 400;
      err.code = "LOCATION_REQUIRED";
      throw err;
    }
    return { lat: bodyLat, lng: bodyLng };
  }

  const delivery = await Delivery.findById(deliveryId).select(
    "location lastLocationAt",
  );
  if (!delivery) {
    const err = new Error("Delivery person not found");
    err.statusCode = 404;
    err.code = "DELIVERY_NOT_FOUND";
    throw err;
  }

  const coords = delivery.location?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    const err = new Error(
      "Your location is not available. Please ensure location tracking is enabled.",
    );
    err.statusCode = 400;
    err.code = "LOCATION_REQUIRED";
    throw err;
  }

  const [lng, lat] = coords;
  if (Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5) {
    const err = new Error(
      "Your location is not available. Please ensure location tracking is enabled.",
    );
    err.statusCode = 400;
    err.code = "LOCATION_REQUIRED";
    throw err;
  }

  if (!delivery.lastLocationAt) {
    const err = new Error(
      "Your location data is not available. Please ensure location tracking is enabled.",
    );
    err.statusCode = 400;
    err.code = "LOCATION_STALE";
    throw err;
  }

  const locationAge = Date.now() - delivery.lastLocationAt.getTime();
  if (locationAge > 5 * 60 * 1000) {
    const err = new Error(
      "Your location data is outdated. Please ensure location tracking is enabled and try again.",
    );
    err.statusCode = 400;
    err.code = "LOCATION_STALE";
    throw err;
  }

  return { lat, lng };
}

export async function requestHandoffOtpAtomic(deliveryId, orderId, lat, lng) {
  const order = await Order.findOne({
    orderId,
    deliveryBoy: deliveryId,
  });

  if (!order) {
    const err = new Error("Order not found or not assigned to you");
    err.statusCode = 404;
    err.code = "UNAUTHORIZED_DELIVERY";
    throw err;
  }

  // Accept either v2 workflow state OUT_FOR_DELIVERY *or* legacy v1
  // status "out_for_delivery" — the legacy controller didn't gate on
  // state at all, so this is the strictest backward-compatible guard.
  const isV2Out = order.workflowStatus === WORKFLOW_STATUS.OUT_FOR_DELIVERY;
  const isV1Out =
    (order.workflowVersion || 1) < 2 &&
    String(order.status || "").toLowerCase() === "out_for_delivery";
  if (!isV2Out && !isV1Out) {
    const err = new Error("Order not ready for OTP");
    err.statusCode = 409;
    err.code = "ORDER_NOT_READY";
    throw err;
  }

  const rider = await resolveRiderLocation(deliveryId, lat, lng);

  const cust = order.address?.location;
  if (
    typeof cust?.lat !== "number" ||
    typeof cust?.lng !== "number" ||
    !Number.isFinite(cust.lat) ||
    !Number.isFinite(cust.lng)
  ) {
    const err = new Error("Customer address coordinates missing");
    err.statusCode = 400;
    err.code = "ORDER_LOCATION_REQUIRED";
    throw err;
  }

  const d = distanceMeters(rider.lat, rider.lng, cust.lat, cust.lng);
  if (d > OTP_RADIUS_M()) {
    const err = new Error(
      `Delivery person must be within ${OTP_RADIUS_M()} meters of delivery location. Current distance: ${Math.round(d)}m`,
    );
    err.statusCode = 403;
    err.code = "PROXIMITY_OUT_OF_RANGE";
    throw err;
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      const key = `otp_req:${orderId}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, 300);
      if (n > 3) {
        const err = new Error("OTP request rate limit exceeded");
        err.statusCode = 429;
        err.code = "OTP_RATE_LIMIT";
        throw err;
      }
    } catch (e) {
      if (e.statusCode === 429) throw e;
    }
  }

  const code = String(Math.floor(1000 + Math.random() * 9000)).padStart(4, "0");
  const codeHash = OrderOtp.hashCode(code);

  // Mark previous OTPs as consumed (legacy parity) instead of deleting,
  // so attempt history remains queryable for forensics.
  await OrderOtp.updateMany(
    { orderId, type: "delivery", consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS());
  await OrderOtp.create({
    orderId,
    orderMongoId: order._id,
    type: "delivery",
    codeHash,
    code,
    expiresAt,
    attempts: 0,
    maxAttempts: 3,
    lastGeneratedAt: new Date(),
  });

  const customerId =
    order.customer && typeof order.customer.toString === "function"
      ? order.customer.toString()
      : order.customer;

  const otpPayload = {
    orderId,
    otp: code,
    code,
    expiresAt,
    deliveryPersonNearby: true,
  };

  emitToCustomer(customerId, { event: "order:otp", payload: otpPayload });
  emitToCustomer(customerId, {
    event: "delivery:otp:generated",
    payload: otpPayload,
  });
  // Mirror the legacy fan-out: clients that joined `order:<id>` (the
  // customer's open OrderDetailPage in particular) also expect to see
  // these events without subscribing to the personal room.
  emitToOrder(orderId, { event: "order:otp", payload: otpPayload });
  emitToOrder(orderId, {
    event: "delivery:otp:generated",
    payload: otpPayload,
  });
  emitOrderStatusUpdate(orderId, { otpSent: true }, order.customer);

  return { expiresAt, attemptsRemaining: 3, message: "OTP sent to customer" };
}

/**
 * Map a delivery-OTP storage code into an HTTP status. Mirrors the
 * historical mapping the legacy controller exposed to clients.
 */
function statusCodeForOtpError(errorCode) {
  switch (errorCode) {
    case "OTP_INVALID_FORMAT":
    case "INVALID_FORMAT":
      return 400;
    case "OTP_EXPIRED":
      return 401;
    case "OTP_MISMATCH":
      return 403;
    case "OTP_NOT_FOUND":
      return 404;
    case "OTP_CONSUMED":
      return 409;
    case "MAX_ATTEMPTS_EXCEEDED":
      return 423;
    default:
      return 500;
  }
}

export async function verifyHandoffOtpAndDeliver(deliveryId, orderId, code) {
  // Validate format up-front so the controller surfaces OTP_INVALID_FORMAT
  // exactly like the legacy endpoint did (frontend switches on this code).
  if (!code || typeof code !== "string") {
    const err = new Error("OTP is required");
    err.statusCode = 400;
    err.code = "OTP_INVALID_FORMAT";
    throw err;
  }
  if (!/^\d{4}$/.test(code)) {
    const err = new Error("OTP must be exactly 4 digits");
    err.statusCode = 400;
    err.code = "OTP_INVALID_FORMAT";
    throw err;
  }

  orderId = await requireCanonicalOrderId(orderId);
  const order = await Order.findOne({
    orderId,
    deliveryBoy: deliveryId,
  }).populate("customer", "name phone");

  if (!order) {
    const err = new Error("Order not found or not assigned to you");
    err.statusCode = 404;
    err.code = "UNAUTHORIZED_DELIVERY";
    throw err;
  }

  const isV2Out = order.workflowStatus === WORKFLOW_STATUS.OUT_FOR_DELIVERY;
  const isV1Out =
    (order.workflowVersion || 1) < 2 &&
    String(order.status || "").toLowerCase() === "out_for_delivery";
  if (!isV2Out && !isV1Out) {
    const err = new Error("Invalid state for delivery completion");
    err.statusCode = 409;
    err.code = "ORDER_NOT_READY";
    throw err;
  }

  // Load the most recent OTP record; do NOT filter on consumedAt so we
  // can return actionable OTP_CONSUMED instead of a generic OTP_NOT_FOUND.
  const otp = await OrderOtp.findOne({ orderId, type: "delivery" }).sort({
    lastGeneratedAt: -1,
    createdAt: -1,
  });

  if (!otp) {
    const err = new Error("No OTP has been generated for this order yet");
    err.statusCode = statusCodeForOtpError("OTP_NOT_FOUND");
    err.code = "OTP_NOT_FOUND";
    throw err;
  }

  if (otp.consumedAt) {
    const err = new Error("OTP has already been used. Please generate a new OTP.");
    err.statusCode = statusCodeForOtpError("OTP_CONSUMED");
    err.code = "OTP_CONSUMED";
    err.attemptsRemaining = 0;
    throw err;
  }

  if (otp.attempts >= otp.maxAttempts) {
    const err = new Error(
      "Maximum validation attempts exceeded. Supervisor intervention required.",
    );
    err.statusCode = statusCodeForOtpError("MAX_ATTEMPTS_EXCEEDED");
    err.code = "MAX_ATTEMPTS_EXCEEDED";
    err.attemptsRemaining = 0;
    throw err;
  }

  if (otp.expiresAt && otp.expiresAt < new Date()) {
    const err = new Error("OTP has expired. Please generate a new OTP.");
    err.statusCode = statusCodeForOtpError("OTP_EXPIRED");
    err.code = "OTP_EXPIRED";
    err.attemptsRemaining = otp.maxAttempts - otp.attempts;
    throw err;
  }

  const match = OrderOtp.hashCode(String(code)) === otp.codeHash;
  if (!match) {
    otp.attempts += 1;
    await otp.save();
    const err = new Error("Invalid OTP. Please try again.");
    err.statusCode = statusCodeForOtpError("OTP_MISMATCH");
    err.code = "OTP_MISMATCH";
    err.attemptsRemaining = otp.maxAttempts - otp.attempts;
    throw err;
  }

  await OrderOtp.updateOne(
    { _id: otp._id },
    { $set: { consumedAt: new Date() } },
  );

  const now = new Date();

  // Capture the rider's last-known coords so the OTP-validation event
  // carries the same audit trail the legacy controller persisted.
  let validationLocation = null;
  try {
    const delivery = await Delivery.findById(deliveryId).select("location");
    const coords = delivery?.location?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      validationLocation = { lng: coords[0], lat: coords[1] };
    }
  } catch (e) {
    logger.warn("verifyHandoffOtpAndDeliver: rider location read failed", {
      scope: "verifyHandoffOtpAndDeliver",
      orderId,
      error: e.message,
    });
  }

  // For v2 orders we move the workflow state; for legacy v1 we just
  // flip the legacy `status`. The atomic guard prevents double-delivery
  // by including the expected pre-state in the filter.
  const updateFilter = isV2Out
    ? {
        orderId,
        workflowStatus: WORKFLOW_STATUS.OUT_FOR_DELIVERY,
        deliveryBoy: deliveryId,
      }
    : {
        orderId,
        status: "out_for_delivery",
        deliveryBoy: deliveryId,
      };

  const updateSet = {
    status: "delivered",
    deliveredAt: now,
    otpValidatedAt: now,
  };
  if (isV2Out) {
    updateSet.workflowStatus = WORKFLOW_STATUS.DELIVERED;
  }
  if (validationLocation) {
    updateSet.otpValidationLocation = validationLocation;
  }

  const updated = await Order.findOneAndUpdate(
    updateFilter,
    { $set: updateSet },
    { new: true },
  );

  if (!updated) {
    const err = new Error("Could not finalize delivery");
    err.statusCode = 409;
    err.code = "ORDER_NOT_READY";
    throw err;
  }

  if (!updated.customer) {
    logger.error("Customer field lost during delivery completion", {
      scope: "ORDER_BUG",
      orderId,
      _id: updated._id,
    });
    const err = new Error(
      "Order data integrity error: customer reference lost during update",
    );
    err.statusCode = 500;
    err.code = "ORDER_DATA_CORRUPT";
    throw err;
  }

  let settlementWarning = null;
  try {
    await applyDeliveredSettlement(updated, orderId);
  } catch (settlementError) {
    // Order is already marked delivered. Surface a warning instead of
    // failing the OTP call — finance can reconcile out-of-band.
    logger.error("Settlement failed after delivery", {
      scope: "verifyHandoffOtpAndDeliver",
      orderId,
      error: settlementError.message,
    });
    settlementWarning = {
      code: "FINANCE_SETTLEMENT_FAILED",
      message: settlementError.message,
    };
  }

  // Realtime tracking nodes for this order are no longer interesting —
  // drop them so the customer's live-map and the fleet view stop
  // showing this rider as "live on order".
  clearOrderTracking(orderId).catch(() => {});
  clearRiderPresence(deliveryId).catch(() => {});

  emitOrderStatusUpdate(
    orderId,
    { workflowStatus: WORKFLOW_STATUS.DELIVERED },
    updated.customer,
  );

  // Frontend-compat: customers + observers listen for "delivery:otp:validated"
  // to flip their UI to "Delivered". Emit to both the customer room and the
  // order room so any open client picks it up.
  const validatedPayload = {
    orderId,
    status: "delivered",
    deliveredAt: now.toISOString(),
  };
  emitToCustomer(updated.customer?._id || updated.customer, {
    event: "delivery:otp:validated",
    payload: validatedPayload,
  });
  emitToOrder(orderId, {
    event: "delivery:otp:validated",
    payload: validatedPayload,
  });

  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_DELIVERED, {
    orderId: updated.orderId,
    customerId: updated.customer,
    userId: updated.customer,
    deliveryId: updated.deliveryBoy,
    sellerId: updated.seller,
  });

  return {
    order: updated,
    orderId: updated.orderId,
    deliveredAt: now.toISOString(),
    warning: settlementWarning,
  };
}
