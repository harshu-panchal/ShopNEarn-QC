import Order from "../models/order.js";
import handleResponse from "../utils/helper.js";
import {
  checkoutPreviewSchema,
  codMarkCollectedSchema,
  codReconcileSchema,
  createFinanceOrderSchema,
  deliveredSchema,
  verifyOnlinePaymentSchema,
} from "../validation/financeValidation.js";
import {
  handleCodOrderFinance,
  reconcileCodCash,
  settleDeliveredOrder,
} from "../services/finance/orderFinanceService.js";
import { placeOrderAtomic } from "../services/orderPlacementService.js";
import { orderMatchQueryFromRouteParam } from "../utils/orderLookup.js";
import { verifyClientPaymentCallback } from "../services/paymentService.js";
import { buildCheckoutPricingSnapshot } from "../services/checkoutPricingService.js";
import { validateBody as validateWithJoi } from "../middleware/validate.js";

export const previewCheckoutFinance = async (req, res) => {
  try {
    const payload = validateWithJoi(checkoutPreviewSchema, req.body || {});
    const pricingSnapshot = await buildCheckoutPricingSnapshot({
      orderItems: payload.items,
      address: payload.address,
      tipAmount: payload.tipAmount,
      discountTotal: payload.discountTotal || 0,
      // Audit Phase 4 (C-1): forward walletAmount so the preview's
      // aggregate breakdown exposes a `payableAmount` (post-wallet) the
      // frontend can render directly. No-op when client sends 0 or omits.
      walletAmount: payload.walletAmount || 0,
      // Audit Phase 5 (C-2 + H-6): forward couponCode/couponId so the
      // preview returns the server-validated discount (and `freeDelivery`
      // rebate) without trusting any client-supplied `discountTotal`.
      // The `customerId` is read from auth so per-user limits are
      // enforced consistently between preview and place-order — and
      // the preview can refuse a coupon the user has already exhausted.
      couponCode: payload.couponCode || null,
      couponId: payload.couponId || null,
      customerId: req.user?.id || null,
    });

    const sellerBreakdowns = pricingSnapshot.sellerBreakdownEntries.map((entry) => ({
      sellerId: entry.sellerId,
      distanceKm: entry.distanceKm,
      breakdown: entry.breakdown,
    }));

    const distanceDebug = String(process.env.FINANCE_DEBUG_DISTANCE || "").toLowerCase() === "true"
      ? sellerBreakdowns.map((item) => ({
          sellerId: item.sellerId,
          distanceKmDerived: item.distanceKm,
        }))
      : undefined;

    return handleResponse(res, 200, "Checkout preview generated", {
      paymentMode: payload.paymentMode,
      breakdown: pricingSnapshot.aggregateBreakdown,
      sellerCount: pricingSnapshot.sellerCount,
      itemCount: pricingSnapshot.itemCount,
      sellerBreakdowns,
      // Audit Phase 5: expose the resolved coupon snapshot so the
      // frontend can render "Coupon CODE applied — ₹X off" without
      // running its own math. `null` when no coupon was supplied or
      // SERVER_SIDE_COUPON_ENGINE is off.
      couponSnapshot: pricingSnapshot.couponSnapshot || null,
      freeDeliveryApplied: !!pricingSnapshot.freeDeliveryApplied,
      ...(distanceDebug ? { distanceDebug } : {}),
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const createOrderWithFinancialSnapshot = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return handleResponse(res, 401, "Unauthorized");
    }

    const validated = validateWithJoi(createFinanceOrderSchema, req.body || {});
    const payload = {
      items: validated.items,
      address: validated.address,
      paymentMode: validated.paymentMode,
      timeSlot: validated.timeSlot || "now",
      tipAmount: validated.tipAmount || 0,
      walletAmount: validated.walletAmount || 0,
      couponId: validated.couponId || null,
      // Audit Phase 5 (C-2 + H-7): forward couponCode so the placement
      // service can re-validate end-to-end. We deliberately DO NOT
      // forward `discountTotal`, `taxTotal`, or `pricing` from the
      // client — the controller has stripped those since Phase 4 to
      // prevent client-pricing tampering, and the new server-side
      // coupon engine fills the discount in via `couponCode`/`couponId`
      // instead.
      couponCode: validated.couponCode || null,
    };
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim() || null;

    const placement = await placeOrderAtomic({
      customerId,
      payload,
      idempotencyKey,
    });

    return handleResponse(
      res,
      placement.duplicate ? 200 : 201,
      placement.duplicate
        ? "Duplicate request resolved using existing order"
        : "Order created with financial snapshot",
      {
        order: placement.order,
        orders: placement.orders,
        checkoutGroup: placement.checkoutGroup,
        paymentRef:
          (Array.isArray(placement.orders) && placement.orders.length > 1
            ? placement.checkoutGroup?.checkoutGroupId
            : placement.order?.orderId) ||
          placement.checkoutGroup?.checkoutGroupId ||
          null,
      },
    );
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const verifyOnlineOrderPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = validateWithJoi(verifyOnlinePaymentSchema, req.body || {});
    const verification = await verifyClientPaymentCallback({
      orderRef: id,
      userId: req.user?.id,
      gatewayOrderId: payload.merchantOrderId,
      gatewayPaymentId: payload.transactionId || null,
      correlationId: req.correlationId || null,
    });

    return handleResponse(res, 200, "Online payment verification processed", {
      paymentStatus: verification.status,
      publicOrderId: verification.payment.publicOrderId,
      merchantOrderId: verification.payment.gatewayOrderId,
      transactionId: verification.payment.gatewayPaymentId,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const markCodCollectedAfterDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = validateWithJoi(codMarkCollectedSchema, req.body || {});
    const orderKey = orderMatchQueryFromRouteParam(id);
    if (!orderKey) {
      return handleResponse(res, 404, "Order not found");
    }
    const order = await Order.findOne(orderKey)
      .select("_id deliveryBoy seller status orderStatus paymentMode financeFlags")
      .lean();
    if (!order) {
      return handleResponse(res, 404, "Order not found");
    }

    if (order.paymentMode === "ONLINE") {
      return handleResponse(res, 400, "COD collection is only allowed for COD orders");
    }

    const isDelivered =
      order.status === "delivered" || order.orderStatus === "delivered";
    if (!isDelivered) {
      return handleResponse(res, 400, "COD collection is allowed only after delivery");
    }

    if (
      req.user?.role === "delivery" &&
      order.deliveryBoy &&
      String(order.deliveryBoy) !== String(req.user.id)
    ) {
      return handleResponse(res, 403, "Only assigned delivery partner can mark COD collection");
    }

    const deliveryPartnerId =
      payload.deliveryPartnerId ||
      order.deliveryBoy ||
      (req.user?.role === "delivery" ? req.user.id : null);

    if (order.financeFlags?.codMarkedCollected) {
      return handleResponse(res, 200, "COD amount already marked as collected", order);
    }

    const updated = await handleCodOrderFinance(order._id, {
      amount: payload.amount,
      deliveryPartnerId,
      actorId: req.user?.id || null,
    });

    return handleResponse(res, 200, "COD amount marked as collected", updated);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const markOrderDeliveredAndSettle = async (req, res) => {
  try {
    const { id } = req.params;
    validateWithJoi(deliveredSchema, req.body || {});
    const orderKey = orderMatchQueryFromRouteParam(id);
    if (!orderKey) {
      return handleResponse(res, 404, "Order not found");
    }
    const order = await Order.findOne(orderKey).select("_id deliveryBoy seller").lean();
    if (!order) {
      return handleResponse(res, 404, "Order not found");
    }

    if (
      req.user?.role === "delivery" &&
      order.deliveryBoy &&
      String(order.deliveryBoy) !== String(req.user.id)
    ) {
      return handleResponse(res, 403, "Only assigned delivery partner can mark this order delivered");
    }
    if (
      req.user?.role === "seller" &&
      order.seller &&
      String(order.seller) !== String(req.user.id)
    ) {
      return handleResponse(res, 403, "Only order seller can mark this order delivered");
    }

    const updated = await settleDeliveredOrder(order._id, {
      actorId: req.user?.id || null,
    });

    // For COD orders, "delivery" implies cash is collected by the assigned delivery partner.
    // This updates System Float (COD) as: grandTotal - riderPayoutTotal.
    if (
      updated?.paymentMode === "COD" &&
      updated?.deliveryBoy &&
      !updated?.financeFlags?.codMarkedCollected
    ) {
      const deliveryPartnerId = updated.deliveryBoy;
      const updatedWithCod = await handleCodOrderFinance(updated._id, {
        deliveryPartnerId,
        actorId: req.user?.id || null,
      });
      return handleResponse(res, 200, "Order delivered and COD cash collected", updatedWithCod);
    }

    return handleResponse(res, 200, "Order delivered and settlement queued", updated);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const reconcileCodCashSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = validateWithJoi(codReconcileSchema, req.body || {});
    const orderKey = orderMatchQueryFromRouteParam(id);
    if (!orderKey) {
      return handleResponse(res, 404, "Order not found");
    }
    const order = await Order.findOne(orderKey).select("_id deliveryBoy").lean();
    if (!order) {
      return handleResponse(res, 404, "Order not found");
    }

    if (
      req.user?.role === "delivery" &&
      order.deliveryBoy &&
      String(order.deliveryBoy) !== String(req.user.id)
    ) {
      return handleResponse(res, 403, "Only assigned delivery partner can reconcile COD cash");
    }

    const deliveryPartnerId =
      payload.deliveryPartnerId ||
      order.deliveryBoy ||
      (req.user?.role === "delivery" ? req.user.id : null);

    const updated = await reconcileCodCash(
      order._id,
      payload.amount,
      deliveryPartnerId,
      {
        actorId: req.user?.id || null,
        metadata: payload.metadata || {},
      },
    );

    return handleResponse(res, 200, "COD cash reconciled successfully", updated);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
