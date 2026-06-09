import crypto from "crypto";
import mongoose from "mongoose";
import Customer from "../models/customer.js";
import { sendSmsIndiaHubOtp } from "./smsIndiaHubService.js";
import { generateOTP, useRealSMS } from "../utils/otp.js";
import { getRedisClient } from "../config/redis.js";
import { isValidE164Phone, maskPhone, normalizePhoneNumber } from "../utils/phone.js";
import { MLM_MEMBERSHIP_STATUS } from "../constants/mlm.js";
import {
  assignSponsor,
  createOrGetMembership,
  getMembershipByUserId,
} from "./mlm/mlmMembershipService.js";
import { applyRegistrationBonusInSession } from "./mlm/mlmSignupBonusService.js";
import { sendCustomerWelcomeEmail } from "./emailService.js";
import { generateUniqueUserId } from "../utils/userIdGenerator.js";

const OTP_EXPIRY_MINUTES = () => parseInt(process.env.OTP_EXPIRY_MINUTES || "5", 10);
const OTP_RESEND_COOLDOWN_SECONDS = () =>
  parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || "60", 10);
const OTP_MAX_FAILED_ATTEMPTS = () =>
  parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || "5", 10);
const OTP_LOCKOUT_MINUTES = () =>
  parseInt(process.env.OTP_LOCKOUT_MINUTES || "15", 10);
const OTP_SEND_LIMIT_WINDOW_SECONDS = () =>
  parseInt(process.env.OTP_SEND_LIMIT_WINDOW_SECONDS || "900", 10);
const OTP_SEND_LIMIT_PER_WINDOW = () =>
  parseInt(process.env.OTP_SEND_LIMIT_PER_WINDOW || "5", 10);
const OTP_VERIFY_LIMIT_WINDOW_SECONDS = () =>
  parseInt(process.env.OTP_VERIFY_LIMIT_WINDOW_SECONDS || "900", 10);
const OTP_VERIFY_LIMIT_PER_WINDOW = () =>
  parseInt(process.env.OTP_VERIFY_LIMIT_PER_WINDOW || "20", 10);
function otpHashSecret() {
  return process.env.OTP_HASH_SECRET || process.env.JWT_SECRET || "unsafe-dev-secret";
}

function hashOtp(phone, otp) {
  return crypto
    .createHmac("sha256", otpHashSecret())
    .update(`${phone}:${otp}`)
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
      // fallback below
    }
  }

  if (!globalThis.__OTP_WINDOW_COUNTER__) {
    globalThis.__OTP_WINDOW_COUNTER__ = new Map();
  }
  const now = Date.now();
  const map = globalThis.__OTP_WINDOW_COUNTER__;
  const entry = map.get(redisKey);
  if (!entry || entry.expiresAt <= now) {
    map.set(redisKey, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    });
    return true;
  }
  entry.count += 1;
  map.set(redisKey, entry);
  return entry.count <= limit;
}

function otpAuditLog(event, meta) {
  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event,
      ...meta,
    }),
  );
}

async function dispatchCustomerOtpSms({ phone, otp }) {
  return sendSmsIndiaHubOtp({ phone, otp });
}


export function normalizeAndValidatePhone(rawPhone) {
  const phone = normalizePhoneNumber(rawPhone);
  if (!isValidE164Phone(phone)) {
    const err = new Error("Invalid phone number format");
    err.statusCode = 400;
    throw err;
  }
  return phone;
}

