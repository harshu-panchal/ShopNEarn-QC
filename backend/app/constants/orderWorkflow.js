/**
 * Canonical workflow statuses for Quick Commerce orders (v2).
 * Legacy `status` on Order is kept in sync for admin / older UIs.
 */
export const WORKFLOW_STATUS = {
  CREATED: "CREATED",
  SELLER_PENDING: "SELLER_PENDING",
  SELLER_ACCEPTED: "SELLER_ACCEPTED",
  DELIVERY_SEARCH: "DELIVERY_SEARCH",
  DELIVERY_ASSIGNED: "DELIVERY_ASSIGNED",
  PICKUP_READY: "PICKUP_READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
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
      return "pending";
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
