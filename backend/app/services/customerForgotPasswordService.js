/**
 * Customer forgot-password via email OTP.
 *
 * Flow mirrors seller forgot-password:
 *   1. issueCustomerForgotPasswordOtp  — email OTP
 *   2. verifyCustomerForgotPasswordOtp — returns short-lived reset JWT
 *   3. resetCustomerForgotPassword     — set new password (hash + plaintext)
 *
 * Email is intentionally non-unique on Customer. Rules:
 *   - 0 matches  → anti-enumeration success (no OTP sent)
 *   - 1 match    → send OTP
 *   - 2+ matches → 409 EMAIL_SHARED (user must contact support)
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import Customer from "../models/customer.js";
import OtpVerification from "../models/otpVerification.js";
import { getRedisClient } from "../config/redis.js";
import { MOCK_OTP } from "../utils/otp.js";
import {
  sendCustomerForgotPasswordOtpEmail,
  useRealEmailOTP,
} from "./emailService.js";

const PURPOSE = "customer_forgot_password";
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);

const OTP_EXPIRY_MINUTES = () =>
  parseInt(process.env.CUSTOMER_OTP_EXPIRY_MINUTES || process.env.OTP_EXPIRY_MINUTES || "5", 10);
const OTP_RESEND_COOLDOWN_SECONDS = () =>
  parseInt(
    process.env.CUSTOMER_OTP_RESEND_COOLDOWN_SECONDS ||
      process.env.OTP_RESEND_COOLDOWN_SECONDS ||
      "60",
    10,
  );
const OTP_MAX_FAILED_ATTEMPTS = () =>
  parseInt(
    process.env.CUSTOMER_OTP_MAX_FAILED_ATTEMPTS ||
      process.env.OTP_MAX_FAILED_ATTEMPTS ||
      "5",
    10,
  );
const OTP_SEND_LIMIT_WINDOW_SECONDS = () =>
  parseInt(process.env.CUSTOMER_OTP_SEND_LIMIT_WINDOW_SECONDS || "900", 10);
const OTP_SEND_LIMIT_PER_WINDOW = () =>
  parseInt(process.env.CUSTOMER_OTP_SEND_LIMIT_PER_WINDOW || "5", 10);
const OTP_VERIFY_LIMIT_WINDOW_SECONDS = () =>
  parseInt(process.env.CUSTOMER_OTP_VERIFY_LIMIT_WINDOW_SECONDS || "900", 10);
const OTP_VERIFY_LIMIT_PER_WINDOW = () =>
  parseInt(process.env.CUSTOMER_OTP_VERIFY_LIMIT_PER_WINDOW || "20", 10);

function verificationSecret() {
  return (
    process.env.CUSTOMER_VERIFICATION_SECRET ||
    process.env.OTP_HASH_SECRET ||
    process.env.JWT_SECRET ||
    "unsafe-dev-secret"
  );
}

function makeError(message, statusCode = 400, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw makeError("Please enter a valid email address", 400, "EMAIL_INVALID");
  }
  return email;
}

function maskEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  const visibleLocal =
    local.length <= 2 ? `${local[0] || "*"}*` : `${local.slice(0, 2)}***`;
  return `${visibleLocal}@${domain}`;
}

function randomOtp(length = 4) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function generateOtp() {
  const production = process.env.NODE_ENV === "production";
  if (production && !useRealEmailOTP()) {
    throw makeError(
      "Email OTP delivery is not configured in production",
      500,
      "EMAIL_NOT_CONFIGURED",
    );
  }
  return useRealEmailOTP() ? randomOtp(4) : MOCK_OTP;
}

function hashOtp(target, otp) {
  return crypto
    .createHmac("sha256", verificationSecret())
    .update(`${PURPOSE}:email:${target}:${otp}`)
    .digest("hex");
}

async function incrementWindowCounter(redisKey, { limit, windowSeconds }) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const [count] = await Promise.all([
        redis.incr(redisKey),
        redis.expire(redisKey, windowSeconds),
      ]);
      return Number(count) <= limit;
    } catch {
      /* fall through */
    }
  }

  if (!globalThis.__CUSTOMER_FORGOT_OTP_WINDOW__) {
    globalThis.__CUSTOMER_FORGOT_OTP_WINDOW__ = new Map();
  }
  const store = globalThis.__CUSTOMER_FORGOT_OTP_WINDOW__;
  const now = Date.now();
  const entry = store.get(redisKey);
  if (!entry || entry.expiresAt <= now) {
    store.set(redisKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return true;
  }
  entry.count += 1;
  store.set(redisKey, entry);
  return entry.count <= limit;
}

