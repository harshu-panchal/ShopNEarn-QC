import {
  FRANCHISE_HUB_ACCEPTANCE_STATUS,
  FRANCHISE_ORDER_STATUS,
  FRANCHISE_SHIPMENT_STATUS,
} from "./franchise.js";

/**
 * Canonical workflow statuses for Quick Commerce orders (v2).
 * Legacy `status` on Order is kept in sync for admin / older UIs.
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
  PENDING_HUB_DISPATCH: "PENDING_HUB_DISPATCH",
  DISPATCHED_PENDING_RECEIPT: "DISPATCHED_PENDING_RECEIPT",
};

/** Milliseconds — override via env in services */
export const DEFAULT_SELLER_TIMEOUT_MS = () =>
  parseInt(process.env.SELLER_TIMEOUT_MS || "60000", 10);
export const DEFAULT_DELIVERY_TIMEOUT_MS = () =>
  parseInt(process.env.DELIVERY_TIMEOUT_MS || "60000", 10);

/**
 * Return-pickup broadcast assignment knobs — mirror the
 * delivery-search state machine so returns get the same
 * scheduler / radius-expansion / give-up semantics.
 */
export const DEFAULT_RETURN_PICKUP_TIMEOUT_MS = () =>
  parseInt(process.env.RETURN_PICKUP_TIMEOUT_MS || "60000", 10);
export const RETURN_PICKUP_SEARCH_MAX_ATTEMPTS = () =>
  parseInt(process.env.RETURN_PICKUP_MAX_ATTEMPTS || "3", 10);
export const INITIAL_RETURN_PICKUP_RADIUS_M = () =>
  parseInt(process.env.INITIAL_RETURN_PICKUP_RADIUS_METERS || "5000", 10);
export const RETURN_PICKUP_RADIUS_MULTIPLIER = () =>
  parseFloat(process.env.RETURN_PICKUP_RADIUS_MULTIPLIER || "1.5");

/**
 * Map workflow -> legacy `status` string (existing enum on Order schema).
 */
