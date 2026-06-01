import crypto from "crypto";
import { getRedisClient } from "../config/redis.js";

const localStore = new Map();

function nowMs() {
  return Date.now();
}

function cleanupLocalStore() {
  const now = nowMs();
  for (const [key, value] of localStore.entries()) {
    if (!value || value.expiresAt <= now) {
      localStore.delete(key);
    }
  }
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

async function incrementCount({ key, windowSec }) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const [count] = await Promise.all([
        redis.incr(key),
        redis.expire(key, windowSec),
      ]);
      return Number(count);
    } catch {
      // fallback below
    }
  }

  cleanupLocalStore();
  const now = nowMs();
  const existing = localStore.get(key);
  if (!existing || existing.expiresAt <= now) {
    localStore.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
    return 1;
  }
  existing.count += 1;
  localStore.set(key, existing);
  return existing.count;
}

export function createRateLimiter({
  namespace,
  windowMs,
  max,
  keyGenerator,
  message = "Too many requests. Please try again later.",
}) {
  const safeWindowMs = Math.max(1000, Number(windowMs || 60000));
  const safeMax = Math.max(1, Number(max || 60));
  const windowSec = Math.ceil(safeWindowMs / 1000);

  return async (req, res, next) => {
    try {
      const keyPart = keyGenerator ? keyGenerator(req) : getClientIp(req);
      const bucket = Math.floor(nowMs() / safeWindowMs);
      const key = `rl:${namespace}:${hash(`${keyPart}:${bucket}`)}`;
      const count = await incrementCount({ key, windowSec });

      res.setHeader("X-RateLimit-Limit", String(safeMax));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, safeMax - count)));
      res.setHeader("X-RateLimit-Reset", String(bucket * safeWindowMs + safeWindowMs));

      if (count > safeMax) {
        return res.status(429).json({
          success: false,
          error: true,
          message,
          result: {
            code: "RATE_LIMITED",
          },
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function byIp(req) {
  return getClientIp(req);
}

export function byUserOrIp(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${getClientIp(req)}`;
}

// ---------------------------------------------------------------------------
// Pre-configured limiters (previously defined in rateLimiters.js).
// rateLimiters.js is now a thin re-export shim that delegates here so any
// existing `import ... from "./rateLimiters.js"` keeps working unchanged.
// ---------------------------------------------------------------------------

const OTP_SEND_WINDOW_MS = () =>
  parseInt(process.env.OTP_SEND_RATE_LIMIT_WINDOW_MS || "900000", 10);
const OTP_SEND_MAX = () =>
  parseInt(process.env.OTP_SEND_RATE_LIMIT_MAX || "5", 10);
const OTP_VERIFY_WINDOW_MS = () =>
  parseInt(process.env.OTP_VERIFY_RATE_LIMIT_WINDOW_MS || "900000", 10);
const OTP_VERIFY_MAX = () =>
  parseInt(process.env.OTP_VERIFY_RATE_LIMIT_MAX || "10", 10);

function byMobileOrIp(req) {
  const digits = String(req.body?.mobile || "").replace(/\D/g, "").slice(-10);
  if (!digits) {
    return byIp(req);
  }
  return `${digits}:${getClientIp(req)}`;
}

export const smsOtpSendRateLimiter = createRateLimiter({
  namespace: "sms_otp_send",
  windowMs: OTP_SEND_WINDOW_MS(),
  max: OTP_SEND_MAX(),
  keyGenerator: byMobileOrIp,
  message: "Too many OTP send requests. Please wait before trying again.",
});

export const smsOtpVerifyRateLimiter = createRateLimiter({
  namespace: "sms_otp_verify",
  windowMs: OTP_VERIFY_WINDOW_MS(),
  max: OTP_VERIFY_MAX(),
  keyGenerator: byMobileOrIp,
  message: "Too many OTP verification requests. Please wait before trying again.",
});