const ANTI_ENUM_RESPONSE = {
  sent: true,
  channel: "email",
  maskedTarget: null,
  expiresInSeconds: OTP_EXPIRY_MINUTES() * 60,
  antiEnumeration: true,
};

export function signCustomerForgotPasswordToken({ email, customerId }) {
  return jwt.sign(
    {
      purpose: PURPOSE,
      channel: "email",
      target: email,
      customerId: String(customerId),
      verified: true,
    },
    verificationSecret(),
    { expiresIn: "15m" },
  );
}

export function verifyCustomerForgotPasswordToken({ email, token }) {
  const target = normalizeEmail(email);
  if (!token) {
    throw makeError("Reset token is required", 400, "RESET_TOKEN_REQUIRED");
  }
  try {
    const decoded = jwt.verify(token, verificationSecret());
    if (
      decoded.purpose !== PURPOSE ||
      decoded.channel !== "email" ||
      decoded.target !== target ||
      decoded.verified !== true ||
      !decoded.customerId
    ) {
      throw makeError("Invalid or expired reset token", 400, "RESET_TOKEN_INVALID");
    }
    return decoded;
  } catch (err) {
    if (err.statusCode) throw err;
    throw makeError("Invalid or expired reset token", 401, "RESET_TOKEN_INVALID");
  }
}

/**
 * Resolve the single customer for this email, or throw / return null.
 * @returns {Promise<{ customer: object|null, shared: boolean }>}
 */
async function resolveCustomerByEmail(email) {
  const matches = await Customer.find({ email, role: "user" })
    .select("_id email isActive")
    .lean();
  if (matches.length === 0) {
    return { customer: null, shared: false };
  }
  if (matches.length > 1) {
    return { customer: null, shared: true };
  }
  return { customer: matches[0], shared: false };
}

export async function issueCustomerForgotPasswordOtp({
  email: rawEmail,
  ipAddress = "unknown",
}) {
  const email = normalizeEmail(rawEmail);
  const { customer, shared } = await resolveCustomerByEmail(email);

  if (shared) {
    throw makeError(
      "This email is linked to multiple accounts. Please contact support to reset your password.",
      409,
      "EMAIL_SHARED",
    );
  }

  // Anti-enumeration: same success shape whether or not the account exists.
  if (!customer) {
    console.log(
      JSON.stringify({
        level: "info",
        ts: new Date().toISOString(),
        event: "customer_forgot_password_otp_skipped_unknown",
        target: maskEmail(email),
        ipAddress,
      }),
    );
    return {
      ...ANTI_ENUM_RESPONSE,
      maskedTarget: maskEmail(email),
    };
  }

  if (customer.isActive === false) {
    throw makeError(
      "This account is deactivated. Please contact support.",
      403,
      "ACCOUNT_INACTIVE",
    );
  }

  const sendAllowed = await incrementWindowCounter(
    `customer:forgot:send:email:${email}`,
    {
      limit: OTP_SEND_LIMIT_PER_WINDOW(),
      windowSeconds: OTP_SEND_LIMIT_WINDOW_SECONDS(),
    },
  );
  if (!sendAllowed) {
    throw makeError(
      "Too many OTP requests. Please try again later.",
      429,
      "SEND_RATE_LIMIT",
    );
  }

  const now = new Date();
  let session = await OtpVerification.findOne({
    purpose: PURPOSE,
    channel: "email",
    target: email,
  }).select("+otpHash +expiresAt");

  if (session?.lastSentAt) {
    const elapsedMs = now.getTime() - new Date(session.lastSentAt).getTime();
    const cooldownMs = OTP_RESEND_COOLDOWN_SECONDS() * 1000;
    if (elapsedMs < cooldownMs) {
      const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
      throw makeError(
        `Please wait ${waitSeconds}s before requesting another OTP`,
        429,
        "RESEND_COOLDOWN",
      );
    }
  }

  const otp = generateOtp();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES() * 60 * 1000);

  if (!session) {
    session = new OtpVerification({
      purpose: PURPOSE,
      channel: "email",
      target: email,
      otpHash: hashOtp(email, otp),
      expiresAt,
      verifiedAt: null,
      failedAttempts: 0,
      lastSentAt: now,
    });
  } else {
    session.otpHash = hashOtp(email, otp);
    session.expiresAt = expiresAt;
    session.verifiedAt = null;
    session.failedAttempts = 0;
    session.lastSentAt = now;
  }
  await session.save();

  await sendCustomerForgotPasswordOtpEmail({
    email,
    otp,
    expiresInMinutes: OTP_EXPIRY_MINUTES(),
  });

  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event: "customer_forgot_password_otp_issued",
      target: maskEmail(email),
      customerId: String(customer._id),
      ipAddress,
      mode: useRealEmailOTP() ? "real" : "mock",
    }),
  );

  return {
    sent: true,
    channel: "email",
    maskedTarget: maskEmail(email),
    expiresInSeconds: OTP_EXPIRY_MINUTES() * 60,
    resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS(),
  };
}

