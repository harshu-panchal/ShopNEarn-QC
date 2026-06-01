import crypto from "crypto";
import { getRedisClient } from "../config/redis.js";
import * as logger from "./logger.js";

/**
 * Idempotency Service
 * 
 * Manages idempotency keys to prevent duplicate order creation from retries,
 * network failures, and concurrent requests. Uses Redis for fast lock acquisition
 * and result caching with automatic TTL-based cleanup.
 *
 * Degradation policy:
 *   Idempotency is a best-effort safety net layered on top of DB-level
 *   uniqueness checks (e.g. order placement still re-resolves an existing
 *   checkout group by orderRef/customerId before retrying). When Redis
 *   is unreachable — either because REDIS_DISABLED=true is set or the
 *   connection is failing (ECONNREFUSED, ENOTFOUND, etc.) — these
 *   helpers degrade to no-ops instead of throwing, mirroring the
 *   scheduler's "Distributed lock unavailable, executing without lock"
 *   posture. This trades a tiny window of double-submit risk for keeping
 *   the order/payment flow alive when the cache layer is down.
 */

const REDIS_CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
]);

/**
 * True when the error originates from Redis being unreachable rather than
 * a real logic error. We use this to swallow connection failures and
 * degrade to a no-op so order placement can continue.
 */
function isRedisUnavailableError(error) {
  if (!error) return false;
  if (error.code && REDIS_CONNECTION_ERROR_CODES.has(error.code)) return true;
  const message = String(error.message || "");
  return (
    message.includes("Connection is closed") ||
    message.includes("Redis is loading") ||
    message.includes("READONLY") ||
    message.includes("ECONNREFUSED") ||
    message.includes("Stream isn't writeable")
  );
}

let _lastRedisUnavailableLog = 0;
const REDIS_UNAVAILABLE_LOG_INTERVAL_MS = 60_000;

/**
 * Rate-limited warning so dev terminals don't flood when Redis is off.
 * Mirrors the once-per-minute pattern used by `config/redis.js`.
 */
function warnRedisUnavailable(operation, key, error = null) {
  const now = Date.now();
  if (now - _lastRedisUnavailableLog < REDIS_UNAVAILABLE_LOG_INTERVAL_MS) return;
  _lastRedisUnavailableLog = now;
  const reason = error ? `${error.code || error.message}` : "client unavailable";
  logger.warn(
    `[Idempotency] Redis unavailable (${reason}); ${operation} degrading to no-op (key=${key})`,
  );
}

// Configuration constants
const LOCK_TTL_SECONDS = parseInt(process.env.IDEMPOTENCY_LOCK_TTL_SECONDS || "60", 10);
const RESULT_TTL_SECONDS = parseInt(process.env.IDEMPOTENCY_RESULT_TTL_SECONDS || "86400", 10); // 24 hours
const ERROR_TTL_SECONDS = parseInt(process.env.IDEMPOTENCY_ERROR_TTL_SECONDS || "3600", 10); // 1 hour

// Redis key patterns
const LOCK_KEY_PREFIX = "idempotency:lock:";
const RESULT_KEY_PREFIX = "idempotency:result:";
const ERROR_KEY_PREFIX = "idempotency:error:";

/**
 * Validate idempotency key format
 * @param {string} key - Idempotency key
 * @returns {boolean} True if valid
 */
export function validateIdempotencyKey(key) {
  if (!key || typeof key !== "string") {
    return false;
  }
  
  const trimmed = key.trim();
  
  // Must be alphanumeric with hyphens, 32-64 characters
  const isValidFormat = /^[a-zA-Z0-9-]{32,64}$/.test(trimmed);
  
  return isValidFormat;
}

/**
 * Generate SHA-256 checksum of request payload
 * @param {Object} payload - Request payload
 * @returns {string} Hex checksum
 */
function generatePayloadChecksum(payload) {
  // Deep-sort all keys for deterministic serialization
  const sortedJson = JSON.stringify(payload, (_, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((sorted, key) => {
        sorted[key] = value[key];
        return sorted;
      }, {});
    }
    return value;
  });
  return crypto.createHash("sha256").update(sortedJson).digest("hex");
}

/**
 * Check if request with idempotency key has been processed
 * @param {string} key - Idempotency key
 * @param {Object} payload - Request payload for checksum validation
 * @returns {Promise<{exists: boolean, result?: any, inProgress: boolean, checksumMismatch: boolean}>}
 */
