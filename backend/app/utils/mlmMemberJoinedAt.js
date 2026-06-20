import MlmMembership from "../models/mlmMembership.js";
import Customer from "../models/customer.js";

/**
 * Registration timestamp shown near member names in MLM UIs.
 * Prefers Customer.createdAt (account signup), then MlmMembership.createdAt.
 * Does not use planAJoinedAt or membership.joinedAt (legacy plan-join fields).
 */
export function resolveMemberRegistrationAt(membership) {
  if (!membership) return null;
  const user = membership.userId;
  if (user && typeof user === "object" && user.createdAt) {
    return user.createdAt;
  }
  if (membership.createdAt) return membership.createdAt;
  return null;
}

/**
 * Bulk-resolve registration timestamps for customer ObjectIds.
 */
export async function lookupMembershipJoinedAtByUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();

  const [customers, memberships] = await Promise.all([
    Customer.find({ _id: { $in: ids } })
      .select({ _id: 1, createdAt: 1 })
      .lean(),
    MlmMembership.find({ userId: { $in: ids } })
      .select({ userId: 1, createdAt: 1 })
      .lean(),
  ]);

  const customerCreated = new Map(
    customers.map((row) => [String(row._id), row.createdAt || null]),
  );
  const membershipCreated = new Map(
    memberships.map((row) => [
      String(row.userId),
      row.createdAt || null,
    ]),
  );

  return new Map(
    ids.map((id) => [
      id,
      customerCreated.get(id) || membershipCreated.get(id) || null,
    ]),
  );
}
