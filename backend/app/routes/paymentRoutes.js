import express from "express";
import {
  createPaymentOrder,
  verifyPaymentStatus,
  verifyPaymentCallback,
  handlePaymentWebhook,
} from "../controller/paymentController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { paymentRouteRateLimiter } from "../middleware/securityMiddlewares.js";

const paymentRoute = express.Router();

/**
 * Initiate a Razorpay payment order for a CheckoutGroupId or OrderId.
 * Auth: Required (Customer paying for their own order)
 */
paymentRoute.post(
  "/create-order",
  verifyToken,
  paymentRouteRateLimiter,
  createPaymentOrder,
);

/**
 * Verify payment status from client side (poll / recovery).
 * Auth: Required
 */
paymentRoute.get(
  "/status/:id",
  verifyToken,
  paymentRouteRateLimiter,
  verifyPaymentStatus,
);

/**
 * Razorpay Standard Checkout client callback (HMAC signature verify).
 * Auth: Required
 */
paymentRoute.post(
  "/verify-callback",
  verifyToken,
  paymentRouteRateLimiter,
  verifyPaymentCallback,
);

/**
 * Razorpay Server-to-Server Webhook.
 * Auth: None (verified via X-Razorpay-Signature)
 */
paymentRoute.post(
  "/webhook/razorpay",
  express.raw({ type: "application/json" }),
  handlePaymentWebhook,
);

export default paymentRoute;
