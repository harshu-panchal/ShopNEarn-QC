import mongoose from "mongoose";
import Cart from "../models/cart.js";
import CheckoutGroup from "../models/checkoutGroup.js";
import Order from "../models/order.js";
import User from "../models/customer.js";
import Transaction from "../models/transaction.js";
import Coupon from "../models/coupon.js";
import { WORKFLOW_STATUS, DEFAULT_SELLER_TIMEOUT_MS } from "../constants/orderWorkflow.js";
import {
  LEDGER_DIRECTION,
  LEDGER_TRANSACTION_TYPE,
  ORDER_PAYMENT_STATUS,
  OWNER_TYPE,
  isWalletRedemptionReducesPayableEnabled,
  isServerSideCouponEngineEnabled,
} from "../constants/finance.js";
import { incrementCouponUsage } from "./finance/couponService.js";
import { freezeFinancialSnapshot } from "./finance/orderFinanceService.js";
import {
  creditWallet,
  debitWallet,
  debitCustomerSpendableBuckets,
  debitCustomerWalletBucket,
  getCustomerBalance,
  getCustomerSpendableBuckets,
  getOrCreateWallet,
} from "./finance/walletService.js";
import { createLedgerEntry } from "./finance/ledgerService.js";
import { roundCurrency } from "../utils/money.js";
import LedgerEntry from "../models/ledgerEntry.js";
import {
  generateUniqueCheckoutGroupId,
  generateUniquePublicOrderId,
} from "./orderIdService.js";
import { afterPlaceOrderV2 } from "./orderWorkflowService.js";
import {
  computeStockReservationWindow,
  reserveStockForItems,
} from "./stockService.js";
import { isLowStockAlertsEnabled } from "./lowStockAlertService.js";
import {
  checkIdempotency,
  acquireIdempotencyLock,
  storeIdempotencyResult,
  storeIdempotencyError,
  releaseIdempotencyLock,
  isRetryableError,
  validateIdempotencyKey,
} from "./idempotencyService.js";
import { buildCheckoutPricingSnapshot } from "./checkoutPricingService.js";
import { getMlmConfig } from "./mlm/mlmConfigService.js";
import {
  resolveFranchiseOrderRouting,
} from "./franchise/franchiseOrderRoutingService.js";
import { notifyFranchisePartnerNewOrder } from "./franchise/franchiseOrderService.js";
import { normalizeAddressForFranchiseRouting } from "./franchise/franchiseAddressUtils.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";
import * as logger from "./logger.js";

const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

function normalizePaymentMode(raw) {
  const mode = String(raw || "COD").trim().toUpperCase();
  return mode === "ONLINE" ? "ONLINE" : "COD";
}

// Full-wallet checkout tender. Returns "shopping" | "earnings" | null.
function normalizeWalletSource(raw) {
  const source = String(raw || "").trim().toLowerCase();
  return source === "shopping" || source === "earnings" ? source : null;
}

function normalizeAddress(address = {}) {
  const normalized = normalizeAddressForFranchiseRouting(address || {});
  if (address?.location) {
    const lat = Number(address.location.lat);
    const lng = Number(address.location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      delete normalized.location;
    } else {
      normalized.location = { lat, lng };
    }
  }
  return normalized;
}

function mapOrderItemsForPersistence(hydratedItems = []) {
  return hydratedItems.map((item) => ({
    product: item.productId,
    name: item.productName,
    quantity: item.quantity,
    price: item.price,
    variantSlot: String(item.variantSku || item.variantSlot || "").trim() || undefined,
    image: item.image || "",
  }));
}

function placementSource(payload = {}) {
  return Array.isArray(payload.items) && payload.items.length > 0
    ? "DIRECT_ITEMS"
    : "CART";
}

function toPlain(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === "function") return doc.toObject();
  return doc;
}

function buildResultPayload({ checkoutGroup, orders }) {
  const plainGroup = toPlain(checkoutGroup);
  const plainOrders = Array.isArray(orders) ? orders.map((item) => toPlain(item)) : [];
  return {
    checkoutGroup: plainGroup,
    orders: plainOrders,
    order: plainOrders[0] || null,
  };
}

async function findExistingCheckoutByIdempotency(customerId, idempotencyKey) {
  if (!idempotencyKey) return null;

  const checkoutGroup = await CheckoutGroup.findOne({
    customer: customerId,
    "placement.idempotencyKey": idempotencyKey,
  }).lean();
  if (checkoutGroup) {
    const orders = await Order.find({
      checkoutGroupId: checkoutGroup.checkoutGroupId,
    })
      .sort({ checkoutGroupIndex: 1, createdAt: 1 })
      .lean();
    return { checkoutGroup, orders };
  }

  const legacyOrder = await Order.findOne({
    customer: customerId,
    "placement.idempotencyKey": idempotencyKey,
  }).lean();
  if (!legacyOrder) return null;
  return {
    checkoutGroup: null,
    orders: [legacyOrder],
  };
}