export async function checkIdempotency(key, payload = null) {
  if (!validateIdempotencyKey(key)) {
    throw new Error("Invalid idempotency key format");
  }
  
  const redis = getRedisClient();
  if (!redis) {
    warnRedisUnavailable("checkIdempotency", key);
    return { exists: false, inProgress: false, checksumMismatch: false };
  }

  const resultKey = RESULT_KEY_PREFIX + key;
  const lockKey = LOCK_KEY_PREFIX + key;
  const errorKey = ERROR_KEY_PREFIX + key;
  
  try {
    // Check for existing result
    const [resultData, lockExists, errorData] = await Promise.all([
      redis.get(resultKey),
      redis.exists(lockKey),
      redis.get(errorKey),
    ]);
    
    // Check if request is in progress
    if (lockExists && !resultData && !errorData) {
      logger.info(`[Idempotency] Request in progress for key: ${key}`);
      return {
        exists: false,
        inProgress: true,
        checksumMismatch: false,
      };
    }
    
    // Check for cached error
    if (errorData) {
      const errorResult = JSON.parse(errorData);
      logger.info(`[Idempotency] Cached error found for key: ${key}`);
      
      // Validate checksum if payload provided
      if (payload) {
        const currentChecksum = generatePayloadChecksum(payload);
        if (errorResult.checksum && errorResult.checksum !== currentChecksum) {
          logger.warn(`[Idempotency] Checksum mismatch for error key: ${key}`);
          return {
            exists: true,
            result: errorResult,
            inProgress: false,
            checksumMismatch: true,
          };
        }
      }
      
      return {
        exists: true,
        result: errorResult,
        inProgress: false,
        checksumMismatch: false,
      };
    }
    
    // Check for cached result
    if (resultData) {
      const result = JSON.parse(resultData);
      logger.info(`[Idempotency] Cached result found for key: ${key}`);
      
      // Validate checksum if payload provided
      if (payload) {
        const currentChecksum = generatePayloadChecksum(payload);
        if (result.checksum && result.checksum !== currentChecksum) {
          logger.warn(`[Idempotency] Checksum mismatch for key: ${key}`);
          return {
            exists: true,
            result,
            inProgress: false,
            checksumMismatch: true,
          };
        }
      }
      
      return {
        exists: true,
        result,
        inProgress: false,
        checksumMismatch: false,
      };
    }
    
    // No existing result or lock
    return {
      exists: false,
      inProgress: false,
      checksumMismatch: false,
    };
    
  } catch (error) {
    if (isRedisUnavailableError(error)) {
      warnRedisUnavailable("checkIdempotency", key, error);
      return { exists: false, inProgress: false, checksumMismatch: false };
    }
    logger.error(`[Idempotency] Error checking idempotency for key ${key}:`, error);
    throw error;
  }
}

/**
 * Acquire lock for idempotency key
 * @param {string} key - Idempotency key
 * @param {number} ttlSeconds - Lock TTL (default: 60)
 * @returns {Promise<boolean>} True if lock acquired
 */
export async function acquireIdempotencyLock(key, ttlSeconds = LOCK_TTL_SECONDS) {
  if (!validateIdempotencyKey(key)) {
    throw new Error("Invalid idempotency key format");
  }
  
  const redis = getRedisClient();
  if (!redis) {
    warnRedisUnavailable("acquireIdempotencyLock", key);
    // Degrade: pretend we acquired the lock so the caller proceeds.
    // DB-level invariants prevent true duplicates; this trades the
    // distributed-lock guarantee for keeping the write path alive.
    return true;
  }

  const lockKey = LOCK_KEY_PREFIX + key;
  const lockValue = `${Date.now()}`; // Timestamp as lock value
  
  try {
    // Use SET with NX (only if not exists) and EX (expiration) for atomic lock acquisition
    const result = await redis.set(lockKey, lockValue, "EX", ttlSeconds, "NX");
    
    if (result === "OK") {
      logger.info(`[Idempotency] Lock acquired for key: ${key}, TTL: ${ttlSeconds}s`);
      return true;
    }
    
    logger.warn(`[Idempotency] Failed to acquire lock for key: ${key} (already locked)`);
    return false;
    
  } catch (error) {
    if (isRedisUnavailableError(error)) {
      warnRedisUnavailable("acquireIdempotencyLock", key, error);
      return true;
    }
    logger.error(`[Idempotency] Error acquiring lock for key ${key}:`, error);
    throw error;
  }
}

/**
 * Store result for idempotency key
 * @param {string} key - Idempotency key
 * @param {any} result - Result to cache
 * @param {Object} payload - Original request payload for checksum
 * @param {number} ttlSeconds - Cache TTL (default: 86400 = 24 hours)
 * @returns {Promise<void>}
 */
