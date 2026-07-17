import { jest } from "@jest/globals";

const mockAdminCountDocuments = jest.fn();
const mockAdminFindOne = jest.fn();
const mockAdminCreate = jest.fn();
const mockEnsureSuperAdminRole = jest.fn();
const mockResolveAdminAccess = jest.fn();
const mockSanitizeAdminForResponse = jest.fn((admin, role) => ({
  _id: admin._id,
  email: admin.email,
  permissions: role?.permissions || [],
  adminRole: { key: role?.key, name: role?.name },
  isSuperAdmin: role?.key === "super_admin",
}));

jest.unstable_mockModule("../app/models/admin.js", () => ({
  default: {
    countDocuments: mockAdminCountDocuments,
    findOne: mockAdminFindOne,
    create: mockAdminCreate,
  },
}));

jest.unstable_mockModule("../app/services/admin/adminRbacService.js", () => ({
  ensureSuperAdminRole: mockEnsureSuperAdminRole,
  resolveAdminAccess: mockResolveAdminAccess,
  sanitizeAdminForResponse: mockSanitizeAdminForResponse,
}));

const { bootstrapAdmin } = await import("../app/controller/adminAuthController.js");

describe("Phase 0 secure admin bootstrap with RBAC", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_BOOTSTRAP_SECRET = "secret-123";
    process.env.JWT_SECRET = "test-jwt-secret";
  });

  it("blocks bootstrap once at least one admin already exists", async () => {
    mockAdminCountDocuments.mockResolvedValue(1);

    const req = {
      headers: {
        "x-admin-bootstrap-secret": "secret-123",
      },
      body: {
        name: "Admin User",
        email: "admin@example.com",
        password: "StrongPass123A",
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await bootstrapAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Admin bootstrap is disabled after initial setup",
      }),
    );
    expect(mockAdminCreate).not.toHaveBeenCalled();
  });

  it("bootstraps first admin as super_admin", async () => {
    mockAdminCountDocuments.mockResolvedValue(0);
    mockAdminFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    mockEnsureSuperAdminRole.mockResolvedValue({
      _id: "role-super",
      key: "super_admin",
      name: "Super Admin",
      permissions: ["dashboard:view", "rbac:assign"],
    });
    const createdAdmin = {
      _id: "admin-1",
      email: "admin@example.com",
      roleId: "role-super",
      tokenVersion: 0,
    };
    mockAdminCreate.mockResolvedValue(createdAdmin);
    mockResolveAdminAccess.mockResolvedValue({
      admin: createdAdmin,
      role: {
        _id: "role-super",
        key: "super_admin",
        name: "Super Admin",
        permissions: ["dashboard:view", "rbac:assign"],
      },
      roleKey: "super_admin",
      permissions: ["dashboard:view", "rbac:assign"],
    });

    const req = {
      headers: {
        "x-admin-bootstrap-secret": "secret-123",
      },
      body: {
        name: "Admin User",
        email: "admin@example.com",
        password: "StrongPass123A",
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await bootstrapAdmin(req, res);

    expect(mockEnsureSuperAdminRole).toHaveBeenCalled();
    expect(mockAdminCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "admin@example.com",
        roleId: "role-super",
        role: "admin",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        result: expect.objectContaining({
          token: expect.any(String),
          admin: expect.objectContaining({
            isSuperAdmin: true,
          }),
        }),
      }),
    );
  });
});
