import mongoose from "mongoose";
import Admin from "../../models/admin.js";
import AdminRole from "../../models/adminRole.js";
import {
  SUPER_ADMIN_ROLE_KEY,
  getAllAdminPermissions,
  getAdminPermissionCatalogGrouped,
  hasAdminPermission,
  normalizeAdminPermissions,
} from "../../constants/adminPermissions.js";
import { createAdminAuditLog } from "./adminAuditLogService.js";

function toObjectIdString(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  return String(value);
}

function slugifyRoleKey(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function sanitizeRoleForResponse(roleDoc) {
  if (!roleDoc) return null;
  const role = roleDoc.toObject ? roleDoc.toObject() : { ...roleDoc };
  return {
    _id: role._id,
    name: role.name,
    key: role.key,
    description: role.description || "",
    permissions: Array.isArray(role.permissions) ? [...role.permissions] : [],
    isSystem: role.isSystem === true,
    isActive: role.isActive !== false,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export function sanitizeAdminForResponse(adminDoc, roleDoc = null) {
  if (!adminDoc) return null;
  const admin = adminDoc.toObject ? adminDoc.toObject() : { ...adminDoc };
  delete admin.password;
  delete admin.__v;

  const role =
    roleDoc ||
    (admin.roleId && typeof admin.roleId === "object" && admin.roleId.key
      ? admin.roleId
      : null);

  const permissions = normalizeAdminPermissions(role?.permissions || []);

  return {
    _id: admin._id,
    name: admin.name,
    email: admin.email,
    phone: admin.phone || "",
    role: "admin",
    roleId: role?._id || admin.roleId || null,
    adminRole: role
      ? {
          _id: role._id,
          key: role.key,
          name: role.name,
        }
      : null,
    permissions,
    isSuperAdmin: role?.key === SUPER_ADMIN_ROLE_KEY,
    isVerified: admin.isVerified !== false,
    isActive: admin.isActive !== false,
    lastLogin: admin.lastLogin || null,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

/**
 * Ensure the system super_admin role exists with the full current catalog.
 * Idempotent — safe to call from bootstrap, seed, and backfill.
 */
export async function ensureSuperAdminRole({ session, updatedBy = null } = {}) {
  const permissions = getAllAdminPermissions();
  const query = AdminRole.findOne({ key: SUPER_ADMIN_ROLE_KEY });
  if (session) query.session(session);
  let role = await query;

  if (!role) {
    const [created] = await AdminRole.create(
      [
        {
          name: "Super Admin",
          key: SUPER_ADMIN_ROLE_KEY,
          description: "Full access to the admin panel",
          permissions,
          isSystem: true,
          isActive: true,
          createdBy: updatedBy,
          updatedBy,
        },
      ],
      session ? { session } : undefined,
    );
    return created;
  }

  const nextPermissions = normalizeAdminPermissions([
    ...permissions,
    ...(role.permissions || []),
  ]);
  const catalogChanged =
    nextPermissions.length !== (role.permissions || []).length ||
    nextPermissions.some((key, index) => key !== (role.permissions || [])[index]);

  if (catalogChanged || role.isSystem !== true || role.isActive !== true) {
    role.permissions = nextPermissions;
    role.isSystem = true;
    role.isActive = true;
    role.name = role.name || "Super Admin";
    if (updatedBy) role.updatedBy = updatedBy;
    await role.save(session ? { session } : undefined);
  }

  return role;
}

export async function resolveAdminAccess(adminId, { session } = {}) {
  if (!adminId) {
    const err = new Error("Admin id is required");
    err.statusCode = 400;
    throw err;
  }

  const query = Admin.findById(adminId).populate({
    path: "roleId",
    select: "name key permissions isActive isSystem",
  });
  if (session) query.session(session);
  const admin = await query;

  if (!admin) {
    const err = new Error("Admin not found");
    err.statusCode = 404;
    throw err;
  }

  const role = admin.roleId;
  if (!role || typeof role !== "object" || !role.key) {
    const err = new Error("Admin has no active role assigned");
    err.statusCode = 403;
    throw err;
  }

  if (admin.isActive === false) {
    const err = new Error("Admin account is disabled");
    err.statusCode = 403;
    throw err;
  }

  if (admin.isVerified === false) {
    const err = new Error("Admin account is not verified");
    err.statusCode = 403;
    throw err;
  }

  if (role.isActive === false) {
    const err = new Error("Admin role is inactive");
    err.statusCode = 403;
    throw err;
  }

  const permissions = normalizeAdminPermissions(role.permissions || []);

  return {
    admin,
    role,
    permissions,
    permissionSet: new Set(permissions),
    roleKey: role.key,
    roleName: role.name,
    isSuperAdmin: role.key === SUPER_ADMIN_ROLE_KEY,
    tokenVersion: Number(admin.tokenVersion || 0),
  };
}

export async function countActiveSuperAdmins({ excludeAdminId = null, session } = {}) {
  const role = await ensureSuperAdminRole({ session });
  const filter = {
    roleId: role._id,
    isActive: true,
  };
  if (excludeAdminId) {
    filter._id = { $ne: excludeAdminId };
  }
  const query = Admin.countDocuments(filter);
  if (session) query.session(session);
  return query;
}

export function assertCanMutateRole(actorAccess, targetRole) {
  if (!actorAccess?.isSuperAdmin && targetRole?.key === SUPER_ADMIN_ROLE_KEY) {
    const err = new Error("Only a super admin can modify the super_admin role");
    err.statusCode = 403;
    throw err;
  }

  if (targetRole?.isSystem && targetRole?.key === SUPER_ADMIN_ROLE_KEY) {
    // Super admins may update permissions to keep catalog in sync, but
    // cannot rename/deactivate/delete the system role via normal APIs.
  }
}

export async function listRoles() {
  const roles = await AdminRole.find({})
    .sort({ isSystem: -1, name: 1 })
    .lean();
  return roles.map((role) => sanitizeRoleForResponse(role));
}

export async function getRoleById(roleId) {
  const role = await AdminRole.findById(roleId).lean();
  if (!role) {
    const err = new Error("Role not found");
    err.statusCode = 404;
    throw err;
  }
  return sanitizeRoleForResponse(role);
}

export async function createRole(
  { name, key, description = "", permissions = [], isActive = true },
  { actor, auditContext } = {},
) {
  const roleKey = slugifyRoleKey(key || name);
  if (!roleKey) {
    const err = new Error("Role key is required");
    err.statusCode = 400;
    throw err;
  }
  if (roleKey === SUPER_ADMIN_ROLE_KEY) {
    const err = new Error("Cannot create another role with the reserved super_admin key");
    err.statusCode = 400;
    throw err;
  }

  const normalized = normalizeAdminPermissions(permissions);
  try {
    const role = await AdminRole.create({
      name: String(name).trim(),
      key: roleKey,
      description: String(description || "").trim(),
      permissions: normalized,
      isSystem: false,
      isActive: isActive !== false,
      createdBy: actor?._id || null,
      updatedBy: actor?._id || null,
    });

    if (auditContext) {
      await createAdminAuditLog({
        ...auditContext,
        action: "role.created",
        targetType: "AdminRole",
        targetId: role._id,
        metadata: { key: role.key, permissions: role.permissions },
      });
    }

    return sanitizeRoleForResponse(role);
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error("A role with this name or key already exists");
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }
}

export async function updateRole(
  roleId,
  { name, description, permissions, isActive },
  { actor, actorAccess, auditContext } = {},
) {
  const role = await AdminRole.findById(roleId);
  if (!role) {
    const err = new Error("Role not found");
    err.statusCode = 404;
    throw err;
  }

  assertCanMutateRole(actorAccess, role);

  if (role.key === SUPER_ADMIN_ROLE_KEY) {
    if (typeof isActive === "boolean" && isActive === false) {
      const err = new Error("Cannot deactivate the super_admin role");
      err.statusCode = 400;
      throw err;
    }
    if (name && String(name).trim() !== role.name) {
      const err = new Error("Cannot rename the super_admin role");
      err.statusCode = 400;
      throw err;
    }
  }

  if (name !== undefined) role.name = String(name).trim();
  if (description !== undefined) role.description = String(description || "").trim();
  if (permissions !== undefined) {
    role.permissions = normalizeAdminPermissions(permissions);
    if (role.key === SUPER_ADMIN_ROLE_KEY) {
      // Always keep super admin at least the full catalog.
      role.permissions = normalizeAdminPermissions([
        ...getAllAdminPermissions(),
        ...role.permissions,
      ]);
    }
  }
  if (typeof isActive === "boolean" && role.key !== SUPER_ADMIN_ROLE_KEY) {
    role.isActive = isActive;
  }
  if (actor?._id) role.updatedBy = actor._id;

  try {
    await role.save();
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error("A role with this name already exists");
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }

  if (role.isActive === false) {
    // Invalidate sessions for admins still assigned this inactive role.
    await Admin.updateMany(
      { roleId: role._id, isActive: true },
      { $inc: { tokenVersion: 1 } },
    );
  }

  if (auditContext) {
    await createAdminAuditLog({
      ...auditContext,
      action: "role.updated",
      targetType: "AdminRole",
      targetId: role._id,
      metadata: {
        key: role.key,
        permissions: role.permissions,
        isActive: role.isActive,
      },
    });
  }

  return sanitizeRoleForResponse(role);
}

export async function deleteRole(roleId, { actorAccess, auditContext } = {}) {
  const role = await AdminRole.findById(roleId);
  if (!role) {
    const err = new Error("Role not found");
    err.statusCode = 404;
    throw err;
  }

  assertCanMutateRole(actorAccess, role);

  if (role.isSystem || role.key === SUPER_ADMIN_ROLE_KEY) {
    const err = new Error("System roles cannot be deleted");
    err.statusCode = 400;
    throw err;
  }

  const assignedCount = await Admin.countDocuments({
    roleId: role._id,
    isActive: true,
  });
  if (assignedCount > 0) {
    const err = new Error(
      `Cannot delete role while ${assignedCount} active admin(s) are assigned. Reassign them first.`,
    );
    err.statusCode = 409;
    throw err;
  }

  role.isActive = false;
  await role.save();

  if (auditContext) {
    await createAdminAuditLog({
      ...auditContext,
      action: "role.deleted",
      targetType: "AdminRole",
      targetId: role._id,
      metadata: { key: role.key },
    });
  }

  return sanitizeRoleForResponse(role);
}

export async function listAdmins({ page = 1, limit = 50 } = {}) {
  const skip = (Math.max(1, page) - 1) * limit;
  const [items, total] = await Promise.all([
    Admin.find({})
      .populate({ path: "roleId", select: "name key permissions isActive isSystem" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Admin.countDocuments({}),
  ]);

  return {
    items: items.map((admin) => sanitizeAdminForResponse(admin, admin.roleId)),
    pagination: {
      page: Math.max(1, page),
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function createAdminUser(
  { name, email, phone, password, roleId },
  { actor, auditContext } = {},
) {
  const role = await AdminRole.findById(roleId);
  if (!role || role.isActive === false) {
    const err = new Error("Active role is required");
    err.statusCode = 400;
    throw err;
  }

  try {
    const admin = await Admin.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      phone: phone ? String(phone).trim() : undefined,
      password,
      role: "admin",
      roleId: role._id,
      isVerified: true,
      isActive: true,
      tokenVersion: 0,
      createdBy: actor?._id || null,
      updatedBy: actor?._id || null,
    });

    if (auditContext) {
      await createAdminAuditLog({
        ...auditContext,
        action: "admin.created",
        targetType: "Admin",
        targetId: admin._id,
        metadata: {
          email: admin.email,
          roleId: toObjectIdString(role._id),
          roleKey: role.key,
        },
      });
    }

    return sanitizeAdminForResponse(admin, role);
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error("Admin with this email or phone already exists");
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }
}

export async function updateAdminUser(
  adminId,
  { name, email, phone, isActive },
  { actor, actorAccess, auditContext } = {},
) {
  const admin = await Admin.findById(adminId).populate("roleId");
  if (!admin) {
    const err = new Error("Admin not found");
    err.statusCode = 404;
    throw err;
  }

  const wasSuperAdmin = admin.roleId?.key === SUPER_ADMIN_ROLE_KEY;

  if (name !== undefined) admin.name = String(name).trim();
  if (email !== undefined) admin.email = String(email).trim().toLowerCase();
  if (phone !== undefined) {
    admin.phone = phone ? String(phone).trim() : undefined;
  }

  if (typeof isActive === "boolean") {
    if (isActive === false && wasSuperAdmin) {
      const remaining = await countActiveSuperAdmins({ excludeAdminId: admin._id });
      if (remaining < 1) {
        const err = new Error("Cannot deactivate the last active super admin");
        err.statusCode = 400;
        throw err;
      }
    }

    if (admin.isActive !== isActive) {
      admin.isActive = isActive;
      admin.tokenVersion = Number(admin.tokenVersion || 0) + 1;
      if (!isActive) {
        admin.disabledAt = new Date();
        admin.disabledBy = actor?._id || null;
      } else {
        admin.disabledAt = null;
        admin.disabledBy = null;
      }
    }
  }

  if (actor?._id) admin.updatedBy = actor._id;

  try {
    await admin.save();
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error("Admin with this email or phone already exists");
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }

  if (auditContext) {
    await createAdminAuditLog({
      ...auditContext,
      action: "admin.updated",
      targetType: "Admin",
      targetId: admin._id,
      metadata: {
        email: admin.email,
        isActive: admin.isActive,
      },
    });
  }

  return sanitizeAdminForResponse(admin, admin.roleId);
}

export async function assignAdminRole(
  adminId,
  roleId,
  { actor, actorAccess, auditContext } = {},
) {
  const admin = await Admin.findById(adminId).populate("roleId");
  if (!admin) {
    const err = new Error("Admin not found");
    err.statusCode = 404;
    throw err;
  }

  const nextRole = await AdminRole.findById(roleId);
  if (!nextRole || nextRole.isActive === false) {
    const err = new Error("Active role is required");
    err.statusCode = 400;
    throw err;
  }

  const previousRoleKey = admin.roleId?.key || null;
  const wasSuperAdmin = previousRoleKey === SUPER_ADMIN_ROLE_KEY;
  const willBeSuperAdmin = nextRole.key === SUPER_ADMIN_ROLE_KEY;

  if (wasSuperAdmin && !willBeSuperAdmin) {
    const remaining = await countActiveSuperAdmins({ excludeAdminId: admin._id });
    if (remaining < 1) {
      const err = new Error("Cannot remove the last active super admin role");
      err.statusCode = 400;
      throw err;
    }
  }

  // Non-super actors cannot assign the super_admin role.
  if (!actorAccess?.isSuperAdmin && willBeSuperAdmin) {
    const err = new Error("Only a super admin can assign the super_admin role");
    err.statusCode = 403;
    throw err;
  }

  admin.roleId = nextRole._id;
  admin.tokenVersion = Number(admin.tokenVersion || 0) + 1;
  if (actor?._id) admin.updatedBy = actor._id;
  await admin.save();

  if (auditContext) {
    await createAdminAuditLog({
      ...auditContext,
      action: "admin.role_changed",
      targetType: "Admin",
      targetId: admin._id,
      metadata: {
        previousRoleKey,
        nextRoleKey: nextRole.key,
        roleId: toObjectIdString(nextRole._id),
      },
    });
  }

  return sanitizeAdminForResponse(admin, nextRole);
}

export async function resetAdminPassword(
  adminId,
  { password },
  { actor, auditContext } = {},
) {
  const admin = await Admin.findById(adminId).select("+password").populate("roleId");
  if (!admin) {
    const err = new Error("Admin not found");
    err.statusCode = 404;
    throw err;
  }

  admin.password = password;
  admin.tokenVersion = Number(admin.tokenVersion || 0) + 1;
  if (actor?._id) admin.updatedBy = actor._id;
  await admin.save();

  if (auditContext) {
    await createAdminAuditLog({
      ...auditContext,
      action: "admin.password_reset",
      targetType: "Admin",
      targetId: admin._id,
      metadata: { email: admin.email },
    });
  }

  return sanitizeAdminForResponse(admin, admin.roleId);
}

export async function deactivateAdmin(
  adminId,
  { actor, actorAccess, auditContext } = {},
) {
  return updateAdminUser(
    adminId,
    { isActive: false },
    { actor, actorAccess, auditContext },
  );
}

export function getPermissionCatalog() {
  return {
    permissions: getAllAdminPermissions(),
    groups: getAdminPermissionCatalogGrouped(),
  };
}

export { SUPER_ADMIN_ROLE_KEY, hasAdminPermission, getAllAdminPermissions };
