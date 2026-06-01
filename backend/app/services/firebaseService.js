import { getFirebaseRealtimeDb } from "../config/firebaseAdmin.js";

/**
 * RTDB paths — customer reads `deliveryLocations/{orderId}/{deliveryBoyId}`.
 */
export const trackingPaths = {
  deliveryLocation: (orderId, deliveryBoyId) =>
    `/deliveryLocations/${orderId}/${deliveryBoyId}`,
  deliveryLocationsByOrder: (orderId) => `/deliveryLocations/${orderId}`,
  orderRider: (orderId) => `/orders/${orderId}/rider`,
  orderTrail: (orderId) => `/orders/${orderId}/trail`,
  orderRoute: (orderId) => `/orders/${orderId}/route`,
  deliveryCurrent: (deliveryId) => `/deliveries/${deliveryId}/current`,
  fleetActive: (deliveryId) => `/fleet/active/${deliveryId}`,
};

/**
 * TTL applied as metadata on every realtime write so a sweep job (or any
 * external tool) can reason about staleness without joining against Mongo.
 *
 * Per-order tracking is expected to be cleared synchronously by lifecycle
 * hooks (delivery / cancel / return); this TTL is the safety net for any
 * write that escapes those hooks.
 */
const TRACKING_TTL_MS = (() => {
  const raw = parseInt(process.env.FIREBASE_TRACKING_TTL_MS || "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 6 * 60 * 60 * 1000; // 6h default
})();

const RIDER_PRESENCE_TTL_MS = (() => {
  const raw = parseInt(process.env.FIREBASE_RIDER_PRESENCE_TTL_MS || "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 30 * 60 * 1000; // 30 min default — matches background heartbeat cadence
})();

const expiryFromNow = (ms) => new Date(Date.now() + ms).toISOString();

export const writeDeliveryLocation = async (deliveryId, orderId, snapshot) => {
  try {
    const db = getFirebaseRealtimeDb();
    if (!db) {
      return { deliveryId, orderId, snapshot, skipped: true };
    }

    const timestamp = snapshot.lastUpdatedAt || new Date().toISOString();
    const cleanSnapshot = {
      lat: snapshot.lat,
      lng: snapshot.lng,
      lastUpdatedAt: timestamp,
      // TTL metadata — see RIDER_PRESENCE_TTL_MS / TRACKING_TTL_MS for the
      // sweep window. The cleanup worker compares `expiresAt` against now.
      expiresAt: expiryFromNow(RIDER_PRESENCE_TTL_MS),
      deliveryId: snapshot.deliveryId,
      orderId: snapshot.orderId ?? null,
      source: snapshot.source || "gps",
    };

    if (snapshot.accuracy !== undefined && snapshot.accuracy !== null) {
      cleanSnapshot.accuracy = snapshot.accuracy;
    }
    if (snapshot.heading !== undefined && snapshot.heading !== null) {
      cleanSnapshot.heading = snapshot.heading;
    }
    if (snapshot.speed !== undefined && snapshot.speed !== null) {
      cleanSnapshot.speed = snapshot.speed;
    }

    const updates = {};
    updates[trackingPaths.deliveryCurrent(deliveryId)] = cleanSnapshot;
    updates[trackingPaths.fleetActive(deliveryId)] = {
      lat: snapshot.lat,
      lng: snapshot.lng,
      orderId: snapshot.orderId || null,
      lastUpdatedAt: timestamp,
      expiresAt: expiryFromNow(RIDER_PRESENCE_TTL_MS),
      source: cleanSnapshot.source,
    };

    if (orderId && deliveryId) {
      updates[trackingPaths.deliveryLocation(orderId, deliveryId)] = {
        lat: snapshot.lat,
        lng: snapshot.lng,
        timestamp,
        lastUpdatedAt: timestamp,
        expiresAt: expiryFromNow(TRACKING_TTL_MS),
        deliveryId,
        orderId,
        source: cleanSnapshot.source,
        ...(snapshot.accuracy !== undefined && snapshot.accuracy !== null
          ? { accuracy: snapshot.accuracy }
          : {}),
        ...(snapshot.heading !== undefined && snapshot.heading !== null
          ? { heading: snapshot.heading }
          : {}),
        ...(snapshot.speed !== undefined && snapshot.speed !== null
          ? { speed: snapshot.speed }
          : {}),
      };
      updates[trackingPaths.orderRider(orderId)] = cleanSnapshot;
    }

    await db.ref().update(updates);
    return { deliveryId, orderId, snapshot: cleanSnapshot };
  } catch (err) {
    console.error("writeDeliveryLocation error:", err.message);
    return null;
  }
};

export const appendTrailPoint = async (orderId, point) => {
  try {
    const db = getFirebaseRealtimeDb();
    if (!db) {
      return { orderId, point, skipped: true };
    }
    // Stamp each trail point with the same TTL so a sweep worker can
    // prune individual points if the order's lifecycle hook is missed.
    const enriched = {
      ...point,
      lastUpdatedAt: point?.lastUpdatedAt || new Date().toISOString(),
      expiresAt: expiryFromNow(TRACKING_TTL_MS),
    };
    await db.ref(trackingPaths.orderTrail(orderId)).push(enriched);
    return { orderId, point: enriched };
  } catch (err) {
    console.error("appendTrailPoint error:", err.message);
    return null;
  }
};

export const writeRoutePolyline = async (orderId, routeData) => {
  try {
    const db = getFirebaseRealtimeDb();
    if (!db) return { orderId, routeData, skipped: true };

    const routeCache = {
      polyline: routeData.polyline,
      phase: routeData.phase || null,
      origin: routeData.origin || null,
      destination: routeData.destination || null,
      mode: routeData.mode || "driving",
      distance: routeData.distance,
      duration: routeData.duration,
      bounds: routeData.bounds,
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    await db.ref(trackingPaths.orderRoute(orderId)).set(routeCache);
    return { orderId, routeCache };
  } catch (err) {
    console.error("writeRoutePolyline error:", err.message);
    return null;
  }
};

export const getRoutePolyline = async (orderId) => {
  try {
    const db = getFirebaseRealtimeDb();
    if (!db) return null;

    const snapshot = await db.ref(trackingPaths.orderRoute(orderId)).once('value');
    const routeData = snapshot.val();

    if (!routeData) return null;

    const expiresAt = new Date(routeData.expiresAt);
    if (expiresAt < new Date()) {
      await db.ref(trackingPaths.orderRoute(orderId)).remove();
      return null;
    }

    return routeData;
  } catch (err) {
    console.error("getRoutePolyline error:", err.message);
    return null;
  }
};

/**
 * Remove every per-order tracking node for `orderId` in a single multi-path
 * update. Safe to call multiple times — RTDB silently no-ops on missing
 * paths.
 *
 * Call sites:
 *   - delivery OTP validated (order delivered)
 *   - `compensateOrderCancellation` (any cancel path)
 *   - `completeReturnAndRefund` (return finished)
 *
 * Fire-and-forget at the call site; the function itself swallows errors so
 * a Firebase blip never blocks an order-state transition.
 */
export const clearOrderTracking = async (orderId) => {
  if (!orderId) return { orderId, skipped: true };
  try {
    const db = getFirebaseRealtimeDb();
    if (!db) return { orderId, skipped: true };

    const updates = {
      [trackingPaths.orderRider(orderId)]: null,
      [trackingPaths.orderTrail(orderId)]: null,
      [trackingPaths.orderRoute(orderId)]: null,
      [trackingPaths.deliveryLocationsByOrder(orderId)]: null,
    };

    await db.ref().update(updates);
    return { orderId, cleared: true };
  } catch (err) {
    console.error("clearOrderTracking error:", err.message);
    return null;
  }
};

/**
 * Remove rider presence nodes when a delivery partner goes offline / logs
 * out. Does not touch per-order tracking — those have their own lifecycle
 * hooks. Safe and idempotent.
 */
export const clearRiderPresence = async (deliveryId) => {
  if (!deliveryId) return { deliveryId, skipped: true };
  try {
    const db = getFirebaseRealtimeDb();
    if (!db) return { deliveryId, skipped: true };

    const updates = {
      [trackingPaths.fleetActive(deliveryId)]: null,
      [trackingPaths.deliveryCurrent(deliveryId)]: null,
    };

    await db.ref().update(updates);
    return { deliveryId, cleared: true };
  } catch (err) {
    console.error("clearRiderPresence error:", err.message);
    return null;
  }
};

/**
 * Sweep stale rider-presence nodes. Used by the cleanup worker as a final
 * safety net for cases where a rider's client never gets a chance to fire
 * `clearRiderPresence` (force-quit, network drop, etc.).
 *
 * An entry is considered stale when:
 *   - `expiresAt` exists and is in the past, OR
 *   - `expiresAt` is missing and `lastUpdatedAt` is older than `maxAgeMs`.
 *
 * Returns counts so the scheduler can log meaningful telemetry.
 */
export const sweepStaleTrackingNodes = async (
  { maxAgeMs = RIDER_PRESENCE_TTL_MS } = {},
) => {
  const result = { fleetActiveRemoved: 0, deliveryCurrentRemoved: 0, skipped: false };
  try {
    const db = getFirebaseRealtimeDb();
    if (!db) {
      result.skipped = true;
      return result;
    }

    const now = Date.now();
    const isStale = (entry) => {
      if (!entry || typeof entry !== "object") return false;
      const expiresAtMs = entry.expiresAt ? new Date(entry.expiresAt).getTime() : NaN;
      if (Number.isFinite(expiresAtMs)) {
        return expiresAtMs < now;
      }
      const updatedAtMs = entry.lastUpdatedAt
        ? new Date(entry.lastUpdatedAt).getTime()
        : NaN;
      if (Number.isFinite(updatedAtMs)) {
        return now - updatedAtMs > maxAgeMs;
      }
      // No timestamp at all — treat as stale so we eventually clear any
      // legacy entries that were written before TTL metadata existed.
      return true;
    };

    const fleetSnap = await db.ref("/fleet/active").once("value");
    const fleetVal = fleetSnap.val() || {};
    const fleetUpdates = {};
    for (const [deliveryId, entry] of Object.entries(fleetVal)) {
      if (isStale(entry)) {
        fleetUpdates[trackingPaths.fleetActive(deliveryId)] = null;
        result.fleetActiveRemoved += 1;
      }
    }

    const deliveriesSnap = await db.ref("/deliveries").once("value");
    const deliveriesVal = deliveriesSnap.val() || {};
    for (const [deliveryId, node] of Object.entries(deliveriesVal)) {
      if (isStale(node?.current)) {
        fleetUpdates[trackingPaths.deliveryCurrent(deliveryId)] = null;
        result.deliveryCurrentRemoved += 1;
      }
    }

    if (Object.keys(fleetUpdates).length) {
      await db.ref().update(fleetUpdates);
    }

    return result;
  } catch (err) {
    console.error("sweepStaleTrackingNodes error:", err.message);
    return result;
  }
};