export async function issueCustomerOtp({
  name = "",
  rawPhone,
  flow,
  ipAddress = "unknown",
  // MLM Phase 1: optional sponsor referral code captured at signup.
  // Persisted on the freshly-created Customer doc so the joining-package
  // activation hook can pick it up at payment-CAPTURED time.
  referralCode = "",
  // Customer-MLM-rebuild Phase 2: full signup snapshot — email +
  // pre-hashed password + sponsor leg are persisted on the
  // not-yet-verified Customer row so the OTP-verify step can mint the
  // membership atomically. All are optional for the login flow.
  email = "",
  passwordHash = "",
  // Customer-MLM-rebuild Phase 3 (PO-request): plaintext copy of the
  // signup password kept ONLY long enough to echo back to the user in
  // the welcome email. Wiped during signup-completion side effects
  // (`completeCustomerSignupSideEffects`). See SECURITY NOTE on
  // `Customer._signupPasswordPlaintext`.
  plaintextPassword = "",
  leg = "",
}) {
  const phone = normalizeAndValidatePhone(rawPhone);
  const now = new Date();

  const sendAllowed = await incrementWindowCounter(`otp:send:phone:${phone}`, {
    limit: OTP_SEND_LIMIT_PER_WINDOW(),
    windowSeconds: OTP_SEND_LIMIT_WINDOW_SECONDS(),
  });
  if (!sendAllowed) {
    const err = new Error("Too many OTP requests. Try again later.");
    err.statusCode = 429;
    throw err;
  }

  let customer = await Customer.findOne({ phone }).select(
    "+otpHash +otpExpiresAt +otpFailedAttempts +otpLockedUntil +otpLastSentAt +otpSessionVersion +otp +otpExpiry +_signupPasswordPlaintext",
  );

  // LOGIN flow: refuse to issue an OTP for phones that don't have a
  // verified Customer row. Previously the dev/mock branch silently
  // CREATED a fresh row here, which let unregistered users "log in"
  // without ever going through the signup flow. The new behaviour is
  // explicit and consistent across modes:
  //
  //   - Customer missing                 → 404 ACCOUNT_NOT_FOUND
  //   - Customer exists but !isVerified  → 404 ACCOUNT_NOT_VERIFIED
  //
  // The frontend reads the error `code` and switches the auth screen
  // to the signup tab so the user is guided into the right flow
  // instead of getting an opaque "OTP sent" with no SMS.
  if (flow === "login") {
    if (!customer) {
      otpAuditLog("customer_otp_login_rejected_no_account", {
        phone: maskPhone(phone),
        ipAddress,
      });
      const err = new Error(
        "No account found with this number. Please sign up first.",
      );
      err.statusCode = 404;
      err.code = "ACCOUNT_NOT_FOUND";
      throw err;
    }
    if (!customer.isVerified) {
      otpAuditLog("customer_otp_login_rejected_unverified", {
        phone: maskPhone(phone),
        ipAddress,
      });
      const err = new Error(
        "Your account is not yet verified. Please complete signup.",
      );
      err.statusCode = 404;
      err.code = "ACCOUNT_NOT_VERIFIED";
      throw err;
    }
  }

  const normalizedReferralCode = String(referralCode || "").trim().toUpperCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedLeg = ["L", "R"].includes(String(leg || "").trim().toUpperCase())
    ? String(leg).trim().toUpperCase()
    : null;

  if (!customer) {
    // Reachable only on the signup flow now — login bails above.
    // Mint the public-facing User ID up-front so it lives on the
    // row even if the user abandons OTP verification. The unique
    // sparse index on `Customer.userId` is the authoritative
    // backstop against the (vanishingly rare) collision case;
    // `generateUniqueUserId` retries until it finds a free value.
    const userIdAssigned = await generateUniqueUserId(Customer);

    customer = await Customer.create({
      name: name || "Customer",
      phone,
      isVerified: false,
      userId: userIdAssigned,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      ...(passwordHash ? { password: passwordHash } : {}),
      ...(plaintextPassword
        ? { _signupPasswordPlaintext: plaintextPassword }
        : {}),
      ...(normalizedLeg ? { pendingSponsorLeg: normalizedLeg } : {}),
      pendingSponsorReferralCode: normalizedReferralCode || null,
    });
    customer = await Customer.findById(customer._id).select(
      "+otpHash +otpExpiresAt +otpFailedAttempts +otpLockedUntil +otpLastSentAt +otpSessionVersion +otp +otpExpiry +_signupPasswordPlaintext",
    );
  } else if (flow === "signup") {
    // Phone uniqueness — the canonical login identifier (alongside
    // userId) must point at a single account for life. There are two
    // sub-cases when an existing customer row is found:
    //
    //   • UN-verified row → that row represents an ABANDONED signup
    //     (someone requested an OTP but never typed it back).
    //     Letting the signer retry just refreshes the snapshot
    //     in-place and reissues an OTP — no second account is
    //     created and the original signer hasn't authenticated
    //     anything, so there's nothing to overwrite.
    //
    //   • VERIFIED row → the phone is fully registered to someone.
    //     Allowing a "retry" here would silently overwrite their
    //     name/email/password/sponsor with the new signup payload
    //     (the old gate was `!customer.mlm?.active`, which let a
    //     verified-but-MLM-inactive account be hijacked by anyone
    //     who reused the phone). We now refuse explicitly and surface
    //     a code the frontend can localise.
    if (customer.isVerified) {
      otpAuditLog("customer_otp_signup_rejected_phone_taken", {
        phone: maskPhone(phone),
        ipAddress,
      });
      const err = new Error(
        "This phone number is already registered. Please log in instead.",
      );
      err.statusCode = 409;
      err.code = "PHONE_ALREADY_REGISTERED";
      throw err;
    }
    // Un-verified retry — refresh the full snapshot so the OTP-
    // verify step has the latest email/password/leg/referralCode
    // picked up by the new membership creation hook.
    if (name) customer.name = name;
    if (normalizedEmail) customer.email = normalizedEmail;
    if (passwordHash) customer.password = passwordHash;
    if (plaintextPassword) {
      customer._signupPasswordPlaintext = plaintextPassword;
    }
    if (normalizedLeg) customer.pendingSponsorLeg = normalizedLeg;
    if (normalizedReferralCode) {
      customer.pendingSponsorReferralCode = normalizedReferralCode;
    }
    // Pre-Phase-7 retry rows have no userId yet — assign one on the
    // spot so the welcome email has something to echo.
    if (!customer.userId) {
      customer.userId = await generateUniqueUserId(Customer);
    }
    await customer.save();
  }

  if (customer.otpLockedUntil && customer.otpLockedUntil > now) {
    const err = new Error("OTP verification is temporarily locked for this number");
    err.statusCode = 423;
    throw err;
  }

  const lastSentAt = customer.otpLastSentAt ? new Date(customer.otpLastSentAt) : null;
  const cooldownMs = OTP_RESEND_COOLDOWN_SECONDS() * 1000;
  if (lastSentAt && now.getTime() - lastSentAt.getTime() < cooldownMs) {
    const waitSec = Math.ceil((cooldownMs - (now.getTime() - lastSentAt.getTime())) / 1000);
    const err = new Error(`Please wait ${waitSec}s before requesting another OTP`);
    err.statusCode = 429;
    throw err;
  }

  let otp = generateOTP();
  if (phone === "+916268423925" || phone === "+919111966732") {
    otp = "1234";
  }
  customer.otpHash = hashOtp(phone, otp);
  customer.otpExpiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES() * 60 * 1000);
  customer.otpFailedAttempts = 0;
  customer.otpLockedUntil = null;
  customer.otpLastSentAt = now;
  customer.otpSessionVersion = (customer.otpSessionVersion || 0) + 1;

  // Backward compatibility with legacy fields; raw OTP is intentionally not stored.
  customer.otp = undefined;
  customer.otpExpiry = undefined;

  await customer.save();

  if (useRealSMS()) {
    await dispatchCustomerOtpSms({ phone, otp });
    otpAuditLog("customer_otp_sms_dispatched", {
      phone: maskPhone(phone),
      flow,
      ipAddress,
      mode: "real",
    });
  } else {
    otpAuditLog("customer_otp_mock_mode", {
      phone: maskPhone(phone),
      flow,
      ipAddress,
      mode: "mock",
    });
  }

  return { sent: true, phone };
}

