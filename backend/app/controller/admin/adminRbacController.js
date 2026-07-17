import handleResponse from "../../utils/helper.js";
import { requestAuditContext } from "../../services/admin/adminAuditLogService.js";
import {
  assignAdminRole,
  createAdminUser,
  createRole,
  deactivateAdmin,
  deleteRole,
  getPermissionCatalog,
  getRoleById,
  listAdmins,
  listRoles,
  resetAdminPassword,
  updateAdminUser,
  updateRole,
} from "../../services/admin/adminRbacService.js";
import AdminAuditLog from "../../models/adminAuditLog.js";
import getPagination from "../../utils/pagination.js";

function actorFromReq(req) {
  return req.admin || null;
}

function actorAccessFromReq(req) {
  return req.adminAccess || null;
}

export const getRbacPermissions = async (req, res) => {
  try {
    return handleResponse(res, 200, "Permission catalog fetched", getPermissionCatalog());
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getRbacRoles = async (req, res) => {
  try {
    const roles = await listRoles();
    return handleResponse(res, 200, "Roles fetched", { items: roles });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getRbacRoleById = async (req, res) => {
  try {
    const role = await getRoleById(req.params.id);
    return handleResponse(res, 200, "Role fetched", role);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const createRbacRole = async (req, res) => {
  try {
    const role = await createRole(req.body, {
      actor: actorFromReq(req),
      auditContext: requestAuditContext(req),
    });
    return handleResponse(res, 201, "Role created", role);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const updateRbacRole = async (req, res) => {
  try {
    const role = await updateRole(req.params.id, req.body, {
      actor: actorFromReq(req),
      actorAccess: actorAccessFromReq(req),
      auditContext: requestAuditContext(req),
    });
    return handleResponse(res, 200, "Role updated", role);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const deleteRbacRole = async (req, res) => {
  try {
    const role = await deleteRole(req.params.id, {
      actorAccess: actorAccessFromReq(req),
      auditContext: requestAuditContext(req),
    });
    return handleResponse(res, 200, "Role deactivated", role);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getRbacAdmins = async (req, res) => {
  try {
    const { page, limit } = getPagination(req, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const data = await listAdmins({ page, limit });
    return handleResponse(res, 200, "Admins fetched", data);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const createRbacAdmin = async (req, res) => {
  try {
    const admin = await createAdminUser(req.body, {
      actor: actorFromReq(req),
      auditContext: requestAuditContext(req),
    });
    return handleResponse(res, 201, "Admin created", admin);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const updateRbacAdmin = async (req, res) => {
  try {
    const admin = await updateAdminUser(req.params.id, req.body, {
      actor: actorFromReq(req),
      actorAccess: actorAccessFromReq(req),
      auditContext: requestAuditContext(req),
    });
    return handleResponse(res, 200, "Admin updated", admin);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const assignRbacAdminRole = async (req, res) => {
  try {
    const admin = await assignAdminRole(req.params.id, req.body.roleId, {
      actor: actorFromReq(req),
      actorAccess: actorAccessFromReq(req),
      auditContext: requestAuditContext(req),
    });
    return handleResponse(res, 200, "Admin role assigned", admin);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const resetRbacAdminPassword = async (req, res) => {
  try {
    const admin = await resetAdminPassword(
      req.params.id,
      { password: req.body.password },
      {
        actor: actorFromReq(req),
        auditContext: requestAuditContext(req),
      },
    );
    return handleResponse(res, 200, "Admin password reset", admin);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const deactivateRbacAdmin = async (req, res) => {
  try {
    const admin = await deactivateAdmin(req.params.id, {
      actor: actorFromReq(req),
      actorAccess: actorAccessFromReq(req),
      auditContext: requestAuditContext(req),
    });
    return handleResponse(res, 200, "Admin deactivated", admin);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getRbacAuditLogs = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const filter = {};
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.actorAdminId) filter.actorAdminId = req.query.actorAdminId;

    const [items, total] = await Promise.all([
      AdminAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AdminAuditLog.countDocuments(filter),
    ]);

    return handleResponse(res, 200, "Audit logs fetched", {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
