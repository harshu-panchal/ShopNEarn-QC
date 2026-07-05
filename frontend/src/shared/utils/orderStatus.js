/**
 * Single source of truth for order status across customer, seller, delivery, and admin UIs.
 * Mirrors backend `legacyStatusFromWorkflow` (see backend/app/constants/orderWorkflow.js).
 */

export const WORKFLOW_STATUS = {
  CREATED: "CREATED",
  SELLER_PENDING: "SELLER_PENDING",
  FRANCHISE_PENDING: "FRANCHISE_PENDING",
  FRANCHISE_ACCEPTED: "FRANCHISE_ACCEPTED",
  SELLER_ACCEPTED: "SELLER_ACCEPTED",
  DELIVERY_SEARCH: "DELIVERY_SEARCH",
  DELIVERY_ASSIGNED: "DELIVERY_ASSIGNED",
  PICKUP_READY: "PICKUP_READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};

const LEGACY_ENUM = new Set([
  "pending",
  "confirmed",
  "packed",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);

function legacyFromWorkflow(workflowStatus) {
  switch (workflowStatus) {
    case WORKFLOW_STATUS.CREATED:
    case WORKFLOW_STATUS.SELLER_PENDING:
    case WORKFLOW_STATUS.FRANCHISE_PENDING:
      return "pending";
    case WORKFLOW_STATUS.FRANCHISE_ACCEPTED:
      return "confirmed";
    case WORKFLOW_STATUS.SELLER_ACCEPTED:
    case WORKFLOW_STATUS.DELIVERY_SEARCH:
      return "confirmed";
    case WORKFLOW_STATUS.DELIVERY_ASSIGNED:
    case WORKFLOW_STATUS.PICKUP_READY:
      return "confirmed";
    case WORKFLOW_STATUS.OUT_FOR_DELIVERY:
      return "out_for_delivery";
    case WORKFLOW_STATUS.DELIVERED:
      return "delivered";
    case WORKFLOW_STATUS.CANCELLED:
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Normalized legacy bucket (matches Order.status enum + v2 workflow mapping).
 * Use for filters, tabs, and comparisons across panels.
 */
export function getLegacyStatusFromOrder(order) {
  if (!order) return "pending";

  if (order.franchisePartnerId && order.isFranchiseStockOrder !== true) {
    if (order.franchiseStatus === "fulfilled") return "delivered";
    if (order.franchiseStatus === "rejected") return "cancelled";
    if (order.franchiseStatus === "accepted" && order.shipmentStatus === "created") {
      return "packed";
    }
  }

  const v = Number(order.workflowVersion) || 0;
  if (v >= 2 && order.workflowStatus) {
    const workflowStatus = String(order.workflowStatus).toUpperCase();

    if (workflowStatus === WORKFLOW_STATUS.OUT_FOR_DELIVERY) {
      return "out_for_delivery";
    }
    if (workflowStatus === WORKFLOW_STATUS.DELIVERED) {
      return "delivered";
    }
    if (
      workflowStatus === WORKFLOW_STATUS.DELIVERY_ASSIGNED ||
      workflowStatus === WORKFLOW_STATUS.PICKUP_READY
    ) {
      return "confirmed";
    }

    return legacyFromWorkflow(workflowStatus);
  }

  const riderStep = Number(order.deliveryRiderStep) || 0;
  if (riderStep >= 3 || order.outForDeliveryAt || order.pickupConfirmedAt) {
    return "out_for_delivery";
  }
  if (riderStep >= 1 || order.assignedAt || order.pickupReadyAt || order.deliveryBoy) {
    return "confirmed";
  }

  const s = String(order.status ?? "pending").toLowerCase();
  if (LEGACY_ENUM.has(s)) return s;
  return "pending";
}

const DISPLAY_LABELS = {
  pending: "Pending",
  confirmed: "Confirmed",
  packed: "Packed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Human-readable status for list/detail badges (customer-facing tone). */
export function getOrderStatusLabel(order) {
  const rs = order?.returnStatus;
  if (rs && rs !== "none") {
    switch (rs) {
      case "return_requested": return "Return Requested";
      case "return_approved": return "Return Approved";
      case "return_pickup_assigned": return "Pickup Assigned";
      case "return_pickup_verified": return "Pickup Verified";
      case "returned": return "Return Delivered to Seller";
      case "qc_passed": return "Return QC Passed";
      case "qc_failed": return "Return QC Failed";
      case "refund_completed": return "Returned & Refunded";
      default: return rs.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    }
  }

  if (order?.franchisePartnerId && order?.isFranchiseStockOrder !== true) {
    const fs = order.franchiseStatus;
    if (fs === "fulfilled") return "Delivered";
    if (fs === "rejected") return "Cancelled";
    if (fs === "pending") return "Awaiting partner";
    if (fs === "accepted") {
      if (order.shipmentStatus === "created") return "Partner shipping";
      return "Partner accepted";
    }
  }

  const bucket = getLegacyStatusFromOrder(order);
  return DISPLAY_LABELS[bucket] || bucket.replace(/_/g, " ");
}

/**
 * Admin sidebar uses path segments like `processed` and `out-for-delivery`.
 * Map route param → whether an order belongs in that view.
 */
export function adminRouteMatchesOrder(routeStatus, order) {
  const legacy = getLegacyStatusFromOrder(order);
  if (routeStatus === "all") return true;
  if (routeStatus === "pending") return legacy === "pending";
  if (routeStatus === "processed") {
    return legacy === "confirmed" || legacy === "packed";
  }
  if (routeStatus === "out-for-delivery") {
    return legacy === "out_for_delivery";
  }
  if (routeStatus === "delivered") return legacy === "delivered";
  if (routeStatus === "cancelled") return legacy === "cancelled";
  if (routeStatus === "returned") {
    const rs = order?.returnStatus;
    return rs && rs !== "none";
  }
  return legacy === routeStatus;
}

/** Display name for the franchise partner assigned to a hub order. */
export function getFranchisePartnerDisplayName(order) {
  const partner = order?.franchisePartnerId;
  if (!partner) return null;
  if (typeof partner === "object") {
    const name = String(partner.displayName || "").trim();
    if (name) return name;
    const code = String(partner.referralCode || "").trim();
    if (code) return code;
  }
  return null;
}

/** Resolve a line-item thumbnail from snapshot or populated product. */
export function getOrderItemImage(item) {
  if (!item) return null;
  const direct = String(item.image || "").trim();
  if (direct) return direct;
  const product = item.product;
  if (product && typeof product === "object") {
    const fromProduct = String(product.mainImage || product.image || "").trim();
    if (fromProduct) return fromProduct;
  }
  return null;
}

/** Canonical order total for list/detail cards. */
export function getOrderDisplayTotal(order) {
  return Number(
    order?.paymentBreakdown?.grandTotal ??
      order?.pricing?.total ??
      order?.items?.reduce(
        (sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 1),
        0,
      ) ??
      0,
  );
}

/** Primary line + multi-item summary for order history rows. */
export function getOrderLineSummary(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    return { primaryName: "Order items", extraCount: 0, totalQty: 0 };
  }
  const primaryName =
    String(items[0]?.name || items[0]?.product?.name || "Item").trim() || "Item";
  const extraCount = Math.max(0, items.length - 1);
  const totalQty = items.reduce((sum, line) => sum + Number(line.quantity || 1), 0);
  return { primaryName, extraCount, totalQty };
}

const CUSTOMER_STATUS_STYLES = {
  pending: {
    badge: "bg-amber-50 text-amber-800 border-amber-100",
    icon: "text-amber-600",
  },
  confirmed: {
    badge: "bg-blue-50 text-blue-800 border-blue-100",
    icon: "text-blue-600",
  },
  packed: {
    badge: "bg-indigo-50 text-indigo-800 border-indigo-100",
    icon: "text-indigo-600",
  },
  out_for_delivery: {
    badge: "bg-violet-50 text-violet-800 border-violet-100",
    icon: "text-violet-600",
  },
  delivered: {
    badge: "bg-emerald-50 text-emerald-800 border-emerald-100",
    icon: "text-emerald-600",
  },
  cancelled: {
    badge: "bg-rose-50 text-rose-800 border-rose-100",
    icon: "text-rose-600",
  },
};

export function getCustomerOrderStatusStyles(order) {
  const legacy = getLegacyStatusFromOrder(order);
  return CUSTOMER_STATUS_STYLES[legacy] || CUSTOMER_STATUS_STYLES.pending;
}
