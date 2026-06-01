/**
 * Backward-compatibility re-export shim.
 *
 * The configured limiters (smsOtpSendRateLimiter, smsOtpVerifyRateLimiter)
 * previously lived here. They have been consolidated into rateLimiter.js so
 * the rate-limiting factory and its pre-configured instances live in a single
 * canonical file.
 *
 * This shim preserves all existing imports of the form:
 *   import { ... } from "../middleware/rateLimiters.js";
 *
 * It can be removed once every importer has been migrated to import directly
 * from `./rateLimiter.js`.
 */
export * from "./rateLimiter.js";
