// Audit Phase 5 — Centralized server-side coupon engine.
//
// This module is the SINGLE SOURCE OF TRUTH for coupon validation and
// discount computation across the checkout flow. Before Phase 5, the
// frontend supplied `discountTotal` directly and the order placement
// service trusted it without re-validating (audit C-2). The
// `couponController.validateCoupon` endpoint did its own math with
// client-supplied `cartTotal` and `items` (audit H-7), used `Math.round`
// where everything else uses `roundCurrency` (audit H-2), and silently
// dropped `freeDelivery` at place-order (audit H-6). Per-user usage
// limits were also hard-coded to never trigger (audit C-4).
//
// `computeOrderDiscount` consolidates every coupon rule into one
// codepath that:
//   - Reads the coupon from the database (case-insensitive on code).
//   - Validates active window, overall usageLimit, and per-user usage
//     (real count from `Order.coupon` ref — fixes C-4).
//   - Rehydrates the cart total from the server-side hydrated items,
//     ignoring any client-supplied `cartTotal` — fixes H-7.
//   - Validates minOrderValue, minItems, monthlyVolume, and
//     applicableCategories.
//   - Computes the discount using `roundCurrency` and applies
//     `maxDiscount` — fixes H-2.
//   - Honors `discountType === "free_delivery"` and `couponType ===
//     "free_delivery"` by returning `freeDelivery: true` for the
//     pricing pipeline to zero out the customer-facing delivery fee —
//     fixes H-6.
//   - Returns a frozen `couponSnapshot` for persistence on the Order
//     document so per-user counts and audits replay deterministically.
//
// Callers throw HTTP errors on validation failure. The function returns
// `null` when no coupon is requested — callers must treat that as "no
// discount" without raising.

import mongoose from "mongoose";
import Coupon from "../../models/coupon.js";
import Order from "../../models/order.js";
import { roundCurrency } from "../../utils/money.js";

const CANCELLED_ORDER_STATUSES = ["cancelled", "Cancelled", "CANCELLED"];

function makeError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isObjectIdLike(value) {
  if (!value) return false;
  if (typeof value === "string") return mongoose.isValidObjectId(value);
  if (value._bsontype === "ObjectID" || value instanceof mongoose.Types.ObjectId) {
    return true;
  }
  return false;
}

async function loadCoupon({ couponCode, couponId, session }) {
  const query = (() => {
    if (couponId && isObjectIdLike(couponId)) {
      return Coupon.findById(couponId);
    }
    const codeValue = (couponCode || "").trim().toUpperCase();
    if (!codeValue) return null;
    return Coupon.findOne({ code: codeValue });
  })();
  if (!query) return null;
  if (session) query.session(session);
  return query.lean();
}

function computeCartSubtotalFromHydrated(hydratedItems = []) {
  return roundCurrency(
    (hydratedItems || []).reduce(
      (sum, item) =>
        sum + Number(item?.price || 0) * Number(item?.quantity || 0),
      0,
    ),
  );
}

function buildCouponSnapshot(coupon, { cartSubtotal, discountAmount, freeDelivery }) {
  return {
    couponId: coupon?._id || null,
    code: coupon?.code || null,
    title: coupon?.title || null,
    discountType: coupon?.discountType || null,
    discountValue: Number(coupon?.discountValue || 0),
    maxDiscount: Number.isFinite(Number(coupon?.maxDiscount))
      ? Number(coupon.maxDiscount)
      : null,
    couponType: coupon?.couponType || null,
    minOrderValue: Number(coupon?.minOrderValue || 0),
    minItems: Number(coupon?.minItems || 0),
    perUserLimit: Number.isFinite(Number(coupon?.perUserLimit))
      ? Number(coupon.perUserLimit)
      : null,
    usageLimit: Number.isFinite(Number(coupon?.usageLimit))
      ? Number(coupon.usageLimit)
      : null,
    validFrom: coupon?.validFrom || null,
    validTill: coupon?.validTill || null,
    cartSubtotalAtApply: cartSubtotal,
    discountAmountApplied: discountAmount,
    freeDeliveryApplied: !!freeDelivery,
    appliedAt: new Date(),
  };
}

