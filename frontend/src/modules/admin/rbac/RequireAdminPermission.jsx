import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@core/context/AuthContext';
import { hasAnyPermission, hasPermission } from './permissions';
import AdminAccessDenied from '../pages/access/AdminAccessDenied';

/**
 * Route-level admin permission guard.
 */
const RequireAdminPermission = ({
  permission,
  permissions,
  children,
  redirectTo = null,
}) => {
  const { user, isLoading, isAuthenticated, role } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated || role !== 'admin') {
    return <Navigate to="/admin/auth" replace />;
  }

  const allowed = Array.isArray(permissions) && permissions.length > 0
    ? hasAnyPermission(user, permissions)
    : hasPermission(user, permission);

  if (!allowed) {
    if (redirectTo) return <Navigate to={redirectTo} replace />;
    return <AdminAccessDenied missing={permission || (permissions || []).join(', ')} />;
  }

  return <>{children}</>;
};

export default RequireAdminPermission;
