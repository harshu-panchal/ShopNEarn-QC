import { describe, expect, it } from "@jest/globals";
import {
  ALL_ADMIN_PERMISSION_KEYS,
  SUPER_ADMIN_ROLE_KEY,
  getAllAdminPermissions,
  hasAdminPermission,
  hasAnyAdminPermission,
  isAdminPermissionKey,
  normalizeAdminPermissions,
} from "../app/constants/adminPermissions.js";

describe("adminPermissions catalog", () => {
  it("includes required domain permissions", () => {
    expect(isAdminPermissionKey("dashboard:view")).toBe(true);
    expect(isAdminPermissionKey("finance:process")).toBe(true);
    expect(isAdminPermissionKey("rbac:assign")).toBe(true);
    expect(isAdminPermissionKey("mlm:impersonate")).toBe(true);
    expect(isAdminPermissionKey("not:a:real:perm")).toBe(false);
  });

  it("normalizes permissions by deduping and sorting", () => {
    expect(
      normalizeAdminPermissions([
        "sellers:view",
        "dashboard:view",
        "sellers:view",
        "bogus",
      ]),
    ).toEqual(["dashboard:view", "sellers:view"]);
  });

  it("checks permission membership for arrays and sets", () => {
    const list = ["support:view", "support:reply"];
    expect(hasAdminPermission(list, "support:reply")).toBe(true);
    expect(hasAdminPermission(list, "finance:view")).toBe(false);
    expect(hasAdminPermission(new Set(list), "support:view")).toBe(true);
    expect(hasAnyAdminPermission(list, ["finance:view", "support:view"])).toBe(
      true,
    );
    expect(hasAnyAdminPermission(list, ["finance:view", "mlm:view"])).toBe(
      false,
    );
  });

  it("exposes a non-empty full catalog for super_admin", () => {
    expect(SUPER_ADMIN_ROLE_KEY).toBe("super_admin");
    expect(getAllAdminPermissions().length).toBe(ALL_ADMIN_PERMISSION_KEYS.length);
    expect(getAllAdminPermissions().length).toBeGreaterThan(40);
  });
});