async function getUserCouponUsageCount({ customerId, couponObjectId, session }) {
  if (!customerId || !couponObjectId) return 0;
  const query = Order.countDocuments({
    customer: customerId,
    coupon: couponObjectId,
    status: { $nin: CANCELLED_ORDER_STATUSES },
  });
  if (session) query.session(session);
  return query;
}

async function getMonthlyVolumeForCustomer({ customerId, session, now = new Date() }) {
  if (!customerId) return 0;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const query = Order.find({
    customer: customerId,
    createdAt: { $gte: monthStart, $lte: now },
  })
    .select("pricing.total paymentBreakdown.grandTotal")
    .lean();
  if (session) query.session(session);
  const orders = await query;
  return orders.reduce(
    (sum, o) =>
      sum +
      Number(
        o?.paymentBreakdown?.grandTotal || o?.pricing?.total || 0,
      ),
    0,
  );
}

function isCategoryEligible(coupon, hydratedItems) {
  if (coupon?.couponType !== "category_based") return true;
  const applicableCategories = Array.isArray(coupon?.applicableCategories)
    ? coupon.applicableCategories
    : [];
  if (applicableCategories.length === 0) return true;
  const allowedSet = new Set(applicableCategories.map((c) => String(c)));
  return (hydratedItems || []).some((item) =>
    allowedSet.has(String(item?.headerCategoryId || "")),
  );
}

/**
 * Compute the server-validated coupon discount for a checkout.
 *
 * @param {Object} params
 * @param {string} [params.couponCode]        Coupon code from request (case-insensitive). Preferred when both are present.
 * @param {string} [params.couponId]          Mongo ObjectId of the coupon. Falls back when no code.
 * @param {string} [params.customerId]        Customer ObjectId for per-user limits and monthly volume.
 * @param {Array}  [params.hydratedItems]     Items already passed through `hydrateOrderItems`. Server prices only.
 * @param {*}      [params.session]           Mongoose session for transactional reads.
 * @returns {Promise<null|{
 *   coupon: Object,
 *   discountAmount: number,
 *   freeDelivery: boolean,
 *   cartSubtotal: number,
 *   couponSnapshot: Object,
 * }>}  Returns `null` when no coupon was requested. Throws on validation failure.
 */