export function legacyStatusFromWorkflow(workflowStatus) {
  switch (workflowStatus) {
    case WORKFLOW_STATUS.CREATED:
      return "pending";
    case WORKFLOW_STATUS.SELLER_PENDING:
    case WORKFLOW_STATUS.FRANCHISE_PENDING:
    case WORKFLOW_STATUS.PENDING_HUB_DISPATCH:
      return "pending";
    case WORKFLOW_STATUS.DISPATCHED_PENDING_RECEIPT:
      return "shipped";
    case WORKFLOW_STATUS.FRANCHISE_ACCEPTED:
      return "confirmed";
    case WORKFLOW_STATUS.SELLER_ACCEPTED:
      return "confirmed";
    case WORKFLOW_STATUS.DELIVERY_SEARCH:
      return "confirmed";
    case WORKFLOW_STATUS.DELIVERY_ASSIGNED:
      return "confirmed";
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
 * Infer workflow from legacy `status` when workflowVersion < 2 or missing workflowStatus.
 */
export function workflowFromLegacyStatus(legacy) {
  const s = (legacy || "").toLowerCase();
  if (s === "pending") return WORKFLOW_STATUS.SELLER_PENDING;
  if (s === "confirmed") return WORKFLOW_STATUS.DELIVERY_SEARCH;
  if (s === "packed") return WORKFLOW_STATUS.DELIVERY_ASSIGNED;
  if (s === "out_for_delivery") return WORKFLOW_STATUS.OUT_FOR_DELIVERY;
  if (s === "delivered") return WORKFLOW_STATUS.DELIVERED;
  if (s === "cancelled") return WORKFLOW_STATUS.CANCELLED;
  return WORKFLOW_STATUS.SELLER_PENDING;
}

const LEGACY_STATUS_ENUM = new Set([
  "pending",
  "confirmed",
  "packed",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);

/**
 * Single source of truth for mapping an order document to the legacy status
 * bucket used by admin/seller dropdowns and list filters.
 */
export function resolveLegacyStatusFromOrder(order) {
  if (!order) return "pending";

  const explicit = String(order.status ?? order.orderStatus ?? "").toLowerCase();
  const workflowVersion = Number(order.workflowVersion) || 0;
  const workflowStatus = String(order.workflowStatus || "").toUpperCase();

  const isFranchiseCustomerOrder =
    order.franchisePartnerId && order.isFranchiseStockOrder !== true;

  if (isFranchiseCustomerOrder) {
    if (
      order.franchiseStatus === FRANCHISE_ORDER_STATUS.FULFILLED ||
      workflowStatus === WORKFLOW_STATUS.DELIVERED
    ) {
      return "delivered";
    }
    if (
      order.franchiseStatus === FRANCHISE_ORDER_STATUS.REJECTED ||
      workflowStatus === WORKFLOW_STATUS.CANCELLED
    ) {
      return "cancelled";
    }
    if (workflowStatus === WORKFLOW_STATUS.OUT_FOR_DELIVERY) {
      return "out_for_delivery";
    }
    if (
      order.franchiseStatus === FRANCHISE_ORDER_STATUS.ACCEPTED &&
      order.shipmentStatus === FRANCHISE_SHIPMENT_STATUS.CREATED
    ) {
      return "packed";
    }
    if (order.franchiseStatus === FRANCHISE_ORDER_STATUS.ACCEPTED) {
      return "confirmed";
    }
    if (order.franchiseStatus === FRANCHISE_ORDER_STATUS.PENDING) {
      return "pending";
    }
  }

  if (workflowVersion >= 2 && workflowStatus) {
    if (workflowStatus === WORKFLOW_STATUS.OUT_FOR_DELIVERY) {
      return "out_for_delivery";
    }
    if (workflowStatus === WORKFLOW_STATUS.DELIVERED) {
      return "delivered";
    }
    if (workflowStatus === WORKFLOW_STATUS.CANCELLED) {
      return "cancelled";
    }
    if (
      workflowStatus === WORKFLOW_STATUS.DELIVERY_ASSIGNED ||
      workflowStatus === WORKFLOW_STATUS.PICKUP_READY
    ) {
      if (explicit === "packed") return "packed";
      return "confirmed";
    }
    return legacyStatusFromWorkflow(workflowStatus);
  }

  const riderStep = Number(order.deliveryRiderStep) || 0;
  if (riderStep >= 3 || order.outForDeliveryAt || order.pickupConfirmedAt) {
    return "out_for_delivery";
  }
  if (
    riderStep >= 1 ||
    order.assignedAt ||
    order.pickupReadyAt ||
    order.deliveryBoy
  ) {
    return "confirmed";
  }

  if (LEGACY_STATUS_ENUM.has(explicit)) return explicit;
  return "pending";
}

/**
 * Keep canonical workflow / franchise fields aligned when admin or seller
 * manually changes the legacy `status` dropdown (v2 orders).
 */
export function applyManualLegacyStatusOverride(order, legacyStatus) {
  const s = String(legacyStatus || "").toLowerCase();
  if (!s) return;

  order.status = s;
  order.orderStatus = s;

  const workflowVersion = Number(order.workflowVersion) || 0;
  const isFranchiseCustomerOrder =
    order.franchisePartnerId && order.isFranchiseStockOrder !== true;

  if (isFranchiseCustomerOrder) {
    switch (s) {
      case "pending":
        order.franchiseStatus = FRANCHISE_ORDER_STATUS.PENDING;
        order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.PENDING;
        if (workflowVersion >= 2) {
          order.workflowStatus = WORKFLOW_STATUS.FRANCHISE_PENDING;
        }
        break;
      case "confirmed":
        order.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
        order.hubAcceptanceStatus = FRANCHISE_HUB_ACCEPTANCE_STATUS.ACCEPTED;
        order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.PENDING;
        if (workflowVersion >= 2) {
          order.workflowStatus = WORKFLOW_STATUS.FRANCHISE_ACCEPTED;
        }
        break;
      case "packed":
        order.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
        order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.CREATED;
        if (workflowVersion >= 2) {
          order.workflowStatus = WORKFLOW_STATUS.DELIVERY_ASSIGNED;
        }
        break;
      case "out_for_delivery":
        order.franchiseStatus = FRANCHISE_ORDER_STATUS.ACCEPTED;
        order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.CREATED;
        order.outForDeliveryAt = order.outForDeliveryAt || new Date();
        if (workflowVersion >= 2) {
          order.workflowStatus = WORKFLOW_STATUS.OUT_FOR_DELIVERY;
        }
        break;
      case "delivered":
        order.franchiseStatus = FRANCHISE_ORDER_STATUS.FULFILLED;
        order.shipmentStatus = FRANCHISE_SHIPMENT_STATUS.CREATED;
        order.deliveredAt = order.deliveredAt || new Date();
        if (workflowVersion >= 2) {
          order.workflowStatus = WORKFLOW_STATUS.DELIVERED;
        }
        break;
      case "cancelled":
        order.franchiseStatus = FRANCHISE_ORDER_STATUS.REJECTED;
        if (workflowVersion >= 2) {
          order.workflowStatus = WORKFLOW_STATUS.CANCELLED;
        }
        break;
      default:
        break;
    }
    return;
  }

  if (workflowVersion >= 2) {
    order.workflowStatus = workflowFromLegacyStatus(s);
    if (s === "packed") {
      order.workflowStatus = WORKFLOW_STATUS.DELIVERY_ASSIGNED;
    }
    if (s === "out_for_delivery") {
      order.outForDeliveryAt = order.outForDeliveryAt || new Date();
    }
    if (s === "delivered") {
      order.deliveredAt = order.deliveredAt || new Date();
    }
  }
}