async function resolveOrderItemsInput({
  payload,
  customerId,
  session,
}) {
  let orderItemsInput = Array.isArray(payload.items) ? payload.items.filter(Boolean) : [];
  if (orderItemsInput.length > 0) {
    return {
      orderItemsInput,
      source: "DIRECT_ITEMS",
      cartDocument: null,
    };
  }

  const cart = await Cart.findOne({ customerId }, null, { session });
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    const err = new Error("Cannot place order with empty cart");
    err.statusCode = 400;
    throw err;
  }

  orderItemsInput = cart.items.map((item) => ({
    product: item.productId,
    variantSku: String(item.variantSku || "").trim(),
    quantity: item.quantity,
  }));
  return {
    orderItemsInput,
    source: "CART",
    cartDocument: cart,
  };
}

async function consumeCartItems({
  customerId,
  source,
  orderItemsInput,
  session,
  cartDocument = null,
}) {
  if (source === "CART") {
    const cart = cartDocument || (await Cart.findOne({ customerId }, null, { session }));
    if (!cart) return;
    cart.items = [];
    await cart.save({ session });
    return;
  }

  const cart = cartDocument || (await Cart.findOne({ customerId }, null, { session }));
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    return;
  }

  const requestedQtyByLineKey = new Map();
  for (const item of orderItemsInput || []) {
    const productId = String(item.product || item.productId || "");
    if (!productId) continue;
    const variantSku = String(item.variantSku || item.variantSlot || "").trim();
    const quantity = Math.max(Number(item.quantity || 0), 0);
    if (!quantity) continue;
    const key = `${productId}::${variantSku || ""}`;
    requestedQtyByLineKey.set(key, (requestedQtyByLineKey.get(key) || 0) + quantity);
  }

  const remaining = [];
  for (const cartItem of cart.items) {
    const productId = String(cartItem.productId);
    const variantSku = String(cartItem.variantSku || "").trim();
    const key = `${productId}::${variantSku || ""}`;
    const requested = requestedQtyByLineKey.get(key) || 0;
    if (requested <= 0) {
      remaining.push(cartItem);
      continue;
    }
    const quantityLeft = Number(cartItem.quantity || 0) - requested;
    if (quantityLeft > 0) {
      remaining.push({
        productId: cartItem.productId,
        variantSku,
        quantity: quantityLeft,
      });
    }
    requestedQtyByLineKey.delete(key);
  }

  cart.items = remaining;
  await cart.save({ session });
}

function buildCheckoutGroupStatus(paymentMode) {
  return paymentMode === "ONLINE" ? "PAYMENT_PENDING" : "CREATED";
}

/**
 * Audit Phase 4 (H-5) — lazy-seed of canonical customer Wallet from the
 * legacy `User.walletBalance` so the H-5 debit path works for customers
 * whose Wallet doc never received a credit (legacy customers from before
 * Phase 4 P4-3 dual-write).
 *
 * The seed:
 *   - Reads `Wallet.availableBalance` and `User.walletBalance` inside the
 *     same session that the checkout uses.
 *   - If `User.walletBalance > Wallet.availableBalance`, credits the gap
 *     into the canonical Wallet (no User-side mirror because the User row
 *     already has the higher value).
 *   - Writes a `LedgerEntry({type: ADJUSTMENT})` with a stable
 *     `idempotencyKey = WLT-SEED-<userId>` so re-runs across checkouts
 *     are safe — the partial unique index on `LedgerEntry.idempotencyKey`
 *     guarantees the seed happens at most once per customer.
 *
 * Safe to call when:
 *   - `Wallet.availableBalance >= User.walletBalance` (returns 0; no-op).
 *   - `User.walletBalance === 0` (returns 0; no-op).
 *   - `walletAmount` is 0 at the call site (caller should still skip; this
 *     function does not check).
 */
async function seedCanonicalCustomerWalletFromUser({ customerId, user, session }) {
  if (!customerId) return 0;
  const seedIdempotencyKey = `WLT-SEED-${String(customerId)}`;

  // Idempotency pre-check: if the seed has already fired for this customer
  // we MUST NOT call `creditWallet` again, because creditWallet saves the
  // wallet BEFORE attempting the ledger insert and would double-credit if
  // the ledger then collides on the partial unique index. The pre-check
  // makes the helper safe to call on every checkout.
  const existingSeed = await LedgerEntry.findOne(
    { idempotencyKey: seedIdempotencyKey },
    { _id: 1 },
    { session },
  );
  if (existingSeed) return 0;

  const wallet = await getOrCreateWallet(OWNER_TYPE.CUSTOMER, customerId, { session });
  const userBalance = roundCurrency(user?.walletBalance || 0);
  const walletBalance = roundCurrency(wallet.availableBalance || 0);
  const gap = roundCurrency(userBalance - walletBalance);
  if (gap <= 0) return 0;

  await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: customerId,
    amount: gap,
    bucket: "available",
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,
    ledgerReference: seedIdempotencyKey,
    ledgerDescription: "Lazy seed of canonical Wallet from legacy User.walletBalance",
    idempotencyKey: seedIdempotencyKey,
    metadata: { reason: "legacy_user_walletbalance_seed" },
    // The User row is already correct — do not double-credit it.
    syncUserWalletBalance: false,
  });
  return gap;
}

