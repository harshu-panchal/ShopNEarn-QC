/**
 * LocationThrottleService
 *
 * Owns the rate-limiting logic that prevents delivery-partner devices from
 * spamming the location-update endpoint. Previously lived inline inside
 * deliveryController.js (P2.3 of the refactor plan).
 *
 * The throttle key is `loc:last:<deliveryId>` in Redis. An update is throttled
 * when both:
 *   - It arrives within LOCATION_MIN_INTERVAL_MS of the previous update.
 *   - The reported coordinates have not moved by LOCATION_MIN_MOVE_METERS.
 *
 * Behaviour with no Redis available: never throttle (returns false). Behaviour
 * on any Redis error: never throttle (returns false). This matches the
 * previous inline implementation byte-for-byte.
 *
 * Returns a boolean: `true` means "skip this update" / "throttled".
 */

import { getRedisClient } from "../../config/redis.js";
import { distanceMeters } from "../../utils/geoUtils.js";

const LOC_MIN_INTERVAL_MS = () =>
  parseInt(process.env.LOCATION_MIN_INTERVAL_MS || "3000", 10);
const LOC_MIN_MOVE_M = () =>
  parseInt(process.env.LOCATION_MIN_MOVE_METERS || "20", 10);

/**
 * @param {string|ObjectId} deliveryId
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<boolean>} true when the caller should skip the update.
 */
export async function shouldThrottle(deliveryId, lat, lng) {
  const redis = getRedisClient();
  if (!redis) return false;
  try {
    const key = `loc:last:${deliveryId}`;
    const raw = await redis.get(key);
    const now = Date.now();
    if (raw) {
      const prev = JSON.parse(raw);
      const dt = now - prev.t;
      const d = distanceMeters(lat, lng, prev.lat, prev.lng);
      if (dt < LOC_MIN_INTERVAL_MS() && d < LOC_MIN_MOVE_M()) {
        return true;
      }
    }
    await redis.set(key, JSON.stringify({ lat, lng, t: now }), "EX", 3600);
  } catch {
    return false;
  }
  return false;
}

export default { shouldThrottle };
