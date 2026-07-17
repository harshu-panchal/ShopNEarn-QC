import AdminAuditLog from "../../models/adminAuditLog.js";

/**
 * Append-only admin RBAC / sensitive-action audit log.
 */
export async function createAdminAuditLog(
  {
    actorAdminId = null,
    actorEmail = "",
    action,
    targetType = "",
    targetId = null,
    metadata = {},
    ip = "",
    userAgent = "",
  },
  { session } = {},
) {
  if (!action) {
    throw new Error("createAdminAuditLog requires action");
  }

  const options = session ? { session } : {};
  const [log] = await AdminAuditLog.create(
    [
      {
        actorAdminId,
        actorEmail: String(actorEmail || "").toLowerCase().trim(),
        action: String(action).trim(),
        targetType: String(targetType || "").trim(),
        targetId: targetId ?? null,
        metadata: metadata && typeof metadata === "object" ? metadata : {},
        ip: String(ip || "").trim(),
        userAgent: String(userAgent || "").trim(),
      },
    ],
    options,
  );
  return log;
}

export function requestAuditContext(req) {
  return {
    actorAdminId: req?.admin?._id || req?.user?.id || null,
    actorEmail: req?.admin?.email || "",
    ip:
      req?.headers?.["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() ||
      req?.ip ||
      "",
    userAgent: req?.headers?.["user-agent"] || "",
  };
}
