/**
 * Model registry and boot-time integrity check.
 *
 * Side-effect imports every Mongoose model in this codebase so that:
 *
 *   1. `mongoose.modelNames()` is complete at startup time, regardless of
 *      which process role is running (api / worker / scheduler). Some
 *      roles never import all controllers, so the routes-driven implicit
 *      registration would otherwise leave gaps.
 *   2. The `assertAllModelsRegistered()` check below can run from the
 *      startup orchestrator (`app/core/startup.js`) before any business
 *      logic executes. If the codebase drifts (a model file is renamed or
 *      deleted) the boot now crashes loudly instead of allowing routes to
 *      `populate(...)` against a missing model and silently return `null`.
 *
 * This mirrors audit-plan critical findings C-1 and C-9 (the legacy
 * `ref:"Customer"` strings silently broke every populate call). Phase 1
 * ticket P1-5 introduces this guard so that an entire class of bug now
 * becomes a startup-time error.
 *
 * NEVER reorder, rename, or remove an entry without updating the
 * corresponding model file in the same PR. A rename here without a
 * matching schema change is itself the bug this file exists to prevent.
 */

import mongoose from "mongoose";

// ---- 1. Side-effect imports (registration happens at module load) ----

// Core domain models
import "../models/admin.js";
import "../models/cart.js";
import "../models/category.js";
import "../models/checkoutGroup.js";
import "../models/coupon.js";
import "../models/customer.js"; // Registers as mongoose.model("User")
import "../models/delivery.js";
import "../models/deliveryAssignment.js";
import "../models/order.js";
import "../models/orderOtp.js";
import "../models/otpVerification.js";
import "../models/product.js";
import "../models/review.js";
import "../models/seller.js";
import "../models/ticket.js";
import "../models/wishlist.js";

// Finance models
import "../models/financeAuditLog.js";
import "../models/financeReports.js";
import "../models/ledgerEntry.js";
import "../models/payment.js";
import "../models/paymentWebhookEvent.js";
import "../models/payout.js";
import "../models/transaction.js";
import "../models/wallet.js";

// CMS / configuration models
import "../models/experienceSection.js";
import "../models/faq.js";
import "../models/heroConfig.js";
import "../models/offer.js";
import "../models/offerSection.js";
import "../models/setting.js";

// Read-optimized / cache models
import "../models/dashboardStats.js";
import "../models/geocodeCache.js";
import "../models/mediaMetadata.js";
import "../models/notification.js";
import "../models/searchIndexFailure.js";
import "../models/sellerMetrics.js";
import "../models/stockHistory.js";

// Module-scoped models
import "../modules/notifications/preference.model.js"; // NotificationPreference
import "../modules/notifications/token.model.js"; // PushToken
import "../modules/otp/otp.model.js"; // OtpSession

// ---- 2. The canonical list of required Mongoose model names ----
//
// Source of truth for the boot-time assertion. The audit-plan calls out
// that the customer file at app/models/customer.js registers as "User",
// not "Customer" — both the schema file and this list must agree.

export const REQUIRED_MODELS = Object.freeze([
  // Users
  "User",
  "Seller",
  "Delivery",
  "Admin",

  // Catalog
  "Product",
  "Category",
  "Coupon",
  "Offer",
  "OfferSection",
  "ExperienceSection",
  "HeroConfig",

  // Orders & checkout
  "Order",
  "CheckoutGroup",
  "Cart",
  "Wishlist",
  "DeliveryAssignment",
  "Review",

  // Payments & ledger
  "Payment",
  "PaymentWebhookEvent",
  "Transaction",
  "LedgerEntry",
  "Wallet",
  "Payout",
  "FinanceAuditLog",

  // OTP & auth
  "OtpVerification",
  "OrderOtp",
  "OtpSession",

  // Notifications & messaging
  "Notification",
  "NotificationPreference",
  "PushToken",
  "Ticket",
  "FAQ",

  // Configuration
  "Setting",
  "MediaMetadata",

  // Read-optimized / cache
  "GeocodeCache",
  "StockHistory",
  "DashboardStats",
  "SellerMetrics",
  "FinanceReports",
  "SearchIndexFailure",
]);

// ---- 3. Boot-time assertion ----

/**
 * Throws if any `REQUIRED_MODELS` entry isn't registered with Mongoose.
 *
 * Called once from `app/core/startup.js` after the MongoDB connection
 * succeeds and before traffic is accepted. A failure here is a hard
 * startup error: misnamed `ref:` strings, deleted model files, or
 * renamed `mongoose.model("X", ...)` calls all surface here instead
 * of as silent `null` populates at request time.
 *
 * @returns {{ ok: true, registeredCount: number }}
 * @throws {Error} if any required model is missing
 */
export function assertAllModelsRegistered() {
  const registered = new Set(mongoose.modelNames());
  const missing = REQUIRED_MODELS.filter((name) => !registered.has(name));

  if (missing.length > 0) {
    const error = new Error(
      `Required Mongoose models are not registered: ${missing.join(", ")}. ` +
        "This usually means a model file was renamed or its mongoose.model(...) call " +
        "no longer matches the name expected by other schemas' ref:/refPath:. " +
        "See app/core/modelRegistry.js and the audit-plan critical findings C-1, C-9.",
    );
    error.code = "MODEL_REGISTRY_INCOMPLETE";
    error.missing = missing;
    throw error;
  }

  return { ok: true, registeredCount: registered.size };
}
