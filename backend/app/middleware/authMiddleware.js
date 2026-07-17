import jwt from "jsonwebtoken";
import handleResponse from "../utils/helper.js";
import Seller from "../models/seller.js";
import {
  hasAdminPermission,
  hasAnyAdminPermission,
} from "../constants/adminPermissions.js";
import { resolveAdminAccess } from "../services/admin/adminRbacService.js";
import {
  createAdminAuditLog,
  requestAuditContext,
} from "../services/admin/adminAuditLogService.js";

function extractJwtFromHeaders(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (authHeader) {
    const parts = authHeader.split(/\s+/);
    if (parts.length >= 2 && /^bearer$/i.test(parts[0])) {
      return parts[1];
    }

    // Allow raw JWT in Authorization header for non-standard clients.
    // Still requires signature verification so it doesn't weaken auth.
    if (authHeader.split(".").length === 3) {
      return authHeader;
    }
  }

  const xAccessToken = String(req.headers["x-access-token"] || "").trim();
  if (xAccessToken && xAccessToken.split(".").length === 3) {
    return xAccessToken;
  }

  return null;
}

/* ===============================
   Verify Token
================================ */
export const verifyToken = (req, res, next) => {
  try {
    const token = extractJwtFromHeaders(req);

    if (!token) {
      return handleResponse(res, 401, "Unauthorized, token missing");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded; // { id, role, tokenVersion?, adminRoleId? }
    next();
  } catch (error) {
    return handleResponse(res, 401, "Invalid or expired token");
  }
};

/* ===============================
   Optional Verify Token (for public routes that need user context)
================================ */
export const optionalVerifyToken = (req, res, next) => {
  try {
    const token = extractJwtFromHeaders(req);

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id, role }
      } catch (error) {
        // Token is invalid, but we don't block the request
        req.user = null;
      }
    }

    next();
  } catch (error) {
    // Don't block the request, just continue without user
    next();
  }
};

/* ===============================
   Role Based Access (portal actor role)
================================ */
export const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return handleResponse(res, 403, "Access denied");
    }
    next();
  };
};

/**
 * Load the Admin document + role permissions after portal-level
 * allowRoles("admin"). Attaches req.admin and req.adminAccess.
 */
export const requireActiveAdmin = async (req, res, next) => {
  try {
    if (!req.user?.id || req.user.role !== "admin") {
      return handleResponse(res, 403, "Access denied");
    }

    const access = await resolveAdminAccess(req.user.id);
    const tokenVersion = Number(req.user.tokenVersion ?? 0);
    const currentVersion = Number(access.tokenVersion || 0);

    if (tokenVersion !== currentVersion) {
      return handleResponse(res, 401, "Session expired. Please sign in again.");
    }

    req.admin = access.admin;
    req.adminAccess = {
      roleKey: access.roleKey,
      roleName: access.roleName,
      roleId: access.role?._id || null,
      permissions: access.permissions,
      permissionSet: access.permissionSet,
      isSuperAdmin: access.isSuperAdmin,
      tokenVersion: currentVersion,
    };

    return next();
  } catch (error) {
    const status = error.statusCode || 500;
    if (status === 403 || status === 404) {
      return handleResponse(res, status === 404 ? 401 : 403, error.message);
    }
    return handleResponse(res, 500, "Unable to validate admin access");
  }
};

export const requireAdminPermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (!req.adminAccess) {
        return handleResponse(res, 403, "Access denied");
      }

      if (!hasAdminPermission(req.adminAccess.permissionSet, permissionKey)) {
        try {
          await createAdminAuditLog({
            ...requestAuditContext(req),
            action: "permission.denied",
            targetType: "Permission",
            targetId: permissionKey,
            metadata: {
              path: req.originalUrl || req.url,
              method: req.method,
              required: permissionKey,
            },
          });
        } catch {
          // Audit failures must not block the 403 response.
        }
        return handleResponse(res, 403, "Insufficient permissions");
      }

      return next();
    } catch (error) {
      return handleResponse(res, 500, "Unable to validate admin permission");
    }
  };
};

