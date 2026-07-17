/**
 * Admin RBAC helpers for the SPA.
 * Backend remains authoritative; these helpers only drive UX (nav / buttons / route guards).
 */

export const SUPER_ADMIN_ROLE_KEY = 'super_admin';

export function getAdminPermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions)) return user.permissions;
  if (Array.isArray(user?.adminRole?.permissions)) return user.adminRole.permissions;
  return [];
}

export function hasPermission(user, permissionKey) {
  if (!permissionKey) return true;
  const permissions = getAdminPermissions(user);
  return permissions.includes(permissionKey);
}

export function hasAnyPermission(user, permissionKeys = []) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return true;
  return permissionKeys.some((key) => hasPermission(user, key));
}

export function hasAllPermissions(user, permissionKeys = []) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return true;
  return permissionKeys.every((key) => hasPermission(user, key));
}

export function isSuperAdmin(user) {
  return Boolean(
    user?.isSuperAdmin ||
      user?.adminRole?.key === SUPER_ADMIN_ROLE_KEY ||
      user?.roleKey === SUPER_ADMIN_ROLE_KEY,
  );
}

/**
 * Resolve the permission requirement on a nav/route item.
 * Supports `permission` (string) or `permissions` (array = any-of).
 */
export function itemPermissionKeys(item) {
  if (!item) return [];
  if (Array.isArray(item.permissions) && item.permissions.length > 0) {
    return item.permissions;
  }
  if (item.permission) return [item.permission];
  return [];
}

export function canAccessNavItem(user, item) {
  if (!item) return false;
  const keys = itemPermissionKeys(item);
  if (keys.length === 0) return true;
  return hasAnyPermission(user, keys);
}

/**
 * Filter a nav tree so parents without any visible children are removed.
 * Items with no permission metadata remain visible (e.g. My Profile).
 */
export function filterNavItemsByPermissions(navItems, user) {
  if (!Array.isArray(navItems)) return [];

  return navItems
    .map((item) => {
      if (Array.isArray(item.children) && item.children.length > 0) {
        const children = item.children.filter((child) => canAccessNavItem(user, child));
        if (children.length === 0) return null;

        // Parent is visible if it has its own permission OR any visible child.
        if (item.permission || item.permissions) {
          if (!canAccessNavItem(user, item)) return null;
        }

        return { ...item, children };
      }

      return canAccessNavItem(user, item) ? item : null;
    })
    .filter(Boolean);
}

export function firstPermittedAdminPath(navItems, user, fallback = '/admin/profile') {
  const filtered = filterNavItemsByPermissions(navItems, user);
  for (const item of filtered) {
    if (item.path) return item.path;
    if (Array.isArray(item.children)) {
      const child = item.children.find((c) => c.path);
      if (child?.path) return child.path;
    }
  }
  return fallback;
}
