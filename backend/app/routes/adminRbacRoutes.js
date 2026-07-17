import express from "express";
import {
  adminPermissionGuard,
} from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  assignRoleSchema,
  createAdminSchema,
  createRoleSchema,
  resetAdminPasswordSchema,
  updateAdminSchema,
  updateRoleSchema,
  adminIdParamsSchema,
  roleIdParamsSchema,
} from "../validation/adminRbacValidation.js";
import {
  assignRbacAdminRole,
  createRbacAdmin,
  createRbacRole,
  deactivateRbacAdmin,
  deleteRbacRole,
  getRbacAdmins,
  getRbacAuditLogs,
  getRbacPermissions,
  getRbacRoleById,
  getRbacRoles,
  resetRbacAdminPassword,
  updateRbacAdmin,
  updateRbacRole,
} from "../controller/admin/adminRbacController.js";

const router = express.Router();

router.get("/permissions", ...adminPermissionGuard("rbac:view"), getRbacPermissions);

router.get("/roles", ...adminPermissionGuard("rbac:view"), getRbacRoles);
router.post(
  "/roles",
  ...adminPermissionGuard("rbac:create"),
  validate(createRoleSchema),
  createRbacRole,
);
router.get(
  "/roles/:id",
  ...adminPermissionGuard("rbac:view"),
  validate(roleIdParamsSchema, "params"),
  getRbacRoleById,
);
router.put(
  "/roles/:id",
  ...adminPermissionGuard("rbac:update"),
  validate(roleIdParamsSchema, "params"),
  validate(updateRoleSchema),
  updateRbacRole,
);
router.delete(
  "/roles/:id",
  ...adminPermissionGuard("rbac:delete"),
  validate(roleIdParamsSchema, "params"),
  deleteRbacRole,
);

router.get("/admins", ...adminPermissionGuard("rbac:view"), getRbacAdmins);
router.post(
  "/admins",
  ...adminPermissionGuard("rbac:create"),
  validate(createAdminSchema),
  createRbacAdmin,
);
router.put(
  "/admins/:id",
  ...adminPermissionGuard("rbac:update"),
  validate(adminIdParamsSchema, "params"),
  validate(updateAdminSchema),
  updateRbacAdmin,
);
router.patch(
  "/admins/:id/role",
  ...adminPermissionGuard("rbac:assign"),
  validate(adminIdParamsSchema, "params"),
  validate(assignRoleSchema),
  assignRbacAdminRole,
);
router.patch(
  "/admins/:id/password",
  ...adminPermissionGuard("rbac:update"),
  validate(adminIdParamsSchema, "params"),
  validate(resetAdminPasswordSchema),
  resetRbacAdminPassword,
);
router.patch(
  "/admins/:id/deactivate",
  ...adminPermissionGuard("rbac:update"),
  validate(adminIdParamsSchema, "params"),
  deactivateRbacAdmin,
);

router.get("/audit-logs", ...adminPermissionGuard("rbac:view"), getRbacAuditLogs);

export default router;