export const requireAnyAdminPermission = (permissionKeys = []) => {
  return async (req, res, next) => {
    try {
      if (!req.adminAccess) {
        return handleResponse(res, 403, "Access denied");
      }

      if (!hasAnyAdminPermission(req.adminAccess.permissionSet, permissionKeys)) {
        try {
          await createAdminAuditLog({
            ...requestAuditContext(req),
            action: "permission.denied",
            targetType: "Permission",
            targetId: permissionKeys.join(","),
            metadata: {
              path: req.originalUrl || req.url,
              method: req.method,
              requiredAny: permissionKeys,
            },
          });
        } catch {
          // ignore audit errors
        }
        return handleResponse(res, 403, "Insufficient permissions");
      }

      return next();
    } catch (error) {
      return handleResponse(res, 500, "Unable to validate admin permission");
    }
  };
};

/** Portal auth + active admin load. */
export const adminAuthGuard = [verifyToken, allowRoles("admin"), requireActiveAdmin];

/** Portal auth + active admin + single permission. */
export const adminPermissionGuard = (permissionKey) => [
  ...adminAuthGuard,
  requireAdminPermission(permissionKey),
];

/** Portal auth + active admin + any of the listed permissions. */
export const adminAnyPermissionGuard = (permissionKeys) => [
  ...adminAuthGuard,
  requireAnyAdminPermission(permissionKeys),
];

/**
 * For shared routes (admin + seller/delivery/customer): when the caller is
 * an admin, load active-admin access and require the given permission.
 * Non-admin portal roles pass through unchanged.
 */
export const requireAdminPermissionIfAdmin = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (req.user?.role !== "admin") {
        return next();
      }

      if (!req.adminAccess) {
        const access = await resolveAdminAccess(req.user.id);
        const tokenVersion = Number(req.user.tokenVersion ?? 0);
        const currentVersion = Number(access.tokenVersion || 0);
        if (tokenVersion !== currentVersion) {
          return handleResponse(res, 401, "Session expired. Please sign in again.");
        }
        req.admin = access.admin;
        req.adminAccess = {
          roleKey: access.roleKey,
          roleName: access.roleName,
          roleId: access.role?._id || null,
          permissions: access.permissions,
          permissionSet: access.permissionSet,
          isSuperAdmin: access.isSuperAdmin,
          tokenVersion: currentVersion,
        };
      }

      if (!hasAdminPermission(req.adminAccess.permissionSet, permissionKey)) {
        return handleResponse(res, 403, "Insufficient permissions");
      }
      return next();
    } catch (error) {
      const status = error.statusCode || 500;
      if (status === 403 || status === 404) {
        return handleResponse(res, status === 404 ? 401 : 403, error.message);
      }
      return handleResponse(res, 500, "Unable to validate admin permission");
    }
  };
};

/* ===============================
   Ensure seller can access seller-only operational routes
================================ */
export const requireApprovedSeller = async (req, res, next) => {
  try {
    if (req.user?.role !== "seller") {
      return next();
    }

    const seller = await Seller.findById(req.user.id)
      .select("isVerified isActive applicationStatus rejectionReason")
      .lean();

    if (!seller) {
      return handleResponse(res, 401, "Seller account not found");
    }

    const applicationStatus =
      seller.applicationStatus || (seller.isVerified ? "approved" : "pending");
    const isApproved =
      seller.isVerified === true &&
      seller.isActive === true &&
      applicationStatus === "approved";

    if (!isApproved) {
      const message =
        applicationStatus === "rejected"
          ? "Seller application rejected. Please contact admin support."
          : "Seller account is pending admin approval.";

      return handleResponse(res, 403, message, {
        applicationStatus,
        isVerified: seller.isVerified === true,
        isActive: seller.isActive === true,
        rejectionReason: seller.rejectionReason || "",
      });
    }

    next();
  } catch (error) {
    return handleResponse(res, 500, "Unable to validate seller approval status");
  }
};
