import { jest } from "@jest/globals";

const mockResolveAdminAccess = jest.fn();
const mockCreateAdminAuditLog = jest.fn();

jest.unstable_mockModule("../app/services/admin/adminRbacService.js", () => ({
  resolveAdminAccess: mockResolveAdminAccess,
}));

jest.unstable_mockModule("../app/services/admin/adminAuditLogService.js", () => ({
  createAdminAuditLog: mockCreateAdminAuditLog,
  requestAuditContext: () => ({
    actorAdminId: "admin-1",
    actorEmail: "admin@example.com",
    ip: "127.0.0.1",
    userAgent: "test",
  }),
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: {
    findById: jest.fn(),
  },
}));

const {
  requireActiveAdmin,
  requireAdminPermission,
  requireAdminPermissionIfAdmin,
} = await import("../app/middleware/authMiddleware.js");

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe("admin RBAC middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requireActiveAdmin attaches admin access when tokenVersion matches", async () => {
    mockResolveAdminAccess.mockResolvedValue({
      admin: { _id: "admin-1", email: "admin@example.com" },
      role: { _id: "role-1", key: "support_admin", name: "Support" },
      permissions: ["support:view"],
      permissionSet: new Set(["support:view"]),
      roleKey: "support_admin",
      roleName: "Support",
      isSuperAdmin: false,
      tokenVersion: 2,
    });

    const req = { user: { id: "admin-1", role: "admin", tokenVersion: 2 } };
    const res = mockRes();
    const next = jest.fn();

    await requireActiveAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.adminAccess.roleKey).toBe("support_admin");
    expect(req.adminAccess.permissions).toEqual(["support:view"]);
  });

  it("requireActiveAdmin rejects mismatched tokenVersion", async () => {
    mockResolveAdminAccess.mockResolvedValue({
      admin: { _id: "admin-1" },
      role: { _id: "role-1", key: "super_admin", name: "Super Admin" },
      permissions: ["dashboard:view"],
      permissionSet: new Set(["dashboard:view"]),
      roleKey: "super_admin",
      roleName: "Super Admin",
      isSuperAdmin: true,
      tokenVersion: 5,
    });

    const req = { user: { id: "admin-1", role: "admin", tokenVersion: 1 } };
    const res = mockRes();
    const next = jest.fn();

    await requireActiveAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("requireAdminPermission blocks missing permission", async () => {
    const middleware = requireAdminPermission("finance:process");
    const req = {
      user: { id: "admin-1", role: "admin" },
      adminAccess: {
        permissionSet: new Set(["finance:view"]),
        permissions: ["finance:view"],
      },
      admin: { _id: "admin-1", email: "a@b.com" },
      originalUrl: "/api/admin/finance/payouts/process",
      method: "POST",
    };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockCreateAdminAuditLog).toHaveBeenCalled();
  });

  it("requireAdminPermissionIfAdmin skips non-admin callers", async () => {
    const middleware = requireAdminPermissionIfAdmin("orders:view");
    const req = { user: { id: "seller-1", role: "seller" } };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockResolveAdminAccess).not.toHaveBeenCalled();
  });
});
