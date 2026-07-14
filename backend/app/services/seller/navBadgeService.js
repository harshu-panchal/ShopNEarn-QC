import Order from "../../models/order.js";

/**
 * Stable API keys for seller sidebar "new since last visit" badges.
 */
export const SELLER_NAV_BADGE_KEYS = Object.freeze([
  "ordersPending",
  "returnsPending",
]);

function parseSince(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Count new pending orders / return requests for a seller after each since.
 * Missing / invalid since for a key → 0.
 *
 * @param {string|import('mongoose').Types.ObjectId} sellerId
 * @param {Record<string, string>} sinceByKey
 * @returns {Promise<{ counts: Record<string, number> }>}
 */
export async function getSellerNavBadgeCounts(sellerId, sinceByKey = {}) {
  const ordersSince = parseSince(sinceByKey?.ordersPending);
  const returnsSince = parseSince(sinceByKey?.returnsPending);

  const [ordersPending, returnsPending] = await Promise.all([
    ordersSince
      ? Order.countDocuments({
          seller: sellerId,
          status: "pending",
          createdAt: { $gt: ordersSince },
        })
      : Promise.resolve(0),
    returnsSince
      ? Order.countDocuments({
          seller: sellerId,
          returnStatus: "return_requested",
          returnRequestedAt: { $gt: returnsSince },
        })
      : Promise.resolve(0),
  ]);

  return {
    counts: {
      ordersPending,
      returnsPending,
    },
  };
}