export async function storeIdempotencyResult(key, result, payload = null, ttlSeconds = RESULT_TTL_SECONDS) {
  if (!validateIdempotencyKey(key)) {
    throw new Error("Invalid idempotency key format");
  }
  
  const redis = getRedisClient();
  if (!redis) {
    warnRedisUnavailable("storeIdempotencyResult", key);
    return;
  }

  const resultKey = RESULT_KEY_PREFIX + key;
  const lockKey = LOCK_KEY_PREFIX + key;
  
  try {
    const checksum = payload ? generatePayloadChecksum(payload) : null;
    
    const cacheData = {
      status: "success",
      data: result,
      timestamp: Date.now(),
      checksum,
    };
    
    // Store result with TTL
    await redis.setex(resultKey, ttlSeconds, JSON.stringify(cacheData));
    
    // Release lock
    await redis.del(lockKey);
    
    logger.info(`[Idempotency] Result stored for key: ${key}, TTL: ${ttlSeconds}s`);
    
  } catch (error) {
    if (isRedisUnavailableError(error)) {
      warnRedisUnavailable("storeIdempotencyResult", key, error);
      return;
    }
    logger.error(`[Idempotency] Error storing result for key ${key}:`, error);
    throw error;
  }
}

/**
 * Store error result for idempotency key (non-retryable errors only)
 * @param {string} key - Idempotency key
 * @param {Error} error - Error object
 * @param {Object} payload - Original request payload for checksum
 * @param {number} ttlSeconds - Cache TTL (default: 3600 = 1 hour)
 * @returns {Promise<void>}
 */
export async function storeIdempotencyError(key, error, payload = null, ttlSeconds = ERROR_TTL_SECONDS) {
  if (!validateIdempotencyKey(key)) {
    throw new Error("Invalid idempotency key format");
  }
  
  const redis = getRedisClient();
  if (!redis) {
    warnRedisUnavailable("storeIdempotencyError", key);
    return;
  }

  const errorKey = ERROR_KEY_PREFIX + key;
  const lockKey = LOCK_KEY_PREFIX + key;
  
  try {
    const checksum = payload ? generatePayloadChecksum(payload) : null;
    
    const errorData = {
      status: "error",
      error: {
        message: error.message,
        statusCode: error.statusCode || 500,
        code: error.code || "UNKNOWN_ERROR",
      },
      timestamp: Date.now(),
      checksum,
    };
    
    // Store error with TTL
    await redis.setex(errorKey, ttlSeconds, JSON.stringify(errorData));
    
    // Release lock
    await redis.del(lockKey);
    
    logger.info(`[Idempotency] Error stored for key: ${key}, TTL: ${ttlSeconds}s`);
    
  } catch (err) {
    if (isRedisUnavailableError(err)) {
      warnRedisUnavailable("storeIdempotencyError", key, err);
      return;
    }
    logger.error(`[Idempotency] Error storing error for key ${key}:`, err);
    throw err;
  }
}

/**
 * Release idempotency lock (for retryable errors)
 * @param {string} key - Idempotency key
 * @returns {Promise<void>}
 */
export async function releaseIdempotencyLock(key) {
  if (!validateIdempotencyKey(key)) {
    throw new Error("Invalid idempotency key format");
  }
  
  const redis = getRedisClient();
  if (!redis) {
    warnRedisUnavailable("releaseIdempotencyLock", key);
    return;
  }

  const lockKey = LOCK_KEY_PREFIX + key;
  
  try {
    await redis.del(lockKey);
    logger.info(`[Idempotency] Lock released for key: ${key}`);
    
  } catch (error) {
    if (isRedisUnavailableError(error)) {
      warnRedisUnavailable("releaseIdempotencyLock", key, error);
      return;
    }
    logger.error(`[Idempotency] Error releasing lock for key ${key}:`, error);
    throw error;
  }
}

/**
 * Classify error as retryable or non-retryable
 * @param {Error} error - Error object
 * @returns {boolean} True if retryable
 */
export function isRetryableError(error) {
  // Network errors, timeouts, 5xx responses are retryable
  const retryableCodes = ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH"];
  const retryableStatusCodes = [500, 502, 503, 504];
  
  if (error.code && retryableCodes.includes(error.code)) {
    return true;
  }
  
  if (error.statusCode && retryableStatusCodes.includes(error.statusCode)) {
    return true;
  }
  
  // Validation errors, insufficient stock, 4xx responses are non-retryable
  const nonRetryableStatusCodes = [400, 401, 403, 404, 422];
  
  if (error.statusCode && nonRetryableStatusCodes.includes(error.statusCode)) {
    return false;
  }
  
  // Default to non-retryable for safety
  return false;
}

export default {
  validateIdempotencyKey,
  checkIdempotency,
  acquireIdempotencyLock,
  storeIdempotencyResult,
  storeIdempotencyError,
  releaseIdempotencyLock,
  isRetryableError,
};
