/**
 * Canonical admin-panel permission catalog.
 *
 * Portal JWT role remains `"admin"`. These keys are the fine-grained
 * within-admin RBAC permissions stored on AdminRole and checked by
 * requireAdminPermission middleware.
 */

export const SUPER_ADMIN_ROLE_KEY = "super_admin";

export const ADMIN_PERMISSION_ACTIONS = Object.freeze({
  VIEW: "view",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  APPROVE: "approve",
  REJECT: "reject",
  EXPORT: "export",
  PROCESS: "process",
  SETTLE: "settle",
  ADJUST: "adjust",
  IMPERSONATE: "impersonate",
  MANAGE: "manage",
  SEND: "send",
  REPLY: "reply",
  MODERATE: "moderate",
  MOVE: "move",
  SETTINGS: "settings",
  PAYOUT: "payout",
  MAINTENANCE: "maintenance",
  DISPATCH: "dispatch",
  TRACK: "track",
  RETURNS: "returns",
  REFUND: "refund",
  ASSIGN: "assign",
});

/**
 * @typedef {{ key: string, module: string, action: string, label: string }} AdminPermissionDef
 */

/** @type {readonly AdminPermissionDef[]} */
export const ADMIN_PERMISSION_DEFINITIONS = Object.freeze([
  { key: "dashboard:view", module: "dashboard", action: "view", label: "View Dashboard" },

  { key: "categories:view", module: "categories", action: "view", label: "View Categories" },
  { key: "categories:create", module: "categories", action: "create", label: "Create Categories" },
  { key: "categories:update", module: "categories", action: "update", label: "Update Categories" },
  { key: "categories:delete", module: "categories", action: "delete", label: "Delete Categories" },

  { key: "products:view", module: "products", action: "view", label: "View Products" },
  { key: "products:update", module: "products", action: "update", label: "Update Products" },
  { key: "products:approve", module: "products", action: "approve", label: "Approve Products" },
  { key: "products:reject", module: "products", action: "reject", label: "Reject Products" },
  { key: "products:export", module: "products", action: "export", label: "Export Products" },

  { key: "marketing:view", module: "marketing", action: "view", label: "View Marketing" },
  { key: "marketing:create", module: "marketing", action: "create", label: "Create Marketing" },
  { key: "marketing:update", module: "marketing", action: "update", label: "Update Marketing" },
  { key: "marketing:delete", module: "marketing", action: "delete", label: "Delete Marketing" },
  { key: "marketing:send", module: "marketing", action: "send", label: "Send Notifications" },

  { key: "support:view", module: "support", action: "view", label: "View Support" },
  { key: "support:update", module: "support", action: "update", label: "Update Support" },
  { key: "support:reply", module: "support", action: "reply", label: "Reply to Tickets" },
  { key: "support:moderate", module: "support", action: "moderate", label: "Moderate Reviews" },

  { key: "sellers:view", module: "sellers", action: "view", label: "View Sellers" },
  { key: "sellers:approve", module: "sellers", action: "approve", label: "Approve Sellers" },
  { key: "sellers:reject", module: "sellers", action: "reject", label: "Reject Sellers" },
  { key: "sellers:impersonate", module: "sellers", action: "impersonate", label: "Impersonate Sellers" },

  { key: "delivery:view", module: "delivery", action: "view", label: "View Delivery" },
  { key: "delivery:approve", module: "delivery", action: "approve", label: "Approve Drivers" },
  { key: "delivery:reject", module: "delivery", action: "reject", label: "Reject Drivers" },
  { key: "delivery:track", module: "delivery", action: "track", label: "Track Drivers" },
  { key: "delivery:settle", module: "delivery", action: "settle", label: "Settle Delivery Funds" },

  { key: "finance:view", module: "finance", action: "view", label: "View Finance" },
  { key: "finance:export", module: "finance", action: "export", label: "Export Finance" },
  { key: "finance:process", module: "finance", action: "process", label: "Process Finance Payouts" },
  { key: "finance:settle", module: "finance", action: "settle", label: "Settle Withdrawals" },

  { key: "cash:view", module: "cash", action: "view", label: "View Cash Collection" },
  { key: "cash:settle", module: "cash", action: "settle", label: "Settle Cash" },

  { key: "customers:view", module: "customers", action: "view", label: "View Customers" },

  { key: "inventory:view", module: "inventory", action: "view", label: "View Inventory Reports" },
  { key: "inventory:export", module: "inventory", action: "export", label: "Export Inventory Reports" },

  { key: "mlm:view", module: "mlm", action: "view", label: "View MLM" },
  { key: "mlm:approve", module: "mlm", action: "approve", label: "Approve MLM" },
  { key: "mlm:reject", module: "mlm", action: "reject", label: "Reject MLM" },
  { key: "mlm:adjust", module: "mlm", action: "adjust", label: "Adjust MLM Wallet" },
  { key: "mlm:move", module: "mlm", action: "move", label: "Move MLM Genealogy" },
  { key: "mlm:settings", module: "mlm", action: "settings", label: "Manage MLM Settings" },
  { key: "mlm:payout", module: "mlm", action: "payout", label: "Manage MLM Payouts" },
  { key: "mlm:maintenance", module: "mlm", action: "maintenance", label: "Run MLM Maintenance" },
  { key: "mlm:impersonate", module: "mlm", action: "impersonate", label: "Impersonate MLM Members" },

  { key: "franchise:view", module: "franchise", action: "view", label: "View Franchise" },
  { key: "franchise:approve", module: "franchise", action: "approve", label: "Approve Franchise" },
  { key: "franchise:reject", module: "franchise", action: "reject", label: "Reject Franchise" },
  { key: "franchise:adjust", module: "franchise", action: "adjust", label: "Adjust Franchise Wallet" },
  { key: "franchise:settings", module: "franchise", action: "settings", label: "Manage Franchise Settings" },
  { key: "franchise:dispatch", module: "franchise", action: "dispatch", label: "Franchise Dispatch" },
  { key: "franchise:impersonate", module: "franchise", action: "impersonate", label: "Impersonate Hub Seller" },

  { key: "content:view", module: "content", action: "view", label: "View Content" },
  { key: "content:create", module: "content", action: "create", label: "Create Content" },
  { key: "content:update", module: "content", action: "update", label: "Update Content" },
  { key: "content:delete", module: "content", action: "delete", label: "Delete Content" },

  { key: "orders:view", module: "orders", action: "view", label: "View Orders" },
  { key: "orders:update", module: "orders", action: "update", label: "Update Orders" },
  { key: "orders:returns", module: "orders", action: "returns", label: "Manage Returns" },
  { key: "orders:refund", module: "orders", action: "refund", label: "Process Refunds" },

  { key: "settings:view", module: "settings", action: "view", label: "View Settings" },
  { key: "settings:update", module: "settings", action: "update", label: "Update Settings" },

  { key: "system:manage", module: "system", action: "manage", label: "Manage System Settings" },

  { key: "rbac:view", module: "rbac", action: "view", label: "View Admin Access" },
  { key: "rbac:create", module: "rbac", action: "create", label: "Create Roles / Admins" },
  { key: "rbac:update", module: "rbac", action: "update", label: "Update Roles / Admins" },
  { key: "rbac:delete", module: "rbac", action: "delete", label: "Delete Roles" },
  { key: "rbac:assign", module: "rbac", action: "assign", label: "Assign Admin Roles" },
]);

