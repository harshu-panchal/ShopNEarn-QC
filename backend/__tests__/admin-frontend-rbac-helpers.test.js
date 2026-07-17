import { describe, expect, it } from "@jest/globals";
import {
  canAccessNavItem,
  filterNavItemsByPermissions,
  firstPermittedAdminPath,
  hasPermission,
} from "../../frontend/src/modules/admin/rbac/permissions.js";

describe("frontend admin RBAC helpers", () => {
  const supportUser = {
    permissions: ["support:view", "support:reply"],
  };

  it("checks permissions", () => {
    expect(hasPermission(supportUser, "support:view")).toBe(true);
    expect(hasPermission(supportUser, "finance:view")).toBe(false);
  });

  it("filters nav trees and removes empty parents", () => {
    const nav = [
      { label: "Dashboard", path: "/admin", permission: "dashboard:view" },
      {
        label: "Support",
        permission: "support:view",
        children: [
          { label: "Tickets", path: "/admin/support-tickets", permission: "support:view" },
          { label: "Reviews", path: "/admin/moderation", permission: "support:moderate" },
        ],
      },
      { label: "Profile", path: "/admin/profile" },
    ];

    const filtered = filterNavItemsByPermissions(nav, supportUser);
    expect(filtered.map((i) => i.label)).toEqual(["Support", "Profile"]);
    expect(filtered[0].children.map((c) => c.label)).toEqual(["Tickets"]);
    expect(canAccessNavItem(supportUser, nav[0])).toBe(false);
    expect(firstPermittedAdminPath(filtered, supportUser)).toBe(
      "/admin/support-tickets",
    );
  });
});