function buildCheckoutGroupPaymentStatus(paymentMode) {
  return paymentMode === "ONLINE"
    ? ORDER_PAYMENT_STATUS.CREATED
    : ORDER_PAYMENT_STATUS.PENDING_CASH_COLLECTION;
}

export async function placeOrderAtomic({
  customerId,
  payload,
  idempotencyKey = null,
  retryCount = 0,
}) {
  const normalizedPayload = {
    ...(payload || {}),
    paymentMode: normalizePaymentMode(payload?.paymentMode),
  };

  if (idempotencyKey) {
    if (!validateIdempotencyKey(idempotencyKey)) {
      const error = new Error("Invalid idempotency key format");
      error.statusCode = 400;
      throw error;
    }

    const idempotencyCheck = await checkIdempotency(idempotencyKey, normalizedPayload);
    if (idempotencyCheck.exists && !idempotencyCheck.checksumMismatch) {
      if (idempotencyCheck.result.status === "error") {
        const error = new Error(idempotencyCheck.result.error.message);
        error.statusCode = idempotencyCheck.result.error.statusCode || 500;
        throw error;
      }
      return {
        ...idempotencyCheck.result.data,
        duplicate: true,
      };
    }
    if (idempotencyCheck.checksumMismatch) {
      const error = new Error("Idempotency key reused with different payload");
      error.statusCode = 422;
      throw error;
    }
    if (idempotencyCheck.inProgress) {
      const error = new Error("Request is being processed");
      error.statusCode = 409;
      throw error;
    }

    const lockAcquired = await acquireIdempotencyLock(idempotencyKey);
    if (!lockAcquired) {
      const error = new Error("Request is being processed");
      error.statusCode = 409;
      throw error;
    }
  }

  const existingByIdempotency = await findExistingCheckoutByIdempotency(customerId, idempotencyKey);
  if (existingByIdempotency) {
    const existingResult = buildResultPayload({
      checkoutGroup: existingByIdempotency.checkoutGroup,
      orders: existingByIdempotency.orders,
    });
    if (idempotencyKey) {
      await storeIdempotencyResult(idempotencyKey, existingResult, normalizedPayload);
    }
    return { ...existingResult, duplicate: true };
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      maxCommitTimeMS: parseInt(process.env.CHECKOUT_TRANSACTION_TIMEOUT_MS || "20000", 10),
    });

    const rawPaymentMode = normalizePaymentMode(normalizedPayload.paymentMode);
    // Full-wallet tender: "shopping" | "earnings" | null. When set, the
    // whole order is paid from that customer wallet bucket and booked as a
    // prepaid ONLINE order (no gateway, no COD).
    const walletSource = normalizeWalletSource(normalizedPayload.walletSource);
    const isWalletPrepaid = !!walletSource;
    // The order SETTLES like a prepaid ONLINE order (no cash collection at
    // delivery) but its STOCK + seller-review workflow behave like a COD
    // order (stock committed immediately, seller notified right away —
    // there is no gateway round-trip to wait for).
    const paymentMode = isWalletPrepaid ? "ONLINE" : rawPaymentMode;
    const workflowPaymentMode = isWalletPrepaid ? "COD" : rawPaymentMode;
    const normalizedAddress = normalizeAddress(normalizedPayload.address);
    const idempotencyKeyExpiry = idempotencyKey
      ? new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS)
      : null;
    const source = placementSource(normalizedPayload);
    // Generic partial wallet redemption (reduces payable on online/COD) is
    // mutually exclusive with the full-wallet tender path — ignore any
    // walletAmount the client sent alongside a walletSource.
    const walletAmount = isWalletPrepaid
      ? 0
      : Math.max(0, Number(normalizedPayload.walletAmount || 0));
    const tipAmount = Math.max(0, Number(normalizedPayload.tipAmount || 0));

    // 1. Fetch user and validate wallet
    // Audit Phase 4 (M-4): read the canonical wallet balance (Wallet first,
    // User.walletBalance fallback) so customers whose canonical wallet was
    // credited via `walletService.creditWallet` but whose User mirror is
    // stale can still redeem. `getCustomerBalance` is a no-throw helper —
    // we still need `user` further down for the legacy direct-debit path,
    // so we fetch both.
    const user = await User.findById(customerId).session(session);
    if (walletAmount > 0) {
      if (!user) throw new Error("User not found");
      // MLM Phase 1: a customer's spendable wallet now spans three
      // buckets (shopping + earnings + available). The precheck must
      // sum all three so that joining-package recipients can actually
      // spend their shopping credit even if `availableBalance` is 0.
      const buckets = await getCustomerSpendableBuckets(customerId, { session });
      if (buckets.totalSpendable < walletAmount) {
        throw new Error("Insufficient wallet balance");
      }
    }

    const {
      orderItemsInput,
      source: resolvedSource,
      cartDocument,
    } = await resolveOrderItemsInput({
      payload: normalizedPayload,
      customerId,
      session,
    });

    // Audit Phase 4 (C-1): when WALLET_REDEMPTION_REDUCES_PAYABLE is on,
    // pass walletAmount through to the snapshot so the per-seller
    // grandTotal is reduced proportionately. When the flag is off the
    // snapshot ignores it (`grandTotal` stays at the pre-wallet value)
    // and the legacy direct-debit path below preserves bit-for-bit
    // current behaviour.
    //
    // Audit Phase 5 (C-2 + H-6 + H-7): when SERVER_SIDE_COUPON_ENGINE is
    // on, pass couponCode/couponId/customerId so the snapshot ignores
    // the client-supplied `discountTotal` and recomputes the discount
    // from the server-hydrated cart, applying free-delivery rebates
    // server-side. When the flag is off, only `discountTotal` flows
    // through — preserving legacy bit-for-bit behaviour.
    const pricingSnapshot = await buildCheckoutPricingSnapshot({
      orderItems: orderItemsInput,
      address: normalizedAddress,
      tipAmount,
      discountTotal: Math.max(0, Number(normalizedPayload.discountTotal || 0)),
      walletAmount,
      couponCode: normalizedPayload.couponCode || null,
      couponId: normalizedPayload.couponId || null,
      customerId,
      session,
    });

    // Full-wallet tender precheck: the chosen bucket alone must cover the
    // ENTIRE order (this is a full-payment-only option). Fail fast before
    // any stock is reserved or orders are created.
    const walletTenderTotal = isWalletPrepaid
      ? roundCurrency(pricingSnapshot.aggregateBreakdown?.grandTotal || 0)
      : 0;
    if (isWalletPrepaid) {
      if (walletTenderTotal <= 0) {
        throw new Error("Cannot pay a zero-value order with wallet");
      }

      const buckets = await getCustomerSpendableBuckets(customerId, { session });
      const bucketBalance =
        walletSource === "shopping"
          ? buckets.shoppingBalance
          : buckets.earningsBalance;
      if (bucketBalance < walletTenderTotal) {
        const label = walletSource === "earnings" ? "earning" : "shopping";
        const err = new Error(`Insufficient ${label} wallet balance`);
        err.statusCode = 422;
        err.code = "INSUFFICIENT_WALLET_BUCKET";
        throw err;
      }
    }

    const { franchisePartner, fields: franchiseFields } = await resolveFranchiseOrderRouting({
      hydratedItems: pricingSnapshot.hydratedItems,
      address: normalizedAddress,
      customerId,
    });
    const isFranchiseRoutedOrder = !!franchiseFields.franchisePartnerId;
    const awaitingGatewayPayment = paymentMode === "ONLINE" && !isWalletPrepaid;

    const checkoutGroupId = await generateUniqueCheckoutGroupId({ session });
    // Stock commits immediately for wallet-prepaid orders (workflow mode
    // COD), even though they settle as ONLINE.
    const checkoutReservation = computeStockReservationWindow(workflowPaymentMode);
    const checkoutGroup = new CheckoutGroup({
      checkoutGroupId,
      customer: customerId,
      paymentMode,
      paymentStatus: isWalletPrepaid
        ? ORDER_PAYMENT_STATUS.PAID
        : buildCheckoutGroupPaymentStatus(paymentMode),
      status: isWalletPrepaid
        ? "CREATED"
        : buildCheckoutGroupStatus(paymentMode),
      stockReservation: checkoutReservation,
      pricingSummary: pricingSnapshot.aggregateBreakdown,
      walletAmount,
      sellerCount: pricingSnapshot.sellerCount,
      itemCount: pricingSnapshot.itemCount,
      addressSnapshot: normalizedAddress,
      placement: {
        idempotencyKey: idempotencyKey || undefined,
        idempotencyKeyExpiry,
        createdFrom: resolvedSource || source,
      },
      expiresAt: checkoutReservation.expiresAt || null,
      metadata: {
        timeSlot: normalizedPayload.timeSlot || "now",
        tipAmount,
      },
      franchisePartnerId: franchiseFields.franchisePartnerId || null,
    });
    await checkoutGroup.save({ session });

    const orders = [];
    const pendingLowStockAlerts = [];
    const sellerTimeoutMs = DEFAULT_SELLER_TIMEOUT_MS();
    const shouldStartSellerWorkflow =
      workflowPaymentMode === "COD" && !isFranchiseRoutedOrder;

    // MLM: detect Plan B exclusive home-shopping orders by matching
    // cart items against the admin-configured Product ID. The flag
    // drives the commission disbursement hooks downstream.
    //
    // Joining-package purchases are NOT modelled as Orders any more —
    // they live in the dedicated `MlmJoiningPayment` collection routed
    // through `mlmJoiningPaymentService`.
    const mlmCfg = await getMlmConfig();
    const homeShoppingProductId = mlmCfg.homeShoppingProductId ? String(mlmCfg.homeShoppingProductId) : null;
    function detectOrderKind(orderItems) {
      if (!Array.isArray(orderItems) || orderItems.length === 0 || !homeShoppingProductId) {
        return { isHomeShoppingOrder: false };
      }
      // EVERY item in this order must be the configured home-shopping
      // product — matches the sibling `isDigitalOnlyMlmCart` check in
      // checkoutPricingService.js. Any-item matching would let a
      // customer pad the same order with unrelated products from the
      // same seller and still have the FULL order total (not just the
      // home-shopping item's price) count toward the 10/5/2% home
      // shopping commissions.
      const isHome = orderItems.every((item) => {
        const productId = item?.product ? String(item.product) : null;
        return productId === homeShoppingProductId;
      });
      return { isHomeShoppingOrder: isHome };
    }

    for (let index = 0; index < pricingSnapshot.sellerBreakdownEntries.length; index += 1) {
      const entry = pricingSnapshot.sellerBreakdownEntries[index];
      const orderId = await generateUniquePublicOrderId({ session });
      const orderReservation = computeStockReservationWindow(workflowPaymentMode);
      const sellerPendingUntil = shouldStartSellerWorkflow
        ? new Date(Date.now() + sellerTimeoutMs)
        : null;
      const orderExpiresAt = orderReservation.expiresAt || sellerPendingUntil || null;

      const sellerLowStockAlerts = await reserveStockForItems({
        items: entry.items,
        sellerId: entry.sellerId,
        orderId,
        session,
        paymentMode: workflowPaymentMode,
      });
      if (Array.isArray(sellerLowStockAlerts) && sellerLowStockAlerts.length > 0) {
        pendingLowStockAlerts.push(...sellerLowStockAlerts);
      }

      // Audit Phase 4 (C-1): per-seller wallet allocation is now produced
      // by `buildCheckoutPricingSnapshot` (post-tip, post-handling) so we
      // can read it directly. Falling back to the old proportionate
      // formula keeps backwards compat in case the snapshot omits the
      // field for an exotic call path.
      const breakdownWalletAmount = Number(entry.breakdown?.walletAmount || 0);
      const orderGrandTotal = Number(entry.breakdown?.grandTotal || 0);
      const groupGrandTotal = Number(pricingSnapshot.aggregateBreakdown?.grandTotal || 1);
      const proportionateWallet = breakdownWalletAmount > 0
        ? breakdownWalletAmount
        : (orderGrandTotal / groupGrandTotal) * walletAmount;

      // Audit Phase 5 (C-2 + C-4): persist the canonical coupon ref +
      // frozen rule snapshot on every order in the checkout. Per-user
      // usage counts in `couponService.computeOrderDiscount` use
      // `Order.coupon` to count real usages instead of the legacy
      // hard-coded zero. Only populated when SERVER_SIDE_COUPON_ENGINE
      // is on AND a coupon was validated — otherwise both fields stay
      // null so historical/off-flag orders are unaffected.
      const persistedCouponId = pricingSnapshot.couponSnapshot?.couponId || null;
      const persistedCouponSnapshot = pricingSnapshot.couponSnapshot || undefined;

      const orderItemsForKindCheck = mapOrderItemsForPersistence(entry.items);
      const orderKind = detectOrderKind(orderItemsForKindCheck);

      const order = new Order({
        orderId,
        customer: customerId,
        seller: entry.sellerId,
        items: orderItemsForKindCheck,
        address: normalizedAddress,
        // MLM Phase 2+: tag consumed by settleDeliveredOrder to fire
        // home-shopping bonus chains.
        isHomeShoppingOrder: orderKind.isHomeShoppingOrder,
        paymentMode,
        // Wallet-prepaid orders are captured synchronously in the wallet
        // block below; they start CREATED and are flipped to PAID there.
        paymentStatus:
          paymentMode === "ONLINE"
            ? ORDER_PAYMENT_STATUS.CREATED
            : ORDER_PAYMENT_STATUS.PENDING_CASH_COLLECTION,
        payment: {
          method: isWalletPrepaid
            ? "wallet"
            : paymentMode === "ONLINE"
              ? "online"
              : "cash",
          status: "pending",
        },
        pricing: {
          ...entry.breakdown, // This might overwrite fields, be careful
          tip: entry.breakdown.tipTotal,
          total: entry.breakdown.grandTotal,
          walletAmount: proportionateWallet,
        },
        coupon: persistedCouponId,
        ...(persistedCouponSnapshot ? { couponSnapshot: persistedCouponSnapshot } : {}),
        status: "pending",
        orderStatus: "pending",
        timeSlot: normalizedPayload.timeSlot || "now",
        workflowVersion: 2,
        workflowStatus: isFranchiseRoutedOrder
          ? awaitingGatewayPayment
            ? WORKFLOW_STATUS.CREATED
            : WORKFLOW_STATUS.FRANCHISE_PENDING
          : shouldStartSellerWorkflow
            ? WORKFLOW_STATUS.SELLER_PENDING
            : WORKFLOW_STATUS.CREATED,
        sellerPendingExpiresAt: sellerPendingUntil,
        expiresAt: orderExpiresAt,
        stockReservation: orderReservation,
        checkoutGroupId,
        checkoutGroupSize: pricingSnapshot.sellerCount,
        checkoutGroupIndex: index,
        placement: {
          idempotencyKey: idempotencyKey || undefined,
          idempotencyKeyExpiry,
          createdFrom: resolvedSource || source,
        },
        settlementStatus: {
          overall: "PENDING",
          sellerPayout: "PENDING",
          riderPayout: "PENDING",
          adminEarningCredited: false,
        },
        ...franchiseFields,
        ...(isFranchiseRoutedOrder && awaitingGatewayPayment
          ? { franchiseStatus: null }
          : {}),
      });

      freezeFinancialSnapshot(order, entry.breakdown);
      await order.save({ session });
      orders.push(order);
    }

    checkoutGroup.orderIds = orders.map((order) => order._id);
    checkoutGroup.publicOrderIds = orders.map((order) => order.orderId);
    checkoutGroup.sellerBreakdown = orders.map((order, index) => ({
      seller: order.seller,
      order: order._id,
      publicOrderId: order.orderId,
      itemCount: order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      subtotal: Number(order.paymentBreakdown?.productSubtotal || 0),
      sellerPayout: Number(order.paymentBreakdown?.sellerPayoutTotal || 0),
      riderTipAmount: Number(order.paymentBreakdown?.riderTipAmount || 0),
      adminCommission: Number(order.paymentBreakdown?.adminProductCommissionTotal || 0),
      grandTotal: Number(order.paymentBreakdown?.grandTotal || 0),
    }));
    await checkoutGroup.save({ session });

    // ─── Full-wallet tender capture (Shopping Wallet / Earning Wallet) ───
    //
    // The customer pays the ENTIRE order from a single wallet bucket. We
    // model this as a prepaid ONLINE order: the customer's chosen bucket is
    // debited and the ADMIN wallet is credited the same amount (a wallet
    // → admin transfer, exactly what an online gateway capture does — see
    // handleOnlineOrderFinance). The order is then marked PAID + captured
    // so delivery collects no cash and settlement pays the seller/rider
    // from the admin float just like any other paid order. Everything runs
    // inside the placement transaction so the debit and the orders are
    // atomic (no "money taken but order not created" window).
    if (isWalletPrepaid) {
      const drain = await debitCustomerWalletBucket({
        customerId,
        bucket: walletSource,
        totalAmount: walletTenderTotal,
        session,
        ledgerReference: `WLT-CHOUT-${checkoutGroupId}`,
        ledgerDescription: `${walletSource === "earnings" ? "Earning" : "Shopping"} wallet payment at checkout`,
        idempotencyKey: `WLT-CHOUT-${checkoutGroupId}`,
        metadata: { checkoutGroupId, walletSource },
      });

      for (const order of orders) {
        const gt = roundCurrency(
          order.paymentBreakdown?.grandTotal || order.pricing?.total || 0,
        );
        if (gt > 0) {
          const credit = await creditWallet({
            ownerType: OWNER_TYPE.ADMIN,
            ownerId: null,
            amount: gt,
            bucket: "available",
            session,
          });
          await createLedgerEntry(
            {
              orderId: order._id,
              walletId: credit.wallet._id,
              actorType: OWNER_TYPE.ADMIN,
              actorId: null,
              type: LEDGER_TRANSACTION_TYPE.ORDER_ONLINE_PAYMENT_CAPTURED,
              direction: LEDGER_DIRECTION.CREDIT,
              amount: gt,
              paymentMode: "ONLINE",
              metadata: { walletSource, checkoutGroupId },
              description: `${walletSource === "earnings" ? "Earning" : "Shopping"} wallet payment captured from customer`,
              reference: order.orderId,
              balanceBefore: credit.before,
              balanceAfter: credit.after,
            },
            { session },
          );
        }

        order.paymentStatus = ORDER_PAYMENT_STATUS.PAID;
        order.payment = {
          ...(order.payment || {}),
          method: "wallet",
          status: "completed",
        };
        order.financeFlags = {
          ...(order.financeFlags || {}),
          onlinePaymentCaptured: true,
        };
        order.stockReservation = {
          ...(order.stockReservation || {}),
          status: "COMMITTED",
        };
        // Record the tender on the canonical breakdown so every refund /
        // cancellation path returns the money to the SAME source bucket
        // (reverseOrderFinanceOnCancellation + orderReturnService read
        // paymentBreakdown.walletSplit / walletAmount).
        order.paymentBreakdown = order.paymentBreakdown || {};
        order.paymentBreakdown.walletAmount = gt;
        order.paymentBreakdown.walletSplit = {
          shopping: walletSource === "shopping" ? gt : 0,
          earnings: walletSource === "earnings" ? gt : 0,
          available: 0,
        };
        order.pricing = order.pricing || {};
        order.pricing.walletAmount = gt;
        await order.save({ session });
      }

      // Legacy Transaction row for admin/seller dashboards (mirrors the
      // partial-redemption path below).
      await Transaction.create(
        [
          {
            user: customerId,
            userModel: "User",
            type: "Wallet Payment",
            amount: -walletTenderTotal,
            status: "Settled",
            reference: `WLT-CHOUT-${checkoutGroupId}`,
            meta: { checkoutGroupId, walletSource, walletSplit: drain.split },
          },
        ],
        { session },
      );
    }

    // Deduct wallet balance if used.
    //
    // Audit Phase 4 (C-1 + H-5):
    //   - When the flag is on, the wallet debit routes through
    //     `walletService.debitWallet`. That helper writes a `LedgerEntry`
    //     (type: WALLET_PAYMENT) inside the same session, debits the
    //     canonical `Wallet({ownerType:"CUSTOMER"})` row, and mirrors the
    //     delta into `User.walletBalance` via `$inc`. The legacy
    //     `Transaction({type:"Wallet Payment"})` row is still written for
    //     backward-compat with admin dashboards that still consume the
    //     legacy collection (the collection deprecation is a later phase).
    //   - For legacy customers whose `Wallet.availableBalance` is below
    //     `User.walletBalance` (their wallet was credited only on the User
    //     side before Phase 4 P4-3 dual-write landed), we lazy-seed the
    //     canonical Wallet up to the User value inside the same session
    //     using an idempotent ledger key (`WLT-SEED-<userId>`). The seed
    //     does NOT touch User.walletBalance (the User row is already
    //     correct) and is a no-op for fresh customers.
    //   - When the flag is OFF the legacy code path is preserved bit-for-bit
    //     so rollback is an env flip.
    let walletSplitForOrders = { shopping: 0, earnings: 0, available: 0 };
    if (walletAmount > 0) {
      if (isWalletRedemptionReducesPayableEnabled()) {
        await seedCanonicalCustomerWalletFromUser({ customerId, user, session });
        // MLM Phase 1: drain across shopping → earnings → available so
        // joining-package shopping credit is spent first, then earnings,
        // then the legacy refund balance. Each bucket drain writes its
        // own LedgerEntry inside the same session.
        const drain = await debitCustomerSpendableBuckets({
          customerId,
          totalAmount: walletAmount,
          session,
          ledgerReference: `WLT-CHOUT-${checkoutGroupId}`,
          ledgerDescription: "Wallet redeemed at checkout",
          idempotencyKey: `WLT-CHOUT-${checkoutGroupId}`,
          metadata: { checkoutGroupId },
        });
        walletSplitForOrders = drain.split;
        // Keep legacy User.walletBalance mirror in sync when the
        // `available` bucket was drained (other buckets never lived on
        // the User document).
        if (drain.split.available > 0 && user) {
          try {
            await User.updateOne(
              { _id: customerId },
              { $inc: { walletBalance: -drain.split.available } },
              { session },
            );
          } catch {
            // soft-fail: canonical Wallet is authoritative
          }
        }
      } else {
        user.walletBalance -= walletAmount;
        await user.save({ session });
        walletSplitForOrders = { shopping: 0, earnings: 0, available: walletAmount };
      }

      // Legacy `Transaction` row: kept under both code paths so existing
      // admin dashboards and the `walletLedgerVerifierJob` baseline view
      // are unaffected. The collection deprecation is a later phase.
      // Mongoose 8 requires an array when passing `{ session }` — a bare
      // `create(doc, { session })` treats the options object as a second
      // document and fails validation on an empty Transaction row.
      await Transaction.create(
        [
          {
            user: customerId,
            userModel: "User",
            type: "Wallet Payment",
            amount: -walletAmount,
            status: "Settled",
            reference: `WLT-CHOUT-${checkoutGroupId}`,
            meta: { checkoutGroupId, walletSplit: walletSplitForOrders },
          },
        ],
        { session },
      );

      // MLM Phase 1: stamp per-order walletSplit (proportional to each
      // order's walletAmount slice) so refunds + clawbacks can route
      // back to the source buckets in Phase 3's orderReturnService.
      if (Array.isArray(orders) && orders.length > 0 && walletAmount > 0) {
        for (const order of orders) {
          const orderWallet = Number(order.paymentBreakdown?.walletAmount || 0);
          if (orderWallet <= 0) continue;
          const ratio = orderWallet / walletAmount;
          const oShopping = roundCurrency(walletSplitForOrders.shopping * ratio);
          const oEarnings = roundCurrency(walletSplitForOrders.earnings * ratio);
          const oAvailable = roundCurrency(orderWallet - oShopping - oEarnings);
          order.paymentBreakdown = order.paymentBreakdown || {};
          order.paymentBreakdown.walletSplit = {
            shopping: oShopping,
            earnings: oEarnings,
            available: Math.max(0, oAvailable),
          };
          await order.save({ session });
        }
      }
    }

    const transactionRows = orders.map((order) => ({
      user: order.seller,
      userModel: "Seller",
      order: order._id,
      type: "Order Payment",
      amount: Number(order.paymentBreakdown?.grandTotal || order.pricing?.total || 0),
      status: "Pending",
      reference: order.orderId,
      meta: {
        checkoutGroupId,
      },
    }));
    if (transactionRows.length > 0) {
      await Transaction.create(transactionRows, { session, ordered: true });
    }

    await consumeCartItems({
      customerId,
      source: resolvedSource || source,
      orderItemsInput,
      session,
      cartDocument,
    });

    // Audit Phase 5 (M-3): atomic, usage-limit-aware coupon increment
    // INSIDE the transaction. When SERVER_SIDE_COUPON_ENGINE is on, the
    // server is the authority on whether a coupon applies (we already
    // re-validated it inside `buildCheckoutPricingSnapshot`), so the
    // increment is now part of the same atomic write set as the order
    // documents. The increment is conditional — if `usageLimit` is set
    // and already reached, the document is left untouched. The order
    // proceeds regardless (legacy semantics) so a race-condition winner
    // doesn't lock out the loser at checkout; accounting is honest at
    // the coupon level. When the flag is OFF, this block is a no-op
    // and the legacy post-commit fire-and-forget block (below) runs
    // instead.
    if (
      isServerSideCouponEngineEnabled() &&
      pricingSnapshot.couponSnapshot?.couponId
    ) {
      await incrementCouponUsage({
        couponId: pricingSnapshot.couponSnapshot.couponId,
        session,
      });
    }

    await session.commitTransaction();

    // Phase 2 P2-7: atomic, usage-limit-aware coupon increment.
    //
    // The previous unconditional `$inc: { usedCount: 1 }` could push
    // `usedCount` past `usageLimit` under concurrent checkouts (two carts
    // both pass the read-time check at line ~95 of couponController.js
    // before either increments). The aggregation-pipeline update below
    // performs a conditional increment: if `usageLimit` is set and would
    // be exceeded, the document is left untouched. The order itself was
    // already placed (the check at validation time is best-effort), but
    // accounting now stays honest.
    //
    // Audit Phase 5 (M-3): when SERVER_SIDE_COUPON_ENGINE is on, the
    // increment is already performed transactionally above so this
    // post-commit fire-and-forget path becomes a no-op. When the flag
    // is OFF (legacy behaviour), we keep the post-commit increment so
    // the wire-level semantics of the legacy code path are preserved
    // bit-for-bit.
    const couponId = normalizedPayload.couponId;
    if (couponId && !isServerSideCouponEngineEnabled()) {
      Coupon.updateOne(
        { _id: couponId },
        [
          {
            $set: {
              usedCount: {
                $cond: [
                  {
                    $or: [
                      { $not: ["$usageLimit"] },
                      {
                        $lt: [
                          { $ifNull: ["$usedCount", 0] },
                          "$usageLimit",
                        ],
                      },
                    ],
                  },
                  { $add: [{ $ifNull: ["$usedCount", 0] }, 1] },
                  { $ifNull: ["$usedCount", 0] },
                ],
              },
            },
          },
        ],
      ).catch(() => {});
    }

    const resultPayload = buildResultPayload({
      checkoutGroup,
      orders,
    });

    if (idempotencyKey) {
      await storeIdempotencyResult(idempotencyKey, resultPayload, normalizedPayload);
    }

    if (shouldStartSellerWorkflow) {
      for (const order of orders) {
        if (order.franchisePartnerId) continue;
        void afterPlaceOrderV2(order).catch((error) => {
          logger.warn("[placeOrderAtomic] afterPlaceOrderV2 failed", {
            orderId: order.orderId,
            message: error.message,
          });
        });
      }
    }

    for (const order of orders) {
      emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_PLACED, {
        orderId: order.orderId,
        checkoutGroupId,
        customerId,
        userId: customerId,
      });
      if (order.seller && !(order.franchisePartnerId && franchisePartner)) {
        emitNotificationEvent(NOTIFICATION_EVENTS.NEW_ORDER, {
          orderId: order.orderId,
          checkoutGroupId,
          sellerId: order.seller,
          customerId,
        });
      }
      if (order.franchisePartnerId && !awaitingGatewayPayment) {
        await notifyFranchisePartnerNewOrder(franchisePartner, order);
      }
    }

    if (pendingLowStockAlerts.length > 0 && await isLowStockAlertsEnabled()) {
      pendingLowStockAlerts.forEach((alertPayload) => {
        emitNotificationEvent(NOTIFICATION_EVENTS.LOW_STOCK_ALERT, alertPayload);
      });
    }

    return { ...resultPayload, duplicate: false };
  } catch (error) {
    await session.abortTransaction();

    if (idempotencyKey) {
      if (isRetryableError(error)) {
        await releaseIdempotencyLock(idempotencyKey);
      } else {
        await storeIdempotencyError(idempotencyKey, error, normalizedPayload);
      }
    }

    if (error?.code === 11000) {
      if (idempotencyKey) {
        const existing = await findExistingCheckoutByIdempotency(customerId, idempotencyKey);
        if (existing) {
          const existingResult = buildResultPayload({
            checkoutGroup: existing.checkoutGroup,
            orders: existing.orders,
          });
          await storeIdempotencyResult(idempotencyKey, existingResult, normalizedPayload);
          return { ...existingResult, duplicate: true };
        }
      }

      if (retryCount < 2 && /orderId|checkoutGroupId/i.test(String(error.message || ""))) {
        return placeOrderAtomic({
          customerId,
          payload: normalizedPayload,
          idempotencyKey,
          retryCount: retryCount + 1,
        });
      }
    }

    throw error;
  } finally {
    session.endSession();
  }
}

export default {
  placeOrderAtomic,
};
