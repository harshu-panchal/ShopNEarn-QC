import dotenv from "dotenv";
import { sweepStaleTrackingNodes } from "../services/firebaseService.js";
import logger from "../services/logger.js";

dotenv.config();

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const JOB_INTERVAL_MS = (() => {
  const raw = parseInt(process.env.FIREBASE_TRACKING_CLEANUP_INTERVAL_MS || "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_INTERVAL_MS;
})();

const MAX_AGE_MS = (() => {
  const raw = parseInt(process.env.FIREBASE_RIDER_PRESENCE_TTL_MS || "", 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 30 * 60 * 1000; // default matches the writer-side TTL
})();

const JOB_ENABLED = (() => {
  const raw = String(process.env.FIREBASE_TRACKING_CLEANUP_ENABLED || "true").toLowerCase();
  return raw !== "false" && raw !== "0";
})();

/**
 * Sweep stale rider-presence nodes from Firebase RTDB.
 *
 * Per-order tracking is cleared synchronously by the lifecycle hooks
 * (delivery OTP, order cancellation, return completion). This job is the
 * safety net for rider-presence nodes under /fleet/active/{deliveryId}
 * and /deliveries/{orderId}/current when a rider's client never gets a chance to
 * call clearRiderPresence due to force-quit, network drop, killed PWA, etc.
 *
 * Bounded by FIREBASE_RIDER_PRESENCE_TTL_MS (default 30 min), which also
 * matches the rider heartbeat cadence in DeliveryLayout.
 */

 
const sweepFirebaseTracking = async () => {
  if (!JOB_ENABLED) return;

  const startTime = Date.now();
  try {
    const result = await sweepStaleTrackingNodes({ maxAgeMs: MAX_AGE_MS });
    const duration = Date.now() - startTime;

    if (result?.skipped) {
      logger.debug("Firebase tracking cleanup skipped (RTDB unavailable)", {
        jobName: "firebaseTrackingCleanupJob",
        duration,
      });
      return;
    }

    const total =
      Number(result?.fleetActiveRemoved || 0) +
      Number(result?.deliveryCurrentRemoved || 0);

    if (total > 0) {
      logger.info("Firebase tracking cleanup completed", {
        jobName: "firebaseTrackingCleanupJob",
        duration,
        fleetActiveRemoved: result.fleetActiveRemoved,
        deliveryCurrentRemoved: result.deliveryCurrentRemoved,
        total,
      });
    } else {
      logger.debug("Firebase tracking cleanup: nothing to remove", {
        jobName: "firebaseTrackingCleanupJob",
        duration,
      });
    }
  } catch (err) {
    logger.error("Firebase tracking cleanup failed", {
      jobName: "firebaseTrackingCleanupJob",
      duration: Date.now() - startTime,
      error: err.message,
      stack: err.stack,
    });
  }
};

export const getFirebaseTrackingCleanupJobHandler = () => sweepFirebaseTracking;
export const getFirebaseTrackingCleanupJobInterval = () => JOB_INTERVAL_MS;
export const isFirebaseTrackingCleanupJobEnabled = () => JOB_ENABLED;

export default sweepFirebaseTracking;