export async function computeOrderDiscount({
  couponCode,
  couponId,
  customerId,
  hydratedItems = [],
  session = null,
} = {}) {
  if (!couponCode && !couponId) return null;
  if (!Array.isArray(hydratedItems) || hydratedItems.length === 0) {
    throw makeError(400, "Cannot apply a coupon to an empty cart");
  }

  const coupon = await loadCoupon({ couponCode, couponId, session });
  if (!coupon) {
    throw makeError(404, "Invalid coupon code");
  }

  const now = new Date();
  if (
    !coupon.isActive ||
    (coupon.validFrom && new Date(coupon.validFrom) > now) ||
    (coupon.validTill && new Date(coupon.validTill) < now)
  ) {
    throw makeError(400, "This coupon is not active");
  }

  if (
    Number.isFinite(Number(coupon.usageLimit)) &&
    Number(coupon.usedCount || 0) >= Number(coupon.usageLimit)
  ) {
    throw makeError(400, "This coupon has reached its usage limit");
  }

  if (customerId && Number.isFinite(Number(coupon.perUserLimit)) && Number(coupon.perUserLimit) > 0) {
    const userUsage = await getUserCouponUsageCount({
      customerId,
      couponObjectId: coupon._id,
      session,
    });
    if (userUsage >= Number(coupon.perUserLimit)) {
      throw makeError(400, "You have already used this coupon");
    }
  }

  const cartSubtotal = computeCartSubtotalFromHydrated(hydratedItems);
  const totalItems = hydratedItems.reduce(
    (sum, item) => sum + Number(item?.quantity || 0),
    0,
  );

  if (coupon.minOrderValue && cartSubtotal < Number(coupon.minOrderValue)) {
    throw makeError(
      400,
      `Minimum order value should be ₹${coupon.minOrderValue}`,
    );
  }

  if (coupon.minItems && totalItems < Number(coupon.minItems)) {
    throw makeError(
      400,
      `Add at least ${coupon.minItems} items to use this coupon`,
    );
  }

  if (!isCategoryEligible(coupon, hydratedItems)) {
    throw makeError(
      400,
      "This coupon is valid only on selected categories",
    );
  }

  if (
    coupon.couponType === "monthly_volume" &&
    Number(coupon.monthlyVolumeThreshold || 0) > 0 &&
    customerId
  ) {
    const monthlyVolume = await getMonthlyVolumeForCustomer({
      customerId,
      session,
      now,
    });
    if (monthlyVolume < Number(coupon.monthlyVolumeThreshold)) {
      throw makeError(
        400,
        "This coupon is for high-volume buyers only",
      );
    }
  }

  // Discount math — fixes H-2 (consistent rounding via `roundCurrency`).
  let discountAmount = 0;
  let freeDelivery = false;
  const couponType = String(coupon.couponType || "").toLowerCase();
  const discountType = String(coupon.discountType || "").toLowerCase();

  if (discountType === "free_delivery" || couponType === "free_delivery") {
    freeDelivery = true;
  } else if (discountType === "percentage") {
    discountAmount = roundCurrency(
      (cartSubtotal * Number(coupon.discountValue || 0)) / 100,
    );
  } else if (discountType === "fixed") {
    discountAmount = roundCurrency(Number(coupon.discountValue || 0));
  }

  if (Number.isFinite(Number(coupon.maxDiscount)) && Number(coupon.maxDiscount) > 0) {
    discountAmount = Math.min(discountAmount, Number(coupon.maxDiscount));
  }

  // Never let the coupon zero out a positive cart by accident.
  discountAmount = Math.max(0, roundCurrency(discountAmount));
  if (discountAmount > cartSubtotal) {
    discountAmount = cartSubtotal;
  }

  if (discountAmount <= 0 && !freeDelivery) {
    throw makeError(
      400,
      "This coupon does not provide any discount on current cart",
    );
  }

  const couponSnapshot = buildCouponSnapshot(coupon, {
    cartSubtotal,
    discountAmount,
    freeDelivery,
  });

  return {
    coupon,
    discountAmount,
    freeDelivery,
    cartSubtotal,
    couponSnapshot,
  };
}

/**
 * Atomic, usage-limit-aware increment of `Coupon.usedCount`.
 *
 * Audit fix M-3: replaces the previous fire-and-forget
 * `.updateOne(...).catch(() => {})` that ran AFTER `commitTransaction`
 * with a guarded increment that runs INSIDE the order's transaction.
 * Returns `true` on increment, `false` if the limit was already
 * reached (caller decides whether to abort the order — the order
 * placement service currently treats overflow as a soft warning to
 * preserve booking flow, mirroring legacy semantics).
 *
 * Always pass a `session`. Without a session the operation falls back
 * to a best-effort write so callers outside a transaction still work.
 */
export async function incrementCouponUsage({ couponId, session = null } = {}) {
  if (!couponId) return false;
  const updateResult = await Coupon.updateOne(
    {
      _id: couponId,
      $or: [
        { usageLimit: { $exists: false } },
        { usageLimit: null },
        { $expr: { $lt: [{ $ifNull: ["$usedCount", 0] }, "$usageLimit"] } },
      ],
    },
    { $inc: { usedCount: 1 } },
    session ? { session } : undefined,
  );
  return Number(updateResult?.modifiedCount || 0) > 0;
}

export default {
  computeOrderDiscount,
  incrementCouponUsage,
};
