import crypto from "crypto";
import mongoose from "mongoose";
import Customer from "../../models/customer.js";
import MlmMembership from "../../models/mlmMembership.js";
import { MLM_MEMBERSHIP_STATUS } from "../../constants/mlm.js";
import { placeOrderAtomic } from "../orderPlacementService.js";
import { createPaymentOrderForOrderRef } from "../paymentService.js";
import { getMlmConfig } from "./mlmConfigService.js";
import logger from "../logger.js";

/**
 * mlmJoinService — one-click MLM joining flow.
 *
 * Wraps `placeOrderAtomic` (with hard-coded joining-package inputs) and
 * `createPaymentOrderForOrderRef` so the customer-facing surface is a
 * single "Join Now" button that returns a payment-gateway redirect URL.
 *
 * Money-flow discipline:
 *   - The Order is still the authoritative record. Refunds, clawbacks,
 *     finance ledger, admin/customer transaction history, and the MLM
 *     activation hook (`mlmActivationService.activatePlanAOnJoiningPackagePaid`)
 *     are all keyed off `Order._id`, so we MUST create one. This service
 *     does not bypass `placeOrderAtomic` — every wallet/ledger/coupon/
 *     stock primitive runs exactly as if the customer had checked out
 *     manually.
 *   - The webhook chain `paymentService.processPhonePeWebhook`
 *     → `handleOnlineOrderFinance` → `activatePlanAOnJoiningPackagePaid`
 *     fires unchanged on payment capture because the Order is stamped
 *     with `isJoiningPackageOrder: true` by `placeOrderAtomic` (it
 *     matches the cart item's productId against
 *     `Setting.mlm.joiningPackageProductId`).
 *
 * Inputs:
 *   - `userId` — the authenticated customer.
 *   - `idempotencyKey` — optional client-supplied key. Re-running with
 *     the same key returns the same order/payment (dedupe inherited
 *     from `placeOrderAtomic` + `createPaymentOrderForOrderRef`).
 *
 * Errors (all surface a `statusCode`):
 *   - 422 MLM_DISABLED                — admin has not enabled MLM.
 *   - 422 JOINING_PACKAGE_UNCONFIGURED — `Setting.mlm.joiningPackageProductId` is null.
 *   - 409 ALREADY_MEMBER              — caller already has an ACTIVE membership.
 *   - 422 ADDRESS_REQUIRED            — customer has no saved address; ask
 *                                       them to add one in Profile → Addresses.
 */