export const ALL_ADMIN_PERMISSION_KEYS = Object.freeze(
  ADMIN_PERMISSION_DEFINITIONS.map((item) => item.key),
);

const PERMISSION_KEY_SET = new Set(ALL_ADMIN_PERMISSION_KEYS);

export function isAdminPermissionKey(value) {
  return typeof value === "string" && PERMISSION_KEY_SET.has(value);
}

export function normalizeAdminPermissions(values) {
  if (!Array.isArray(values)) return [];
  const next = [];
  const seen = new Set();
  for (const value of values) {
    if (!isAdminPermissionKey(value) || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  next.sort();
  return next;
}

export function hasAdminPermission(permissionSet, required) {
  if (!required) return true;
  if (!permissionSet) return false;
  if (permissionSet instanceof Set) return permissionSet.has(required);
  if (Array.isArray(permissionSet)) return permissionSet.includes(required);
  return false;
}

export function hasAnyAdminPermission(permissionSet, requiredList) {
  if (!Array.isArray(requiredList) || requiredList.length === 0) return true;
  return requiredList.some((required) => hasAdminPermission(permissionSet, required));
}

export function getAllAdminPermissions() {
  return [...ALL_ADMIN_PERMISSION_KEYS];
}

export function getAdminPermissionCatalogGrouped() {
  const groups = new Map();
  for (const def of ADMIN_PERMISSION_DEFINITIONS) {
    if (!groups.has(def.module)) {
      groups.set(def.module, {
        module: def.module,
        label: def.module
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        permissions: [],
      });
    }
    groups.get(def.module).permissions.push({ ...def });
  }
  return [...groups.values()];
}