export async function verifyCustomerForgotPasswordOtp({
  email: rawEmail,
  otp,
  ipAddress = "unknown",
}) {
  const email = normalizeEmail(rawEmail);
  const code = String(otp || "").trim();
  if (!/^\d{4}$/.test(code)) {
    throw makeError("Please enter a valid OTP", 400, "OTP_INVALID");
  }

  const { customer, shared } = await resolveCustomerByEmail(email);
  if (shared) {
    throw makeError(
      "This email is linked to multiple accounts. Please contact support to reset your password.",
      409,
      "EMAIL_SHARED",
    );
  }
  if (!customer) {
    throw makeError("Invalid or expired OTP", 400, "OTP_INVALID");
  }

  const verifyAllowed = await incrementWindowCounter(
    `customer:forgot:verify:email:${email}`,
    {
      limit: OTP_VERIFY_LIMIT_PER_WINDOW(),
      windowSeconds: OTP_VERIFY_LIMIT_WINDOW_SECONDS(),
    },
  );
  if (!verifyAllowed) {
    throw makeError(
      "Too many verification attempts. Please try again later.",
      429,
      "VERIFY_RATE_LIMIT",
    );
  }

  const session = await OtpVerification.findOne({
    purpose: PURPOSE,
    channel: "email",
    target: email,
  }).select("+otpHash +expiresAt");

  if (!session || !session.otpHash || !session.expiresAt || session.expiresAt <= new Date()) {
    throw makeError("Invalid or expired OTP", 400, "OTP_INVALID");
  }

  const isValid = hashOtp(email, code) === session.otpHash;
  if (!isValid) {
    session.failedAttempts = (session.failedAttempts || 0) + 1;
    await session.save();
    if (session.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS()) {
      await OtpVerification.deleteOne({ _id: session._id });
    }
    throw makeError("Invalid or expired OTP", 400, "OTP_INVALID");
  }

  await OtpVerification.deleteOne({ _id: session._id });

  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event: "customer_forgot_password_otp_verified",
      target: maskEmail(email),
      customerId: String(customer._id),
      ipAddress,
    }),
  );

  return {
    verified: true,
    channel: "email",
    resetToken: signCustomerForgotPasswordToken({
      email,
      customerId: customer._id,
    }),
  };
}

export async function resetCustomerForgotPassword({
  email: rawEmail,
  resetToken,
  newPassword,
}) {
  const email = normalizeEmail(rawEmail);
  if (!newPassword || String(newPassword).length < 6) {
    throw makeError(
      "Password must be at least 6 characters",
      400,
      "PASSWORD_TOO_SHORT",
    );
  }

  const decoded = verifyCustomerForgotPasswordToken({ email, token: resetToken });

  const { customer: leanCustomer, shared } = await resolveCustomerByEmail(email);
  if (shared) {
    throw makeError(
      "This email is linked to multiple accounts. Please contact support to reset your password.",
      409,
      "EMAIL_SHARED",
    );
  }
  if (!leanCustomer || String(leanCustomer._id) !== String(decoded.customerId)) {
    throw makeError("Customer account not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const customer = await Customer.findById(leanCustomer._id).select(
    "+password +_signupPasswordPlaintext",
  );
  if (!customer) {
    throw makeError("Customer account not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const plain = String(newPassword).trim();
  customer.password = await bcrypt.hash(plain, BCRYPT_ROUNDS);
  customer._signupPasswordPlaintext = plain;
  await customer.save();

  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event: "customer_forgot_password_reset",
      target: maskEmail(email),
      customerId: String(customer._id),
    }),
  );

  return { reset: true };
}