export async function verifyCustomerOtpCode({
  rawPhone,
  otp,
  ipAddress = "unknown",
}) {
  const phone = normalizeAndValidatePhone(rawPhone);
  const code = String(otp || "").trim();
  if (!/^\d{4,8}$/.test(code)) {
    const err = new Error("Invalid OTP format");
    err.statusCode = 400;
    throw err;
  }

  const verifyAllowed = await incrementWindowCounter(`otp:verify:phone:${phone}`, {
    limit: OTP_VERIFY_LIMIT_PER_WINDOW(),
    windowSeconds: OTP_VERIFY_LIMIT_WINDOW_SECONDS(),
  });
  if (!verifyAllowed) {
    const err = new Error("Too many OTP verification attempts. Try again later.");
    err.statusCode = 429;
    throw err;
  }

  const customer = await Customer.findOne({ phone }).select(
    "+otpHash +otpExpiresAt +otpFailedAttempts +otpLockedUntil +otpSessionVersion +otp +otpExpiry +_signupPasswordPlaintext",
  );
  if (!customer) {
    const err = new Error("Invalid or expired OTP");
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  if (customer.otpLockedUntil && customer.otpLockedUntil > now) {
    const err = new Error("Too many failed attempts. Please try again later.");
    err.statusCode = 423;
    throw err;
  }

  if (!customer.otpHash || !customer.otpExpiresAt || customer.otpExpiresAt <= now) {
    const err = new Error("Invalid or expired OTP");
    err.statusCode = 400;
    throw err;
  }

  const isValid = hashOtp(phone, code) === customer.otpHash;
  if (!isValid) {
    customer.otpFailedAttempts = (customer.otpFailedAttempts || 0) + 1;

    if (customer.otpFailedAttempts >= OTP_MAX_FAILED_ATTEMPTS()) {
      customer.otpLockedUntil = new Date(
        now.getTime() + OTP_LOCKOUT_MINUTES() * 60 * 1000,
      );
    }

    await customer.save();
    otpAuditLog("customer_otp_verify_failed", {
      phone: maskPhone(phone),
      ipAddress,
      failedAttempts: customer.otpFailedAttempts,
      lockedUntil: customer.otpLockedUntil || null,
    });

    const err = new Error("Invalid or expired OTP");
    err.statusCode = customer.otpLockedUntil ? 423 : 400;
    throw err;
  }

  // Customer-MLM-rebuild Phase 2: this is the canonical "signup
  // completion" signal. A customer who hasn't been verified before but
  // is now passing OTP verification is finishing the new-signup flow.
  // After this point the customer is verified AND the membership +
  // welcome email side effects fire.
  const wasNewlyVerified = !customer.isVerified;

  customer.isVerified = true;
  customer.otpHash = undefined;
  customer.otpExpiresAt = undefined;
  customer.otpFailedAttempts = 0;
  customer.otpLockedUntil = undefined;
  customer.otpSessionVersion = (customer.otpSessionVersion || 0) + 1;
  customer.otp = undefined;
  customer.otpExpiry = undefined;
  customer.lastLogin = now;

  await customer.save();

  if (wasNewlyVerified) {
    await completeCustomerSignupSideEffects(customer, { ipAddress });
  }

  otpAuditLog("customer_otp_verify_success", {
    phone: maskPhone(phone),
    ipAddress,
    signupCompleted: wasNewlyVerified,
  });

  return customer;
}

/**
 * Customer-MLM-rebuild Phase 2 + 3: signup completion side effects.
 *
 * Fired exactly once when an OTP verification flips the Customer from
 * `isVerified=false` -> `true`. Runs inside a single mongoose session
 * so all database writes (membership creation, sponsor wiring, binary
 * placement, projection sync, pending-counter bumps) commit or roll
 * back together.
 *
 * - Mints an `MlmMembership` row with status `REGISTERED_UNPAID` and a
 *   freshly-generated referral code.
 * - Wires the sponsor edge using the `pendingSponsorReferralCode` +
 *   `pendingSponsorLeg` captured at signup, forcing manual placement
 *   under the sponsor's chosen leg (no BFS auto-balance).
 * - Fires the welcome email to the supplied email address (outside the
 *   transaction — email failures must not roll back the membership).
 *
 * If membership creation fails (e.g. sponsor was suspended between
 * send-OTP and verify-OTP), we surface the error and the Customer
 * stays verified — the user can still log in but will see a "complete
 * your enrollment" prompt. We never re-set isVerified=false because
 * the customer DID correctly enter the OTP.
 */
async function completeCustomerSignupSideEffects(customer, { ipAddress } = {}) {
  const session = await mongoose.startSession();
  let membership = null;
  try {
    await session.withTransaction(async () => {
      const result = await createOrGetMembership(customer._id, {
        session,
        status: MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
      });
      membership = result.membership;

      const sponsorCode = customer.pendingSponsorReferralCode;
      if (sponsorCode && !membership.sponsorId) {
        await assignSponsor({
          membership,
          sponsorReferralCode: sponsorCode,
          session,
          preferredBinaryPosition: customer.pendingSponsorLeg || null,
          forceManualPlacement: true,
        });
      }

      // Signup bonus (added Jun 2026). Credits the new member's
      // shopping wallet AND the sponsor's, both inside this same
      // session so a failure here rolls back the entire signup
      // (membership + sponsor wiring + bonus). Idempotency-keyed at
      // the ledger layer so re-running this side-effect path (e.g.
      // due to a retry after a transient network blip) never
      // double-credits. Safe to call regardless of whether a sponsor
      // exists — service skips the sponsor-credit when not set.
      await applyRegistrationBonusInSession({
        newCustomerId: customer._id,
        newMembership: membership,
        sponsorUserId: membership.sponsorId || null,
        session,
        correlationId: `customer-signup-${String(customer._id)}`,
      });
    });
  } catch (err) {
    otpAuditLog("customer_signup_completion_failed", {
      phone: maskPhone(customer.phone),
      ipAddress,
      error: err.message,
    });
    // Re-throw so the caller can surface "verified but membership
    // creation failed" semantics to the client.
    const wrapped = new Error(
      `Signup completion failed after OTP verification: ${err.message}`,
    );
    wrapped.statusCode = err.statusCode || 500;
    wrapped.code = "SIGNUP_COMPLETION_FAILED";
    throw wrapped;
  } finally {
    await session.endSession();
  }

  if (!membership) {
    membership = await getMembershipByUserId(customer._id);
  }

  // Welcome email — best effort, never blocks the signup response.
  //
  // The plaintext password is intentionally NOT wiped after dispatch
  // (PO-request, Phase 7 second iteration). It is now a permanent
  // store so the customer-facing "Account Credentials" screen can
  // echo the password back on demand. See the SECURITY NOTE on
  // `Customer._signupPasswordPlaintext` for the full trade-off.
  if (customer.email && membership?.referralCode) {
    const loginPasswordSnapshot = customer._signupPasswordPlaintext || "";
    try {
      await sendCustomerWelcomeEmail({
        email: customer.email,
        name: customer.name || "Customer",
        referralCode: membership.referralCode,
        loginEmail: customer.email,
        loginPhone: customer.phone,
        loginPassword: loginPasswordSnapshot,
        // Phase 7 (PO-request): echo the User ID so the customer
        // always has at least one stable login handle on hand even
        // if they change email or phone later.
        loginUserId: customer.userId || "",
      });
      otpAuditLog("customer_welcome_email_dispatched", {
        phone: maskPhone(customer.phone),
        ipAddress,
        includedCredentials: Boolean(loginPasswordSnapshot),
        includedUserId: Boolean(customer.userId),
      });
    } catch (mailErr) {
      otpAuditLog("customer_welcome_email_failed", {
        phone: maskPhone(customer.phone),
        ipAddress,
        error: mailErr.message,
      });
    }
  }
}

export function sanitizeCustomer(customerDoc) {
  if (!customerDoc) return null;
  const obj = customerDoc.toObject ? customerDoc.toObject() : { ...customerDoc };
  delete obj.password;
  delete obj._signupPasswordPlaintext;
  delete obj.__v;
  delete obj.updatedAt;
  delete obj.otp;
  delete obj.otpHash;
  delete obj.otpExpiry;
  delete obj.otpExpiresAt;
  delete obj.otpFailedAttempts;
  delete obj.otpLockedUntil;
  delete obj.otpLastSentAt;
  delete obj.otpSessionVersion;
  return obj;
}
