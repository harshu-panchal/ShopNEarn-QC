import nodemailer from "nodemailer";
import logger from "./logger.js";
import { buildCustomerWelcomeEmail } from "../templates/email/customerWelcome.js";

let cachedTransporter = null;

export function useRealEmailOTP() {
  return (
    process.env.USE_REAL_EMAIL_OTP === "true" ||
    process.env.USE_REAL_EMAIL_OTP === "1"
  );
}

function parseSmtpPort() {
  return parseInt(process.env.SMTP_PORT || "587", 10);
}

function parseSmtpSecure(port) {
  if (process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1") {
    return true;
  }

  if (process.env.SMTP_SECURE === "false" || process.env.SMTP_SECURE === "0") {
    return false;
  }

  return port === 465;
}

function getMailFrom() {
  const fromAddress = String(process.env.MAIL_FROM || "").trim();
  const fromName = String(process.env.MAIL_FROM_NAME || "").trim();

  if (!fromAddress) {
    const error = new Error("MAIL_FROM is required for email OTP delivery");
    error.statusCode = 500;
    throw error;
  }

  return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
}

function getTransportConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = parseSmtpPort();
  const secure = parseSmtpSecure(port);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();

  if (!host) {
    const error = new Error("SMTP_HOST is required for email OTP delivery");
    error.statusCode = 500;
    throw error;
  }

  if (!Number.isFinite(port) || port <= 0) {
    const error = new Error("SMTP_PORT must be a valid number");
    error.statusCode = 500;
    throw error;
  }

  if ((user && !pass) || (!user && pass)) {
    const error = new Error("SMTP_USER and SMTP_PASS must be provided together");
    error.statusCode = 500;
    throw error;
  }

  return {
    host,
    port,
    secure,
    ...(user && pass
      ? {
          auth: {
            user,
            pass,
          },
        }
      : {}),
  };
}

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(getTransportConfig());
  }

  return cachedTransporter;
}

export async function sendSellerVerificationOtpEmail({
  email,
  otp,
  expiresInMinutes,
}) {
  if (!useRealEmailOTP()) {
    logger.info("Seller email OTP generated in mock mode", {
      email,
      otp,
      mode: "mock",
    });
    return {
      delivered: false,
      mode: "mock",
    };
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: getMailFrom(),
    to: email,
    subject: "Verify your seller signup email",
    text: `Your seller signup verification code is ${otp}. This code expires in ${expiresInMinutes} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        <p>Your seller signup verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${otp}</p>
        <p>This code expires in ${expiresInMinutes} minutes.</p>
      </div>
    `,
  });

  return {
    delivered: true,
    mode: "real",
  };
}

export async function sendSellerForgotPasswordOtpEmail({
  email,
  otp,
  expiresInMinutes,
}) {
  if (!useRealEmailOTP()) {
    logger.info("Seller forgot password email OTP generated in mock mode", {
      email,
      otp,
      mode: "mock",
    });
    return {
      delivered: false,
      mode: "mock",
    };
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: getMailFrom(),
    to: email,
    subject: "Reset your seller password",
    text: `Your seller password reset code is ${otp}. This code expires in ${expiresInMinutes} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        <p>Your seller password reset code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${otp}</p>
        <p>This code expires in ${expiresInMinutes} minutes.</p>
      </div>
    `,
  });

  return {
    delivered: true,
    mode: "real",
  };
}

/**
 * Customer-MLM-rebuild Phase 3: congratulations email fired exactly
 * once when a new customer completes the signup OTP verification. The
 * referral code is included so the user can start sharing immediately
 * without having to open the app first. NEVER mentions "MLM" — the
 * customer surface is branded as the Rewards Program.
 *
 * Behaves like `sendSellerVerificationOtpEmail`: in mock mode (no real
 * SMTP credentials) it logs and returns `{delivered: false}` so dev /
 * staging environments do not need a working transporter.
 */
export async function sendCustomerWelcomeEmail({
  email,
  name,
  referralCode,
  ctaUrl,
  appName,
  // Customer-MLM-rebuild Phase 3 (PO-request): the customer's own
  // login credentials are echoed back in the welcome email so they
  // never lose track of how to sign in. Plaintext password handling
  // is documented on `Customer._signupPasswordPlaintext` — read that
  // SECURITY NOTE before changing this signature.
  loginEmail,
  loginPhone,
  loginPassword,
  // Phase 7 (PO-request): the new short public-facing User ID. Acts
  // as a third login identifier alongside email + phone. Format is
  // documented on `app/utils/userIdGenerator.js`.
  loginUserId,
}) {
  if (!email) {
    logger.warn("sendCustomerWelcomeEmail called without email — skipping");
    return { delivered: false, mode: "skipped" };
  }

  const message = buildCustomerWelcomeEmail({
    name,
    referralCode,
    ctaUrl,
    appName,
    loginEmail,
    loginPhone,
    loginPassword,
    loginUserId,
  });

  if (!useRealEmailOTP()) {
    logger.info("Customer welcome email generated in mock mode", {
      email,
      referralCode,
      mode: "mock",
    });
    return { delivered: false, mode: "mock" };
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: getMailFrom(),
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { delivered: true, mode: "real" };
}

export function __resetEmailTransportForTests() {
  cachedTransporter = null;
}