export async function initiateJoinPayment({ userId, idempotencyKey = null }) {
  if (!userId) {
    const err = new Error("Authentication required");
    err.statusCode = 401;
    throw err;
  }

  const cfg = await getMlmConfig();
  if (!cfg.enabled) {
    const err = new Error("Rewards program is not active yet. Please check back soon.");
    err.statusCode = 422;
    err.code = "MLM_DISABLED";
    throw err;
  }

  const joiningProductId = cfg.joiningPackageProductId
    ? String(cfg.joiningPackageProductId)
    : null;
  if (!joiningProductId) {
    const err = new Error(
      "Joining package is not configured. Please contact support.",
    );
    err.statusCode = 422;
    err.code = "JOINING_PACKAGE_UNCONFIGURED";
    throw err;
  }

  const existingMembership = await MlmMembership.findOne({ userId }).lean();
  if (
    existingMembership &&
    existingMembership.status === MLM_MEMBERSHIP_STATUS.ACTIVE
  ) {
    const err = new Error("You are already an MLM member.");
    err.statusCode = 409;
    err.code = "ALREADY_MEMBER";
    throw err;
  }

  // MLM joining is a subscription, not a physical purchase: no address
  // is collected, no rider is dispatched. We synthesise a minimal
  // address object so the underlying Order schema (which expects a
  // sub-document, though every inner field is optional) validates
  // cleanly. The Order is an internal accounting record only — it is
  // filtered out of the customer's Orders list by
  // `orderQueryService.getCustomerOrders` and never enters the rider
  // assignment flow because no seller-workflow runs for an ONLINE order
  // that has no fulfilment requirement.
  const customer = await Customer.findById(userId, {
    name: 1,
    phone: 1,
  }).lean();
  if (!customer) {
    const err = new Error("Customer profile not found.");
    err.statusCode = 404;
    throw err;
  }

  // Idempotency key strategy:
  //
  // The previous implementation used a per-(user, day) stable key
  // `mlm-join-{userId}-YYYY-MM-DD`. The intent was to let users who
  // abandoned the gateway redirect resume with the same Order on a later
  // click. In practice this poisoned the join flow whenever an earlier
  // attempt left a half-committed CheckoutGroup (CG written, Orders
  // missing) — the idempotency check returned `{ duplicate: true,
  // ordersCount: 0 }` and the user could never recover without DB
  // surgery.
  //
  // The mitigation that actually matters for "don't activate twice" is
  // the ACTIVE-membership pre-check above, which 409s if the customer
  // already joined. Multiple PENDING orders from rapid double-clicks are
  // a soft inefficiency the orderAutoCancelJob mops up, not a money-flow
  // hazard.
  //
  // So we mint a per-click key: stable enough for `placeOrderAtomic`'s
  // internal dedupe across the synchronous retries inside the same
  // request, but never matching a previous click's CG.
  const safeIdempotencyKey = idempotencyKey || buildClickIdempotencyKey(userId);

  const placementPayload = {
    items: [
      {
        product: joiningProductId,
        quantity: 1,
      },
    ],
    paymentMode: "ONLINE",
    address: {
      type: "Other",
      name: customer.name || "Member",
      phone: customer.phone || "",
      address: "MLM membership (digital subscription — no delivery)",
      city: "",
      landmark: "",
    },
    walletAmount: 0,
    discountTotal: 0,
    tipAmount: 0,
    timeSlot: "now",
  };

  let placementResult = await placeOrderAtomic({
    customerId: new mongoose.Types.ObjectId(String(userId)),
    payload: placementPayload,
    idempotencyKey: safeIdempotencyKey,
  });

  // Self-heal: if a stale CheckoutGroup with the same key exists without
  // any sibling Orders (the "poison" state described above), the dedupe
  // path returns `{ duplicate: true, orders: [] }`. Retry exactly once
  // with a freshly-minted key so the user is never stuck without a DB
  // intervention.
  const initialOrdersCount = Array.isArray(placementResult?.orders)
    ? placementResult.orders.length
    : 0;
  if (placementResult?.duplicate && initialOrdersCount === 0) {
    const recoveryKey = buildClickIdempotencyKey(userId);
    logger.warn("[mlmJoinService] stale dedupe hit, retrying with fresh key", {
      userId: String(userId),
      poisonCheckoutGroupId:
        placementResult?.checkoutGroup?.checkoutGroupId ||
        placementResult?.checkoutGroup?._id ||
        null,
      failedIdempotencyKey: safeIdempotencyKey,
      recoveryIdempotencyKey: recoveryKey,
    });
    placementResult = await placeOrderAtomic({
      customerId: new mongoose.Types.ObjectId(String(userId)),
      payload: placementPayload,
      idempotencyKey: recoveryKey,
    });
  }

  const order = placementResult?.order || placementResult?.orders?.[0];
  if (!order) {
    const diag = {
      userId: String(userId),
      joiningProductId,
      idempotencyKey: safeIdempotencyKey,
      duplicate: !!placementResult?.duplicate,
      checkoutGroupId:
        placementResult?.checkoutGroup?.checkoutGroupId ||
        placementResult?.checkoutGroup?._id ||
        null,
      ordersCount: Array.isArray(placementResult?.orders)
        ? placementResult.orders.length
        : 0,
      keys: placementResult ? Object.keys(placementResult) : null,
    };
    const err = new Error(
      `Failed to create joining-package order. diag=${JSON.stringify(diag)}`,
    );
    err.statusCode = 500;
    err.code = "JOINING_ORDER_PLACEMENT_FAILED";
    throw err;
  }

  // Belt-and-braces: this should always be true because `placeOrderAtomic`
  // stamps the flag when the cart item matches `Setting.mlm.joiningPackageProductId`.
  if (!order.isJoiningPackageOrder) {
    logger.error("[mlmJoinService] order missing isJoiningPackageOrder flag", {
      userId: String(userId),
      joiningProductId,
      orderId: order.orderId,
      orderItemsCount: Array.isArray(order.items) ? order.items.length : 0,
      itemProductIds: Array.isArray(order.items)
        ? order.items.map((it) => String(it?.product || ""))
        : [],
    });
    const err = new Error(
      "Order created but joining-package flag is missing; aborting payment init.",
    );
    err.statusCode = 500;
    err.code = "JOINING_FLAG_MISSING";
    throw err;
  }

  // Sub-key so repeated `Join Now` clicks within the same day reuse the
  // same Payment row (dedupe inherited from `createPaymentOrderForOrderRef`).
  const paymentIdempotencyKey = `${safeIdempotencyKey}-pay`;

  const paymentResult = await createPaymentOrderForOrderRef({
    orderRef: order._id,
    userId,
    idempotencyKey: paymentIdempotencyKey,
    correlationId: `mlm-join-${order._id}`,
  });

  return {
    orderId: String(order._id),
    publicOrderId: order.orderId,
    paymentId: paymentResult.payment?._id ? String(paymentResult.payment._id) : null,
    redirectUrl: paymentResult.redirectUrl,
    duplicate: !!paymentResult.duplicate,
  };
}

/** Stable, opaque idempotency key for a single click. Exposed for tests. */
export function buildClickIdempotencyKey(userId) {
  return `mlm-join-${userId}-${crypto.randomBytes(6).toString("hex")}`;
}
