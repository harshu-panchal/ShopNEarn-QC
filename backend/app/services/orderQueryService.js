import Order from "../models/order.js";
import Delivery from "../models/delivery.js";
import Seller from "../models/seller.js";
import CheckoutGroup from "../models/checkoutGroup.js";
import { WORKFLOW_STATUS } from "../constants/orderWorkflow.js";
import { distanceMeters } from "../utils/geoUtils.js";
import {
  orderMatchQueryFlexible,
} from "../utils/orderLookup.js";
import { buildKey, getOrSet, getTTL } from "./cacheService.js";
import { resolveWorkflowStatus } from "./orderWorkflowService.js";
import logger from "./logger.js";

function svcErr(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function refToIdString(ref) {
  if (ref == null) return "";
  if (typeof ref === "object" && ref._id != null) return String(ref._id);
  return String(ref);
}

function normalizeSellerStatusFilter(statusParam) {
  if (!statusParam || statusParam === "all") {
    return {};
  }

  if (statusParam === "pending") {
    return { status: "pending" };
  }
  if (statusParam === "processed") {
    return { status: { $in: ["confirmed", "packed"] } };
  }
  if (statusParam === "out-for-delivery") {
    return { status: "out_for_delivery" };
  }
  if (statusParam === "delivered") {
    return { status: "delivered" };
  }
  if (statusParam === "cancelled") {
    return { status: "cancelled" };
  }
  if (statusParam === "returned") {
    return { returnStatus: { $ne: "none" } };
  }

  return {};
}

function appendDateRange(query, { startDate, endDate }) {
  if (!startDate && !endDate) {
    return query;
  }

  const range = {};
  if (startDate) {
    range.$gte = new Date(startDate);
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }

  return {
    ...query,
    createdAt: range,
  };
}

export function buildSellerOrdersQuery({
  role,
  userId,
  statusParam,
  startDate,
  endDate,
}) {
  const base = role === "admin" ? {} : { seller: userId };
  const withStatus = {
    ...base,
    ...normalizeSellerStatusFilter(statusParam),
  };
  return appendDateRange(withStatus, { startDate, endDate });
}

export async function fetchSellerOrdersPage({
  role,
  userId,
  statusParam,
  startDate,
  endDate,
  skip,
  limit,
}) {
  const query = buildSellerOrdersQuery({
    role,
    userId,
    statusParam,
    startDate,
    endDate,
  });

  const [orders, total, summaryRows] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate("customer", "name phone")
      .populate("items.product", "name mainImage price salePrice")
      .populate("deliveryBoy", "name phone")
      .populate("seller", "shopName name")
      .lean(),
    Order.countDocuments(query),
    Order.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ["$pricing.total", 0] } },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          confirmed: {
            $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
          },
          packed: {
            $sum: { $cond: [{ $eq: ["$status", "packed"] }, 1, 0] },
          },
          outForDelivery: {
            $sum: { $cond: [{ $eq: ["$status", "out_for_delivery"] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
          returned: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$returnStatus", null] },
                    { $ne: ["$returnStatus", ""] },
                    { $ne: ["$returnStatus", "none"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const rawSummary = summaryRows?.[0] || {};
  const summary = {
    totalOrders: Number(rawSummary.totalOrders || 0),
    totalAmount: Number(rawSummary.totalAmount || 0),
    pending: Number(rawSummary.pending || 0),
    confirmed: Number(rawSummary.confirmed || 0),
    packed: Number(rawSummary.packed || 0),
    outForDelivery: Number(rawSummary.outForDelivery || 0),
    delivered: Number(rawSummary.delivered || 0),
    cancelled: Number(rawSummary.cancelled || 0),
    returned: Number(rawSummary.returned || 0),
  };
  summary.activeOrders =
    summary.pending +
    summary.confirmed +
    summary.packed +
    summary.outForDelivery;

  return {
    query,
    orders,
    total,
    summary,
  };
}

function parseAvailableOrdersLimit(requestedLimit) {
  const maxLimit = 50;
  const parsed = parseInt(requestedLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, maxLimit);
}

async function resolveNearbySellerIds(deliveryPartner, userId) {
  const nearbySellers = await Seller.find({
    location: {
      $near: {
        $geometry: deliveryPartner.location,
        $maxDistance: 5000,
      },
    },
  }).select("_id");

  let sellerIds = nearbySellers.map((seller) => seller._id);
  let usedFallback = false;

  if (sellerIds.length === 0 && process.env.NODE_ENV !== "production") {
    const allSellers = await Seller.find({}).select("_id");
    sellerIds = allSellers.map((seller) => seller._id);
    usedFallback = true;
    console.log(
      `DEV LOG - Radius search found 0 sellers. Bypassing radius check for Delivery Partner: ${userId}`,
    );
  }

  return {
    sellerIds,
    usedFallback,
  };
}

function filterV2OrdersByRadius(v2Orders, deliveryCoords) {
  const [dlng, dlat] = deliveryCoords;
  return v2Orders.filter((order) => {
    const coords = order.seller?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return true;

    const [slng, slat] = coords;
    const searchR = order.deliverySearchMeta?.radiusMeters || 5000;
    const serviceKm = Number(order.seller?.serviceRadius ?? 5);
    const serviceM = Math.max(serviceKm, 0) * 1000;
    const maxR = Math.min(searchR, serviceM);
    return distanceMeters(dlat, dlng, slat, slng) <= maxR;
  });
}

function mergeAvailableOrders(v2Orders, legacyOrders, returnPickups, limit) {
  const seen = new Set();
  const merged = [];

  for (const order of [...v2Orders, ...legacyOrders, ...returnPickups]) {
    if (seen.has(order.orderId)) continue;
    seen.add(order.orderId);
    merged.push(order);
    if (merged.length >= limit) break;
  }

  return merged;
}

export async function fetchAvailableOrdersForDelivery({
  userId,
  requestedLimit,
  type = "delivery",
}) {
  const limit = parseAvailableOrdersLimit(requestedLimit);
  const showDeliveries = type === "delivery" || type === "all";
  const showReturns = type === "return" || type === "all";

  let assignedReturnPickups = [];
  if (showReturns) {
    const assignedReturnPickupsRaw = await Order.find({
      returnStatus: "return_pickup_assigned",
      returnDeliveryBoy: userId,
      skippedBy: { $nin: [userId] },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate("customer", "name phone")
      .populate("seller", "shopName address name location")
      .lean();

    assignedReturnPickups = assignedReturnPickupsRaw.map((rp) => ({
      ...rp,
      isReturnPickup: true,
    }));
  }

  const deliveryPartner = await Delivery.findById(userId);
  if (
    !deliveryPartner ||
    !deliveryPartner.location ||
    !Array.isArray(deliveryPartner.location.coordinates)
  ) {
    return {
      requiresLocation: showDeliveries && assignedReturnPickups.length === 0,
      orders: assignedReturnPickups,
      limit,
    };
  }

  const { sellerIds } = await resolveNearbySellerIds(deliveryPartner, userId);

  let v2Orders = [];
  if (showDeliveries) {
    const v2OrdersRaw = await Order.find({
      workflowVersion: { $gte: 2 },
      workflowStatus: WORKFLOW_STATUS.DELIVERY_SEARCH,
      deliveryBoy: null,
      seller: { $in: sellerIds },
      skippedBy: { $nin: [userId] },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate("customer", "name phone")
      .populate("seller", "shopName address name location serviceRadius")
      .lean();

    v2Orders = filterV2OrdersByRadius(
      v2OrdersRaw,
      deliveryPartner.location.coordinates,
    );
  }

  let legacyOrders = [];
  if (showDeliveries) {
    legacyOrders = await Order.find({
      $or: [
        { workflowVersion: { $exists: false } },
        { workflowVersion: { $lt: 2 } },
      ],
      status: { $in: ["confirmed", "packed"] },
      deliveryBoy: null,
      seller: { $in: sellerIds },
      skippedBy: { $nin: [userId] },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate("customer", "name phone")
      .populate("seller", "shopName address name location")
      .lean();
  }

  let returnPickups = [];
  if (showReturns) {
    const now = new Date();
    const returnPickupsRaw = await Order.find({
      skippedBy: { $nin: [userId] },
      $or: [
        // Manual reassign queue — seller picked "no specific rider" but
        // the broadcast loop hasn't been kicked off yet (or it expired
        // out). These stay visible until a seller re-assigns.
        {
          returnStatus: "return_approved",
          returnDeliveryBoy: null,
          seller: { $in: sellerIds },
        },
        // Active broadcast — only show while the assignment window is
        // still open. Legacy rows without a stored expiry stay visible
        // for backwards compatibility.
        {
          returnStatus: "return_pickup_assigned",
          returnDeliveryBoy: null,
          seller: { $in: sellerIds },
          $or: [
            { returnSearchExpiresAt: { $exists: false } },
            { returnSearchExpiresAt: null },
            { returnSearchExpiresAt: { $gt: now } },
          ],
        },
        // Mine to handle right now — always show, regardless of expiry.
        {
          returnDeliveryBoy: userId,
        },
      ],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate("customer", "name phone")
      .populate("seller", "shopName address name location")
      .lean();

    returnPickups = returnPickupsRaw.map((rp) => ({
      ...rp,
      isReturnPickup: true,
    }));
  }

  const orders = mergeAvailableOrders(
    v2Orders,
    legacyOrders,
    [...assignedReturnPickups, ...returnPickups],
    limit,
  );

  return {
    requiresLocation: false,
    orders,
    limit,
  };
}

/**
 * Customer-facing paginated order list (cached).
 * Replaces inline logic from orderController.getMyOrders.
 */
export async function getCustomerOrders(customerId, pagination) {
  const { page, limit, skip } = pagination;
  const cacheKey = buildKey(
    "orders",
    "customer",
    `${customerId}:p${page}:l${limit}`,
  );

  return getOrSet(
    cacheKey,
    async () => {
      // MLM digital subscriptions (joining-package, home-shopping) are
      // accounting-only orders. The customer interacts with them
      // through the Rewards Program UI, not the Orders list — so they
      // are explicitly excluded here. The filter is applied to both
      // `find` and `countDocuments` so pagination math stays honest.
      const baseQuery = {
        customer: customerId,
        isJoiningPackageOrder: { $ne: true },
        isHomeShoppingOrder: { $ne: true },
      };
      const [orders, total] = await Promise.all([
        Order.find(baseQuery)
          .select(
            "orderId checkoutGroupId customer seller items address payment pricing status workflowStatus workflowVersion returnStatus timeSlot createdAt",
          )
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .populate("items.product", "name mainImage price salePrice")
          .lean(),
        Order.countDocuments(baseQuery),
      ]);

      return {
        items: orders,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      };
    },
    getTTL("orders"),
  );
}

/**
 * Fetches an order with role-based access control. Returns a "virtual" group
 * summary if the ID is a checkout group identifier and no concrete order
 * exists.
 *
 * Throws: 403 (access denied), 404 (not found), 500 (data integrity).
 */
export async function getOrderWithAccess(orderId, userId, role) {
  const orderKey = orderMatchQueryFlexible(orderId);
  if (!orderKey) {
    throw svcErr("Order not found", 404);
  }

  let order = await Order.findOne(orderKey)
    .populate("customer", "name email phone")
    .populate("items.product", "name mainImage price salePrice")
    .populate("deliveryBoy", "name phone")
    .populate("returnDeliveryBoy", "name phone")
    .populate("seller", "shopName name address phone location")
    .lean();

  // MLM-internal orders (joining package, home-shopping) are hidden
  // accounting records, not customer-facing receipts. Hide them from
  // the customer order-detail surface so the storefront UI never lands
  // on the "Order Cancelled / Order Items / Bill Summary" page for a
  // membership purchase. Admins/support staff still see them for
  // reconciliation. This mirrors the list-side filter in
  // `getCustomerOrders` and gives belt-and-braces coverage when a deep
  // link slips through (e.g. an old payment-status redirect).
  if (order && (order.isJoiningPackageOrder || order.isHomeShoppingOrder)) {
    const roleNorm = String(role || "").toLowerCase();
    if (roleNorm === "customer" || roleNorm === "user") {
      throw svcErr("Order not found", 404);
    }
  }

  if (!order) {
    if (orderId && orderId.startsWith("CHK-")) {
      const group = await CheckoutGroup.findOne({
        checkoutGroupId: orderId,
      }).lean();
      if (group) {
        return {
          isGroupSummary: true,
          payload: {
            orderId: group.checkoutGroupId,
            status: group.status?.toLowerCase() || "pending",
            orderStatus: group.status?.toLowerCase() || "pending",
            paymentStatus:
              group.paymentStatus === "CAPTURED"
                ? "PAID"
                : group.paymentStatus || "CREATED",
            workflowStatus: group.status || "CREATED",
            pricing: {
              subtotal: group.pricingSummary?.subtotal || 0,
              deliveryFee: group.pricingSummary?.deliveryFee || 0,
              platformFee: group.pricingSummary?.platformFee || 0,
              total: group.pricingSummary?.totalAmount || 0,
            },
            address: group.addressSnapshot || {},
            items: [],
            createdAt: group.createdAt,
            isGroupSummary: true,
            isFragmented: true,
          },
        };
      }
    }
    throw svcErr("Order not found", 404);
  }

  // Defensive: customer reference integrity check (BUGFIX preserved)
  if (!order.customer) {
    logger.error("Order has null/undefined customer field", {
      scope: "ORDER_BUG",
      orderId: order.orderId,
      _id: order._id,
      workflowStatus: order.workflowStatus,
    });

    const rawOrder = await Order.findOne(orderKey).lean();
    if (rawOrder && rawOrder.customer) {
      logger.error("Customer reference exists but failed to populate", {
        scope: "ORDER_BUG",
        orderId: order.orderId,
        customerRef: rawOrder.customer,
      });
      order.customer = rawOrder.customer;
    } else {
      logger.error("Customer field is null in database", {
        scope: "ORDER_BUG",
        orderId: order.orderId,
      });
      throw svcErr(
        "Order data integrity error: customer reference is missing",
        500,
      );
    }
  }

  if (!order.workflowStatus) {
    order.workflowStatus = resolveWorkflowStatus(order);
  }

  const uid = userId != null ? String(userId).trim() : "";
  const roleNorm = String(role || "").toLowerCase();
  const sellerIdStr =
    typeof order.seller === "object" && order.seller?._id
      ? order.seller._id.toString()
      : order.seller?.toString();

  const customerIdStr = refToIdString(order.customer);

  const isOwnerCustomer =
    (roleNorm === "customer" || roleNorm === "user") &&
    order.customer &&
    customerIdStr === uid;
  const isOwnerSeller = role === "seller" && sellerIdStr === uid;
  const primaryRiderId = refToIdString(order.deliveryBoy);
  const returnRiderId = refToIdString(order.returnDeliveryBoy);
  const isAssignedDeliveryBoy =
    role === "delivery" &&
    (primaryRiderId === uid || returnRiderId === uid);

  const isBroadcastedOrder =
    role === "delivery" &&
    ((!order.deliveryBoy &&
      order.workflowStatus === WORKFLOW_STATUS.DELIVERY_SEARCH) ||
      (!order.returnDeliveryBoy &&
        ["return_approved", "return_pickup_assigned"].includes(
          order.returnStatus,
        )));

  const isAdmin = role === "admin";

  if (
    !isOwnerCustomer &&
    !isOwnerSeller &&
    !isAssignedDeliveryBoy &&
    !isBroadcastedOrder &&
    !isAdmin
  ) {
    logger.warn("Authorization denied for order", {
      scope: "ORDER_ACCESS",
      orderId: order.orderId,
      requestedBy: uid,
      role: roleNorm,
      customerIdStr,
      hasCustomer: !!order.customer,
    });
    throw svcErr(
      "Access denied. You are not authorized to view this order.",
      403,
    );
  }

  return {
    isGroupSummary: false,
    payload: order,
  };
}

/**
 * Returns paginated seller/admin view of orders with active return status.
 */
export async function getSellerReturns({
  role,
  userId,
  filters = {},
  pagination,
}) {
  const { status, startDate, endDate } = filters;
  const { page, limit, skip } = pagination;

  const query = {};
  if (role !== "admin") {
    query.seller = userId;
  }
  query.returnStatus = { $ne: "none" };

  if (status && status !== "all") {
    query.returnStatus = status;
  }

  if (startDate || endDate) {
    query.returnRequestedAt = {};
    if (startDate) {
      query.returnRequestedAt.$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.returnRequestedAt.$lte = end;
    }
  }

  const [orders, total] = await Promise.all([
    Order.find(query)
      .sort({ returnRequestedAt: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate("customer", "name phone")
      .populate("returnDeliveryBoy", "name phone")
      .lean(),
    Order.countDocuments(query),
  ]);

  return {
    items: orders,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export default {
  buildSellerOrdersQuery,
  fetchSellerOrdersPage,
  fetchAvailableOrdersForDelivery,
  getCustomerOrders,
  getOrderWithAccess,
  getSellerReturns,
};
