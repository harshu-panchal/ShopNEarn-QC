import React from 'react';
import { useAuth } from '@core/context/AuthContext';
import { hasAnyPermission, hasPermission } from './permissions';

/**
 * Conditionally render children when the current admin has the required
 * permission(s). Prefer backend enforcement for security.
 */
const PermissionGate = ({
  permission,
  permissions,
  requireAll = false,
  fallback = null,
  children,
}) => {
  const { user } = useAuth();

  const allowed = (() => {
    if (Array.isArray(permissions) && permissions.length > 0) {
      if (requireAll) {
        return permissions.every((key) => hasPermission(user, key));
      }
      return hasAnyPermission(user, permissions);
    }
    return hasPermission(user, permission);
  })();

  if (!allowed) return fallback;
  return <>{children}</>;
};

export default PermissionGate;
