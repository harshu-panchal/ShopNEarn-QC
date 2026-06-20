import MlmMembership from "../models/mlmMembership.js";

/**
 * Bulk-resolve membership join timestamps for a set of customer
 * ObjectIds. Falls back to `createdAt` when `joinedAt` is unset
 * (REGISTERED_UNPAID rows that have not activated Plan A yet).
 */
export async function lookupMembershipJoinedAtByUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();

  const rows = await MlmMembership.find({ userId: { $in: ids } })
    .select({ userId: 1, joinedAt: 1, createdAt: 1 })
    .lean();

  return new Map(
    rows.map((row) => [
      String(row.userId),
      row.joinedAt || row.createdAt || null,
    ]),
  );
}
