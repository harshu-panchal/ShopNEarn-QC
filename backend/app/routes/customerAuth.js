import express from "express";
import {
    signupCustomer,
    loginCustomer,
    loginWithPassword,
    verifyCustomerOTP,
    getCustomerProfile,
    getCustomerCredentials,
    changeCustomerPassword,
    updateCustomerProfile,
    getCustomerTransactions,
    lookupReferralCode,
    sendCustomerForgotPasswordOtp,
    verifyCustomerForgotPasswordOtp,
    resetCustomerForgotPassword,
} from "../controller/customerAuthController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import {
    authRouteRateLimiter,
    createContentLengthGuard,
    otpRouteRateLimiter,
} from "../middleware/securityMiddlewares.js";

const router = express.Router();
const smallAuthPayload = createContentLengthGuard(
    parseInt(process.env.AUTH_MAX_PAYLOAD_BYTES || "16384", 10),
    "Auth payload too large",
);
router.post("/send-signup-otp", authRouteRateLimiter, otpRouteRateLimiter, smallAuthPayload, signupCustomer);

// Public preview of a sponsor's display name for the signup form's
// "Sponsor: <name>" hint. The same auth-route rate limiter shields
// the endpoint from referral-code enumeration; only the sponsor's
// public display name is ever returned.
router.get("/lookup-referral", authRouteRateLimiter, lookupReferralCode);
router.post("/send-login-otp", authRouteRateLimiter, otpRouteRateLimiter, smallAuthPayload, loginCustomer);
router.post("/verify-otp", authRouteRateLimiter, otpRouteRateLimiter, smallAuthPayload, verifyCustomerOTP);

// Customer-MLM-rebuild Phase 2: dual-login — email-or-phone + password
// works alongside the existing phone+OTP flow. Both are first-class
// authentication paths; the client lets the user pick on the login
// screen.
router.post("/login-password", authRouteRateLimiter, smallAuthPayload, loginWithPassword);

// Forgot password (email OTP → reset token → new password)
router.post(
    "/forgot-password/send-otp",
    authRouteRateLimiter,
    otpRouteRateLimiter,
    smallAuthPayload,
    sendCustomerForgotPasswordOtp,
);
router.post(
    "/forgot-password/verify-otp",
    authRouteRateLimiter,
    otpRouteRateLimiter,
    smallAuthPayload,
    verifyCustomerForgotPasswordOtp,
);
router.post(
    "/forgot-password/reset",
    authRouteRateLimiter,
    smallAuthPayload,
    resetCustomerForgotPassword,
);

// Profile routes
router.get("/profile", verifyToken, getCustomerProfile);
router.put("/profile", verifyToken, updateCustomerProfile);

// Phase 7 (PO-request): in-app "Account Credentials" reveal screen.
// Returns email + phone + plaintext password. See SECURITY NOTE on
// `Customer._signupPasswordPlaintext`.
router.get("/credentials", verifyToken, getCustomerCredentials);

// Phase 7 (PO-request): in-app change-password flow. Authenticated,
// requires the current password as proof of knowledge before
// rotating to a new one. Writes both hash + plaintext copy.
router.post(
    "/change-password",
    verifyToken,
    smallAuthPayload,
    changeCustomerPassword,
);

// Wallet
router.get("/transactions", verifyToken, getCustomerTransactions);

export default router;
