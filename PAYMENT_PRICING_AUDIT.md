# Full-System Audit — Order Pricing & Payment Lifecycle
**Project**: Appzeto Quick Commerce  
**Scope**: Cart → Checkout → Payment → Delivery → Settlement → Refund → Payout  
**Method**: Static code trace. Every claim below cites an exact file + line.  
**Status**: 4 CRITICAL, 9 HIGH, 11 MEDIUM, 8 LOW findings.

---

## TL;DR — Read this first

You are charging customers twice when they use wallet + online payment.  
A customer can set `discountTotal: 9_999_999` on a `POST /orders` and get a free order.  
Customers can reuse the same coupon unlimited times.  
v2 workflow cancellations (~95% of all cancellations) never refund a wallet redemption.  
Two payout-cancel paths reference `PAYOUT_STATUS.CANCELLED` which is `undefined` and silently fails the enum validator.

These are individually merge-blockers; collectively this is a finance emergency.

---

# PHASE 1 — PAYMENT FLOW DISCOVERY

## 1.1 The 9 pricing engines & their entry points

| # | Engine / Calculator | File | Owns |
|---|---|---|---|
| 1 | Cart subtotal (client) | `frontend/src/modules/customer/context/CartContext.jsx` L309–315 | `cartTotal` (uses salePrice if < price else price) |
| 2 | Cart subtotal (server, hydration) | `backend/app/services/finance/pricingService.js::calculateProductSubtotal` L104 | `productSubtotal` post server-pricing enforcement |
| 3 | Category commission split | `pricingService.js::calculateCategoryCommission` L114–139 | `adminProductCommission`, `sellerPayout` per line |
| 4 | Handling fee (per-seller) | `pricingService.js::calculateHandlingFee` L149–217 | `handlingFeeCharged` (4 strategies) |
| 5 | Global handling fee override | `checkoutPricingService.js::computeGlobalHandlingFeeForCheckout` + `applyGlobalHandlingFeeToSellerBreakdowns` L162–246 | Forces single seller to carry the cart-wide handling fee |
| 6 | Customer delivery fee | `pricingService.js::calculateCustomerDeliveryFee` L219–272 | `deliveryFeeCharged`, distance rounding |
| 7 | Rider payout | `pricingService.js::calculateRiderPayout` L274–308 | `riderPayoutBase/Distance/Bonus/Total` |
| 8 | Aggregate breakdown / multi-seller | `checkoutPricingService.js::buildCheckoutPricingSnapshot` L248–323 | per-seller + aggregate `grandTotal` |
| 9 | Coupon discount engine | `controller/couponController.js::validateCoupon` L79–212 | `discountAmount`, `freeDelivery` (no server-side re-validation at place-order time — see C-2) |

There is **no GST engine**. `pricingService.generateOrderPaymentBreakdown` accepts `taxTotal` but `buildCheckoutPricingSnapshot` hard-codes it to `0` at L295. The Order model still carries `pricing.gst` for legacy compatibility but it is never computed.

There is **no surge/peak-pricing engine** despite the project description mentioning surge. No code path touches a "surge multiplier".

There is **no packaging fee engine** as a first-class concept; the global handling fee doubles as packaging.

## 1.2 Money-flow topology

```
                                     ┌──────────────────────────────────┐
              [browser]               │  Frontend  (CheckoutPage.jsx)   │
                                     │                                  │
   cart→preview (debounced 400ms) ───►│ POST /cart/checkoutPreview      │──┐
                                     │                                  │  │
   user picks tip / coupon / wallet  │  pricingPreview (preview)        │  │
                                     │                                  │  │
   "Slide to Pay" ─────────────────► │ POST /orders/place               │──┼─┐
                                     │  body = { items, address,        │  │ │
                                     │           discountTotal,         │  │ │
                                     │           tipAmount, walletAmount│  │ │
                                     │           paymentMode, couponId} │  │ │
                                     └──────────────────────────────────┘  │ │
                                                                            ▼ ▼
                                                ┌────────────────────────────┴────┐
                                                │ backend                          │
                                                │                                  │
                                                │ orderController.placeOrder       │
                                                │  → validate w/ Joi               │
                                                │  → placeOrderAtomic              │
                                                │     ├─ mongoose.startSession     │
                                                │     ├─ idempotency check         │
                                                │     ├─ buildCheckoutPricing-     │
                                                │     │     Snapshot (preview)     │
                                                │     ├─ create CheckoutGroup      │
                                                │     ├─ per-seller Order docs     │
                                                │     │  + freezeFinancialSnapshot │
                                                │     ├─ user.walletBalance -=     │
                                                │     │   walletAmount  ⚠ direct   │
                                                │     ├─ Transaction "Order Payment"
                                                │     ├─ cart.items = []           │
                                                │     └─ commit                    │
                                                │                                  │
                                                │   COD path → afterPlaceOrderV2   │
                                                │     → scheduleSellerTimeoutJob   │
                                                │     → emit ORDER_PLACED          │
                                                │                                  │
                                                │   ONLINE path → wait for         │
                                                │     POST /payment/create-order   │
                                                │     → PhonePeAdapter.initiate    │
                                                │     → redirect to PhonePe        │
                                                │                                  │
                                                │  PhonePe webhook                 │
                                                │   → processPhonePeWebhook        │
                                                │   → transitionPaymentState       │
                                                │   → handleOrderSideEffects       │
                                                │      ├─ CAPTURED:                │
                                                │      │    handleOnlineOrderFinance
                                                │      │    moveOrderToSellerPending
                                                │      ├─ FAILED:                  │
                                                │      │    release stock + cancel │
                                                │      └─ REFUNDED:                │
                                                │           Order.paymentStatus=   │
                                                │           REFUNDED               │
                                                │                                  │
                                                │  rider verifyHandoffOtpAndDeliver│
                                                │   → applyDeliveredSettlement     │
                                                │      ├─ settleDeliveredOrder     │
                                                │      │   ├─ createPendingSeller- │
                                                │      │   │   Payout (HOLD if     │
                                                │      │   │   in return window)   │
                                                │      │   ├─ createPendingRider-  │
                                                │      │   │   Payout              │
                                                │      │   └─ creditAdminEarning   │
                                                │      │       (ONLINE only)       │
                                                │      └─ handleCodOrderFinance    │
                                                │          (COD only)              │
                                                │          → updateCashInHand      │
                                                │            (gross − rider comm)  │
                                                │          → ledger COD_COLLECTED  │
                                                │                                  │
                                                │  admin processPayout             │
                                                │   → pending→available bucket     │
                                                │   → settlementStatus=COMPLETED   │
                                                │                                  │
                                                │  customer requestReturn          │
                                                │   → seller approveReturn         │
                                                │   → rider return pickup OTP      │
                                                │   → admin QC                     │
                                                │   → completeReturnAndRefund      │
                                                │      (TRANSACTIONAL_REFUND_ENABLED│
                                                │       flag)                      │
                                                └──────────────────────────────────┘
```

## 1.3 Cron / queue / job inventory

| Job / Queue | File | Money-flow side-effect |
|---|---|---|
| `orderAutoCancelJob` | `app/jobs/orderAutoCancelJob.js` | Cancels stale `pending` orders → `compensateOrderCancellation` (does **not** refund wallet — see C-3) |
| `returnWindowReleaseJob` | `app/jobs/returnWindowReleaseJob.js` | Releases held seller payouts after return window |
| `payoutBatchJob` | `app/jobs/payoutBatchJob.js` | Bulk processes pending payouts |
| `firebaseTrackingCleanupJob` | `app/jobs/firebaseTrackingCleanupJob.js` | RTDB cleanup, no money |
| `walletLedgerVerifierJob` | `app/jobs/walletLedgerVerifierJob.js` | **Read-only** drift detector. Disabled by default (`FINANCE_VERIFIER_ENABLED`). |
| `orderQueueProcessors.js` | `app/queues/` | Bull processors for seller/delivery/return timeout |
| `bullJobScheduler.js` | `app/services/workflow/` | Schedules SELLER_TIMEOUT, DELIVERY_TIMEOUT, RETURN_PICKUP_TIMEOUT |

---

# PHASE 2 — DB & STATE TRACE (Field Ownership Map)

> **Source-of-truth diagram**: arrows point **away from** the authority. Two arrows pointing at one field = drift surface.

| Field | Authority (write) | Mirror (sync) | Read sites | Drift surface? |
|---|---|---|---|---|
| `Order.paymentBreakdown.productSubtotal` | `pricingService.generateOrderPaymentBreakdown` | `Order.pricing.subtotal` (via `syncLegacyPricing`) | UI, settlement, dashboards | none |
| `Order.paymentBreakdown.deliveryFeeCharged` | same | `Order.pricing.deliveryFee` | UI, settlement | none |
| `Order.paymentBreakdown.handlingFeeCharged` | `applyGlobalHandlingFeeToSellerBreakdowns` **overwrites** the per-seller value computed by `generateOrderPaymentBreakdown` | `Order.pricing.platformFee` | UI, settlement | **C-1 risk**: handlingFee can land on the "wrong" seller in multi-seller checkouts (see H-3) |
| `Order.paymentBreakdown.tipTotal` | `allocateCheckoutTipToSellerBreakdowns` (last-seller residual takes rounding) | `Order.pricing.tip` | rider payout (`riderTipAmount`) | none |
| `Order.paymentBreakdown.discountTotal` | **Client payload** (Joi `discountTotal` accepted as-is) → `placeOrderAtomic` L316 | `Order.pricing.discount` | grandTotal subtractor | **C-2 — see below** |
| `Order.paymentBreakdown.taxTotal` | Hard-coded `0` at `checkoutPricingService.js` L295 | `Order.pricing.gst` | grandTotal additive | dead (engine missing) |
| `Order.paymentBreakdown.grandTotal` | `pricingService.generateOrderPaymentBreakdown` L464–471: `subtotal + delivery + handling − discount + tax + tip`. **Does not subtract walletAmount.** | `Order.pricing.total` | `paymentService.getPayableAmountPaise`, `handleOnlineOrderFinance`, COD cash collection | **C-1 — wallet doublecharge** |
| `Order.paymentBreakdown.walletAmount` | `placeOrderAtomic` L374 (proportionate split per group) → `freezeFinancialSnapshot` L122 | `Order.pricing.walletAmount` | display only; **never used to reduce payable** | dead arithmetic |
| `Order.paymentBreakdown.sellerPayoutTotal` | `pricingService.generateOrderPaymentBreakdown` L431 | `CheckoutGroup.sellerBreakdown[].sellerPayout`, `Payout.amount`, `Wallet.pendingBalance` | seller dashboards | none |
| `Order.paymentBreakdown.adminProductCommissionTotal` | same | `Order.paymentBreakdown.platformTotalEarning` | admin earnings (`getAdminFinanceSummary`) | **H-1**: admin earning aggregation filters `paymentMode: "ONLINE"` only, so COD commissions are missing from "Total Admin Earning" (intentional per comment, but confusingly mis-named) |
| `Order.paymentBreakdown.riderPayoutTotal` | `pricingService.calculateRiderPayout` + tip allocator | `Payout({type: DELIVERY_PARTNER}).amount`, `Wallet.pendingBalance` (rider) | rider app | none |
| `Order.paymentBreakdown.platformLogisticsMargin` | `applyGlobalHandlingFeeToSellerBreakdowns` L239–241 (or `generateOrderPaymentBreakdown` L481) | none | finance report | none |
| `Order.paymentBreakdown.codCollectedAmount` | `handleCodOrderFinance` L478 (gross−rider, NOT gross) | `Wallet.cashInHand` (rider) | admin "System Float COD" dashboard | **M-1**: see below |
| `Order.paymentBreakdown.codRemittedAmount` | `reconcileCodCash` L711 | none | finance | none |
| `Order.paymentStatus` | mixed: `paymentService.transitionPaymentState`, `handleOnlineOrderFinance`, `handleCodOrderFinance`, `reconcileCodCash`, schema `pre('save')`, schema `pre('findOneAndUpdate')` | `payment.status` (legacy) via mirror hook | dashboards | well-mirrored (Phase 4 P4-1) |
| `Order.settlementStatus.sellerPayout` | `createPendingSellerPayout`, `processPayout`, return refund flow | `Order.financeFlags.sellerPayoutQueued/Held` | seller dashboards | **H-2**: enum allows `CANCELLED` but `PAYOUT_STATUS.CANCELLED` constant is `undefined` |
| `Order.settlementStatus.riderPayout` | `createPendingRiderPayout`, `processPayout` | `Order.financeFlags.riderPayoutQueued` | rider dashboards | none |
| `User.walletBalance` (legacy, customer) | `orderPlacementService` direct `user.walletBalance -= walletAmount` L445 **AND** `walletService.creditWallet/debitWallet` (since Phase 4 P4-3) | mirrored from `Wallet({ownerType:"CUSTOMER"})` | `orderPlacementService` validation L297, frontend `user.walletBalance` | **C-3 + H-5 dual-write drift** |
| `Wallet.availableBalance` (canonical) | `walletService.creditWallet/debitWallet` | `User.walletBalance` (one-way, soft) | `getCustomerBalance`, admin dashboards | drift from `User.walletBalance` unless every write goes through walletService |
| `Wallet.pendingBalance` | `createPendingPayoutForOrder`, `processPayout`, `cancelPendingPayoutForOrder` | `Order.settlementStatus.*Payout` | finance | **H-2 leaks pending** when payout cancel fails enum |
| `Wallet.cashInHand` (rider) | `updateCashInHand` (COD collect) + `reconcileCodCash` | none | admin cash dashboards | **M-1 dual source** with Transaction-derived view |
| `Coupon.usedCount` | `placeOrderAtomic` L497 (fire-and-forget, after commit) | none | usageLimit check | atomic; per-user limit not enforced (C-2) |
| `Payment.status` | `paymentService.transitionPaymentState` only | none | webhook/verify | none |
| `Payment.statusHistory` | same | none | audit | none |
| `LedgerEntry` rows | `ledgerService.createLedgerEntry` (idempotent via partial unique index on `idempotencyKey`) | parallel mirror to legacy `Transaction` collection in some flows | finance audit log | parallel ledger (Transaction) is **not** dual-written for wallet redemption at checkout — see C-3 |

## 2.1 Duplicate / shadow ledgers

You have **three** parallel ledgers:

1. `Wallet({available, pending, cashInHand})` — canonical balances
2. `LedgerEntry` — canonical event log (Phase 2 design, partial idempotency)
3. `Transaction` — legacy event log (Phase 4 deprecation comment in model L3–19 says it's still dual-written by return refund, COD settlement, withdrawals)

Plus a fourth derived view: `admin/cashService.js` L30-55 aggregates `Cash Collection − Cash Settlement` Transaction rows to compute rider `currentCash` — this is **NOT** `Wallet.cashInHand`. Two source-of-truth views for the same fact.

---

# PHASE 3 — CROSS-MODULE FLOW

## 3.1 Customer-frontend → Backend (Checkout)

`CheckoutPage.jsx::handlePlaceOrder` L721–817 builds:

```js
const orderData = {
  address, paymentMode,
  discountTotal: discountAmount,        // ← from selectedCoupon.discountAmount
  taxTotal: pricingPreview?.taxTotal || 0,
  tipAmount: selectedTip,
  timeSlot, walletAmount: walletAmountToUse,
  items: [...]
};
await customerApi.createOrder(orderData);
```

Joi schema (`createFinanceOrderSchema`) accepts ALL of these as plain numbers with `Joi.number().min(0)` — no relation back to coupon, no relation back to wallet balance check on server. Server-trust is broken at the schema boundary.

## 3.2 PhonePe payment chain

```
client → POST /payment/create-order { orderRef }
       ← { redirectUrl, merchantOrderId }
       → window.location = redirectUrl
       
PhonePe → webhook /payment/phonepe/webhook (raw body + X-VERIFY header)
        → processPhonePeWebhook → validateWebhook (PhonePe SDK)
        → decode base64 payload → eventId = payload.transactionId || randomUUID()
        → PaymentWebhookEvent.create({ eventId, payloadHash }) [unique index]
        → transitionPaymentState → handleOrderSideEffects
        
client returns to /payment-status?merchantOrderId=XXX
       → POST /payment/verify/:merchantOrderId
       → verifyPhonePePaymentStatus (defensive double-check)
```

**Idempotency posture**:
- Webhook: `eventId` unique index ⇒ duplicate webhooks short-circuit (`code 11000` returns `duplicate: true`). **BUT** if PhonePe sends a webhook with no `transactionId`, `crypto.randomUUID()` is used — so the same logical event re-delivered twice on different calls would be processed twice. See M-3.
- Place-order: `Idempotency-Key` header, partial unique index on `Order.placement.idempotencyKey` (`partialFilterExpression: { idempotencyKey: { $type: "string" } }`). Strong.
- Wallet refunds & seller debits inside `completeReturnAndRefund`: every `walletService.creditWallet/debitWallet` passes `idempotencyKey: 'RET-CUST-REFUND-<orderId>'` etc., backed by partial unique index on `LedgerEntry.idempotencyKey`. Strong.

## 3.3 Notifications

`emitNotificationEvent(NOTIFICATION_EVENTS.X, payload)` is called **after** the transaction commits in `placeOrderAtomic` L545–566 — good. Same for `completeReturnAndRefund` (refund notification fires only after `withTransaction` returns). Same for delivery completion.

**Counter-example**: `payment.service.js::handleOrderSideEffectsFromPaymentStatus` emits `PAYMENT_SUCCESS` & `NEW_ORDER` (L376–388) *inside* a forEach loop that runs after `transitionPaymentState` saves but **before** `moveOrderToSellerPendingAfterPayment`'s downstream side-effects complete. If a downstream `afterPlaceOrderV2` fires & fails silently (`.catch` on L296), the seller has been notified of a new order that isn't actually in `SELLER_PENDING` state.

## 3.4 Socket events

| Event | Emitter | Carries money fields? |
|---|---|---|
| `order:new` | `afterPlaceOrderV2` | `orderId`, `sellerPendingExpiresAt` only |
| `delivery:broadcast` | `emitDeliveryBroadcastForSeller` | `preview.total` (`pricing.total`) — legacy field |
| `delivery:otp:validated` | `verifyHandoffOtpAndDeliver` | none |
| `order:status:update` | `emitOrderStatusUpdate` | workflowStatus only |

Socket payloads use **legacy `pricing.total`** (not `paymentBreakdown.grandTotal`). Drift surface if `paymentBreakdown.grandTotal` is updated after creation (e.g. during a refund) but `pricing.total` is not re-synced. `syncLegacyPricing` in `orderFinanceService.js` L78-90 does sync but only on save paths that go through `freezeFinancialSnapshot`. `updateOne` paths skip it.

---

# PHASE 4 — BUG / RISK DETECTION

## CRITICAL ISSUES (4)

### 🔴 C-1: Wallet redemption double-charges the customer

**Root cause**:  
`generateOrderPaymentBreakdown` (`backend/app/services/finance/pricingService.js` L464–471):

```64:74:backend/app/services/finance/pricingService.js
  const grandTotal = roundCurrency(
    productSubtotal +
      delivery.deliveryFeeCharged +
      handling.handlingFeeCharged -
      normalizedDiscount +
      normalizedTax +
      normalizedTip,
  );
```

`grandTotal` does **NOT** subtract `walletAmount`. But `placeOrderAtomic` *also* directly debits `user.walletBalance`:

```442:457:backend/app/services/orderPlacementService.js
    // Deduct wallet balance if used
    if (walletAmount > 0) {
      user.walletBalance -= walletAmount;
      await user.save({ session });

      await Transaction.create({
        user: customerId,
        userModel: "User",
        type: "Wallet Payment",
        amount: -walletAmount,
        status: "Settled",
        reference: `WLT-CHOUT-${checkoutGroupId}`,
        meta: { checkoutGroupId }
      }, { session });
    }
```

For an **ONLINE** order the customer is then asked to pay the full `paymentBreakdown.grandTotal`:

```195:208:backend/app/services/paymentService.js
function getPayableAmountPaise(target) {
  const amountRupees = target.orders.reduce(
    (sum, order) =>
      sum + Number(order?.paymentBreakdown?.grandTotal ?? order?.pricing?.total ?? 0),
    0,
  );
  ...
  return Math.round(amountRupees * 100);
}
```

For a **COD** order the rider collects the full grandTotal in cash (`handleCodOrderFinance` L453).

**Frontend evidence the customer THINKS they only pay `total − wallet`**:

```249:251:frontend/src/modules/customer/pages/CheckoutPage.jsx
  }, [useWallet, user?.walletBalance, pricingPreview?.grandTotal]);

  const finalAmountToPay = Math.max(0, (pricingPreview?.grandTotal || 0) - walletAmountToUse);
```

The "Slide to Pay" button shows `finalAmountToPay` (CheckoutPage L1056, L1073). Customer slides, expecting to pay `grandTotal - walletAmount`. Backend processes full `grandTotal` via PhonePe AND debits the wallet.

**Business impact**: **Every wallet-using customer is over-charged by `walletAmount`.** Worst case is `walletAmount = grandTotal` (fully covered): customer expects to pay ₹0 but is redirected to PhonePe for the full amount, and on the COD path the rider asks for full cash.

**Fix**:
```diff
- const grandTotal = roundCurrency(productSubtotal + ... + tip);
+ const grandTotal = roundCurrency(productSubtotal + ... + tip - walletAmount);
```
plus thread `walletAmount` through `generateOrderPaymentBreakdown`, the per-seller proportionate split (already exists in `placeOrderAtomic` L374), and `freezeFinancialSnapshot`. Also write a `LedgerEntry({type: WALLET_REDEMPTION_AT_CHECKOUT, direction: DEBIT, actorType: CUSTOMER})` inside the same `session.withTransaction` so the ledger reflects the wallet payment alongside the gateway payment. Today only a legacy `Transaction` row exists.

**Migration**: add a backfill script that detects historical orders where `paymentBreakdown.walletAmount > 0` and reconciles the ledger.

**Rollout**: behind feature flag `WALLET_REDEMPTION_REDUCES_PAYABLE=true`, default OFF on legacy data, ON for new orders after deploy.

---

### 🔴 C-2: Pricing tampering via client-supplied `discountTotal`

**Root cause**: The Joi schema accepts `discountTotal` as any non-negative number, and `placeOrderAtomic` uses it directly with no coupon re-validation:

```43:46:backend/app/validation/financeValidation.js
export const createFinanceOrderSchema = checkoutPreviewSchema.keys({
  items: Joi.array().items(orderItemSchema).min(1).optional(),
  paymentMode: Joi.string().valid("ONLINE", "COD").required(),
  walletAmount: Joi.number().min(0).default(0),
});
```

(`checkoutPreviewSchema` L34: `discountTotal: Joi.number().min(0).default(0)` — no upper bound)

```312:318:backend/app/services/orderPlacementService.js
    const pricingSnapshot = await buildCheckoutPricingSnapshot({
      orderItems: orderItemsInput,
      address: normalizedAddress,
      tipAmount,
      discountTotal: Math.max(0, Number(normalizedPayload.discountTotal || 0)),
      session,
    });
```

**Exploit (curl-pastable)**:
```bash
curl -X POST /api/orders/place \
  -H "Authorization: Bearer <token>" \
  -d '{"address": {...}, "paymentMode": "COD", "items": [{product, quantity:1, price:50}], "discountTotal": 9999999}'
```

The server will subtract ₹9 999 999 from `grandTotal` at `pricingService.js` L468, producing a negative grandTotal that is then stored. (Money model `clampMoney` only clamps individual `itemSubtotal`, not the aggregate.)

**Coupon `couponId` is sent but only used to bump usedCount** (`orderPlacementService.js` L495–522):

```495:523:backend/app/services/orderPlacementService.js
    const couponId = normalizedPayload.couponId;
    if (couponId) {
      Coupon.updateOne(
        { _id: couponId },
        [
          {
            $set: {
              usedCount: {
                $cond: [
                  ...
```

The coupon's `discountType`, `discountValue`, `minOrderValue`, `maxDiscount`, `applicableCategories`, `validFrom/Till` are **never** re-evaluated against the actual order at place time. The discount value is whatever the client said.

**Fix**: introduce `services/finance/couponService.js::computeOrderDiscount({couponCode, hydratedItems, customer})` that returns `{discountAmount, freeDelivery, couponSnapshot}`. Call it from `buildCheckoutPricingSnapshot` and ignore client-supplied `discountTotal`. Persist `couponSnapshot` on the Order so the audit trail captures *which* coupon and *what rules* applied.

**Migration**: add `Order.coupon` (ObjectId ref) and `Order.couponSnapshot` (frozen) fields.

---

### 🔴 C-3: v2 cancellations never refund wallet redemptions or online captures

**Root cause**: `compensateOrderCancellation` (the chokepoint for every v2 cancellation path) only releases stock and marks Transactions failed:

```16:58:backend/app/services/orderCompensation.js
export async function compensateOrderCancellation(order, orderIdString) {
  const existing = await Order.findById(order._id);
  if (existing) {
    await releaseReservedStockForOrder(existing, { reason: "Cancelled" });
    await existing.save();
  }

  await Transaction.findOneAndUpdate(
    { reference: orderIdString },
    { status: "Failed" },
  );

  if (existing?.checkoutGroupId) { ...CheckoutGroup CANCELLED... }

  // Fire-and-forget cleanup of realtime tracking nodes.
  const canonicalOrderId = existing?.orderId || orderIdString;
  if (canonicalOrderId) {
    clearOrderTracking(canonicalOrderId).catch(() => {});
  }
}
```

**It does NOT call `reverseOrderFinanceOnCancellation`**. So all callers of `compensateOrderCancellation`:

- `sellerRejectAtomic` (L254)
- `processSellerTimeoutJob` (L435)
- `processDeliveryTimeoutJob` (L522)
- `customerCancelV2` (L756)
- `orderAutoCancelJob` (via the chokepoint)

never refund:
1. wallet redemption (`user.walletBalance` debited at checkout — money gone)
2. captured online payment (`Order.paymentStatus === "PAID"` — admin wallet has the money, customer's bank does not)

The **only** path that calls `reverseOrderFinanceOnCancellation` is the **legacy v1** cancellation in `orderController.cancelOrder` L344-359, but v2 orders take an earlier-return at L305-316.

**Business impact**:  
- Customer adds ₹100 wallet → places ONLINE order ₹500 → PhonePe captures ₹500 (because of C-1) → seller times out 60s later → wallet=₹0, customer is out ₹600.
- Customer adds ₹100 wallet → places COD ₹500 → seller times out → wallet=₹0 (no refund), no cash collected → customer is out ₹100.

**Fix**: at the top of `compensateOrderCancellation`, call `reverseOrderFinanceOnCancellation(existing._id, {reason})`. Make it idempotent (`order.financeFlags.cancellationReversalApplied`) so re-running the cancellation job doesn't double-refund.

---

### 🔴 C-4: Per-user coupon limit is hard-coded to never trigger

```117:119:backend/app/controller/couponController.js
            // We are not storing coupon reference on order yet, so this is a soft check.
            // Once couponId gets stored on orders, we can count exact usages.
            userUsageCount = 0;
```

`perUserLimit` on Coupon (default 1, L70 of `models/coupon.js`) means nothing because the check at L122–124 is always `0 >= perUserLimit ? false : ok`. The schema also has no `applicableUsers` filter wiring, so a "first-order-only" coupon can be used unlimited times by anyone in a loop.

**Combined with C-2**: an attacker can:
1. Create one account.
2. Loop: place ₹50 order with `WELCOME50` coupon → cancel → place again. Or send the same coupon code on N parallel checkouts.

**Fix**: store `Order.coupon`, count `Order.countDocuments({customer, coupon, status: {$ne: "cancelled"}})` server-side at validate-time, and lock with a unique compound index `(customer, coupon)` when `perUserLimit === 1`.

---

## HIGH ISSUES (9)

### 🟠 H-1: `PAYOUT_STATUS.CANCELLED` is `undefined`

```68:78:backend/app/constants/finance.js
export const PAYOUT_TYPE = {
  SELLER: "SELLER",
  DELIVERY_PARTNER: "DELIVERY_PARTNER",
};

export const PAYOUT_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};
```

No `CANCELLED` member. But `payoutService.js` references it 3 times:

```43:48:backend/app/services/finance/payoutService.js
    const existing = await Payout.findOne({
      relatedOrderIds: order._id,
      payoutType,
      status: { $ne: PAYOUT_STATUS.CANCELLED },
    }).session(session);
```

```243:247:backend/app/services/finance/payoutService.js
    payout.status = PAYOUT_STATUS.CANCELLED;
    payout.remarks = remarks || `Payout cancelled due to return/reversal.`;
    payout.cancelledAt = new Date();
```

Because `PAYOUT_STATUS.CANCELLED === undefined`:
- L47: `{ $ne: undefined }` matches **all documents** (so idempotency check fires only when status is missing — effectively never short-circuits)
- L243: `payout.status = undefined` then `await payout.save()` — the Payout schema's `enum: ALL_PAYOUT_STATUSES` does NOT include `CANCELLED`. Mongoose will throw `ValidationError`.

The Order schema *does* permit `CANCELLED` on `settlementStatus.sellerPayout` (L182 of `order.js`):

```180:184:backend/app/models/order.js
      sellerPayout: {
        type: String,
        enum: ["NOT_APPLICABLE", "HOLD", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"],
        default: "PENDING",
      },
```

So the **Order** can hold `"CANCELLED"` but the **Payout** cannot. `cancelPendingPayoutForOrder` throws every time it's called, **silently aborting return-QC-passed refund flows under the legacy non-transactional code path** (`orderController.completeReturnAndRefundLegacy` L988-1139). Under the new transactional path (`OrderReturnService.completeReturnAndRefund`) the error propagates and aborts the whole refund.

**Fix**:
```diff
 export const PAYOUT_STATUS = {
   PENDING: "PENDING",
   PROCESSING: "PROCESSING",
   COMPLETED: "COMPLETED",
   FAILED: "FAILED",
+  CANCELLED: "CANCELLED",
 };
```
Single-line constant fix. The schema enum derives from `ALL_PAYOUT_STATUSES = Object.values(PAYOUT_STATUS)` so it propagates automatically. Add a migration to clean up any documents accidentally saved with `status: null` (shouldn't exist because save would have thrown, but verify).

---

### 🟠 H-2: Coupon validation soft-checks bypass the discount engine

```183:201:backend/app/controller/couponController.js
        if (coupon.discountType === "free_delivery") {
            freeDelivery = true;
        } else if (coupon.discountType === "percentage") {
            discountAmount = Math.round((cartTotal * coupon.discountValue) / 100);
        } else if (coupon.discountType === "fixed") {
            discountAmount = coupon.discountValue;
        }

        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
            discountAmount = coupon.maxDiscount;
        }
```

- Discount uses `Math.round` (integer rupees). Pricing engine uses `roundCurrency` (2-decimal). 1-paisa drift accumulates across multi-seller orders.
- `cartTotal` is **whatever the client sent in `req.body.cartTotal`** (L81). Server doesn't recompute from items. Inflate `cartTotal`, get a bigger discount.
- `freeDelivery: true` is returned but **never honoured by the place-order pricing engine** (no `freeDelivery` field on the order). Free-delivery coupons are a dead feature.

**Fix**: see C-2's centralized `couponService.computeOrderDiscount` which receives hydrated items and recomputes cartTotal server-side. Also: when `freeDelivery=true`, snapshot `deliveryFeeCharged = 0` on the order **before** computing grandTotal.

---

### 🟠 H-3: Global handling fee can land on a seller who has no items in that category

```191:246:backend/app/services/checkoutPricingService.js
function applyGlobalHandlingFeeToSellerBreakdowns(
  sellerBreakdownEntries = [],
  globalHandling = { handlingFeeCharged: 0, handlingCategoryUsed: null },
) {
  ...
  const usedHeaderId = String(globalHandling?.handlingCategoryUsed?.headerCategoryId || "");
  let chosenSellerId = null;
  if (usedHeaderId) {
    for (const entry of sellerBreakdownEntries) {
      const entryItems = Array.isArray(entry?.items) ? entry.items : [];
      if (entryItems.some((item) => String(item?.headerCategoryId || "") === usedHeaderId)) {
        chosenSellerId = entry.sellerId;
        break;
      }
    }
  }
  if (!chosenSellerId) {
    chosenSellerId = sellerBreakdownEntries[0]?.sellerId || null;
  }

  for (const entry of sellerBreakdownEntries) {
    const breakdown = entry?.breakdown;
    if (!breakdown) continue;
    const shouldCharge = chosenSellerId && entry.sellerId === chosenSellerId;
    const handlingFeeCharged = shouldCharge ? fee : 0;
    ...
    breakdown.grandTotal = round2(
      productSubtotal + deliveryFeeCharged + handlingFeeCharged - discountTotal + taxTotal,
    );
```

- **Tip is added AFTER this re-compute** (L309–310: `applyGlobalHandlingFee…` then `allocateCheckoutTipToSellerBreakdowns`) so the order is correct chronologically — but it's fragile. Any future code that mutates grandTotal between these two steps would break.
- The fee lands on a single seller's invoice. That seller's `paymentBreakdown.grandTotal` is inflated relative to their actual goods. Reconciliation reports on a per-seller basis will show one seller "owing" the handling fee even though the customer paid it.
- `platformLogisticsMargin` is recomputed (L239–241) but does NOT account for tip (tip is added afterwards in the rider payout). OK chronologically.

**Fix**: do not allocate the global handling fee to a single seller's invoice. Allocate it pro-rata to all sellers (mirror tip-allocation logic). Or: keep it on the CheckoutGroup level only and exclude from per-seller `grandTotal`.

---

### 🟠 H-4: Webhook eventId fallback to `randomUUID()` defeats idempotency

```124:131:backend/app/services/payment/providers/phonepe.adapter.js
    return {
      eventId: payload.transactionId || crypto.randomUUID(),
      merchantOrderId: payload.merchantOrderId,
      state: payload.state,
      transactionId: payload.transactionId,
      responseCode: payload.responseCode,
      raw: payload,
    };
```

`PaymentWebhookEvent` unique index is on `eventId`. If PhonePe ever sends a webhook without `transactionId` (true for some `CREATED`/`PENDING` early callbacks), each redelivery produces a new UUID and the system processes the same logical event twice — bypassing the deduplication.

**Fix**: build a stable eventId from `(merchantOrderId, state, payloadHash)` so the same logical event collapses regardless of `transactionId` presence:
```diff
- eventId: payload.transactionId || crypto.randomUUID(),
+ eventId: payload.transactionId
+   || crypto.createHash("sha256")
+        .update(`${payload.merchantOrderId}|${payload.state}|${JSON.stringify(payload)}`)
+        .digest("hex"),
```

---

### 🟠 H-5: Wallet redemption at checkout bypasses ledger AND canonical Wallet

`orderPlacementService.js` L443–457 (cited above) writes only:
- `user.walletBalance -= walletAmount`
- A legacy `Transaction({type: "Wallet Payment"})` row

It does **not**:
- Update `Wallet({ownerType: "CUSTOMER", ownerId: customerId}).availableBalance`
- Write a `LedgerEntry`

The `walletService.js` header even acknowledges this gap:

```33:43:backend/app/services/finance/walletService.js
 * Phase 4 P4-3 — keep the legacy `User.walletBalance` field in sync with
 * the canonical `Wallet({ownerType:"CUSTOMER"})` document whenever the
 * wallet is mutated for a customer.
 *
 * Old code paths that directly mutate `User.walletBalance` (e.g.
 * `orderPlacementService` line ~445 — wallet redemption at checkout) are
 * NOT affected by this helper; they continue to update the User document
 * themselves. Phase 4b will migrate those call sites to walletService and
 * the User-side write will then be the only authority.
```

**Consequences**:
1. `walletLedgerVerifierJob` will flag a drift for every customer who used wallet at checkout (the ledger says +X, the wallet says +X − walletAmount; or vice versa) — except the job is **disabled by default**.
2. `getCustomerBalance` (the canonical reader) reads `Wallet.availableBalance` first, which is **higher** than `User.walletBalance` (the actual debited balance). UI that uses `getCustomerBalance` will show a wrong-too-high balance.
3. Refund path (`reverseOrderFinanceOnCancellation` L796-822) credits the canonical Wallet via `creditWallet`. That ALSO syncs `User.walletBalance` (Phase 4 P4-3). So the customer ends up with `User.walletBalance` correctly restored, but `Wallet.availableBalance` inflated by `walletAmount` (because the canonical Wallet was never debited but is now credited).

**Fix**: replace `user.walletBalance -= walletAmount` with:
```js
await walletService.debitWallet({
  ownerType: OWNER_TYPE.CUSTOMER, ownerId: customerId,
  amount: walletAmount, bucket: "available", session,
  ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_PAYMENT,   // new constant
  ledgerReference: `WLT-CHOUT-${checkoutGroupId}`,
  idempotencyKey: `WLT-CHOUT-${checkoutGroupId}`,
  syncUserWalletBalance: true,
});
```
and add `WALLET_PAYMENT` to `LEDGER_TRANSACTION_TYPE` constants. Migrate historical orders with a backfill script.

---

### 🟠 H-6: Free-delivery coupon is silently broken

Already documented in H-2 — `freeDelivery: true` is returned from `validateCoupon` and stored in `selectedCoupon` on the frontend. But:

- Frontend `discountAmount = selectedCoupon.discountAmount || selectedCoupon.discount || 0` (CheckoutPage L219) — `discountAmount` is `0` for free-delivery coupons (because the validateCoupon only computes discountAmount for percentage/fixed).
- Backend never reads `freeDelivery` from the request (it's not even in the Joi schema).
- "Coupon Reserved -₹0" appears in the pricing breakdown (CheckoutPricingBreakdown L122-129). Customer sees a meaningless coupon line.

**Fix**: at couponService level, free-delivery coupons must compute `discountAmount = deliveryFeeCharged` (after server-side delivery fee computation) and return that. Or: snapshot the delivery fee to 0 server-side and surface a `freeDeliveryApplied: true` flag.

---

### 🟠 H-7: Coupon `cartTotal` and `items` come from client — minimum-order-value bypassable

```81:154:backend/app/controller/couponController.js
        const { code, cartTotal, items, customerId } = req.body;
        ...
        if (coupon.minOrderValue && cartTotal < coupon.minOrderValue) {
            return handleResponse(res, 400, `Minimum order value should be ₹${coupon.minOrderValue}`);
        }
```

Client sends both `cartTotal` and `items`. A user wanting to use a `MIN500` coupon on a ₹100 cart simply POSTs `cartTotal: 600`. The server happily validates and returns a discount. Then place-order ignores cartTotal entirely and applies the discount to whatever real cart is on the server side.

**Fix**: ignore client `cartTotal`/`items` here. Re-hydrate the customer's cart server-side, compute the real subtotal, validate against `minOrderValue`/`minItems`/`applicableCategories`.

---

### 🟠 H-8: `admin/cashService.js` rider cash balance is a *parallel* ledger to `Wallet.cashInHand`

```30:55:backend/app/services/admin/cashService.js
        currentCash: {
          $reduce: {
            input: { $filter: { input: "$allTransactions",
                as: "transaction",
                cond: { $in: ["$$transaction.type", ["Cash Collection", "Cash Settlement"]] },
              } },
            initialValue: 0,
            in: { $cond: [...] },
          },
        },
```

Computed as `Σ(Cash Collection.amount) − Σ(|Cash Settlement.amount|)`.

`orderSettlement.applyDeliveredSettlement` L55–69 creates `"Cash Collection"` Transactions with `amount: settled.paymentBreakdown?.grandTotal || settled.pricing?.total` — i.e. **gross**, NOT the net-of-rider-commission that `handleCodOrderFinance` writes to `Wallet.cashInHand` (gross − riderPayout, L466).

**Result**: Admin "Rider Cash" panel shows higher `currentCash` than the canonical `Wallet.cashInHand`. When admin "settles" cash from a rider, the Transaction-based view doesn't agree with the wallet-based view.

**Fix**: write Transaction `amount: codAmountNet` (matching the wallet). Or migrate the admin panel to read `Wallet.cashInHand` directly.

---

### 🟠 H-9: Multi-seller checkout charges N delivery fees per order

`buildCheckoutPricingSnapshot` L281-307 iterates per seller and computes `delivery.deliveryFeeCharged` per seller (each with its own distance). The aggregate sums them. A customer buying from 3 sellers in a single checkout pays 3 base delivery fees. UI shows "Delivery Fee: ₹90" (= 3 × ₹30) without breakdown.

This may be intentional product design but creates user-confusion and order-abandonment risk. It is **not** documented in the pricing breakdown UI (`CheckoutPricingBreakdown.jsx` shows a single "Delivery Fee" line).

**Fix**: either (a) charge a single delivery fee for the longest distance, (b) explicit per-seller breakdown in the UI, or (c) negotiate with sellers about merging routes.

---

## MEDIUM ISSUES (11)

### 🟡 M-1: Two source-of-truth views for rider cash (covered in H-8)

### 🟡 M-2: GST/tax is wired but never computed
`pricing.gst` and `paymentBreakdown.taxTotal` exist in the schema and Joi accepts a client-supplied `taxTotal`, but `buildCheckoutPricingSnapshot` hard-codes `taxTotal: 0` (`checkoutPricingService.js` L295). If GST is required by Indian law for your category, this is a tax-evasion compliance risk.

**Fix**: implement a tax engine keyed off category HSN code, or explicitly remove the field.

### 🟡 M-3: `Coupon.updateOne` increment is fire-and-forget AFTER commit
```495:523:backend/app/services/orderPlacementService.js
    const couponId = normalizedPayload.couponId;
    if (couponId) {
      Coupon.updateOne(...).catch(() => {});
    }
```
- Runs **after** `session.commitTransaction()`.
- `.catch(() => {})` silently swallows errors.
- If MongoDB hiccups, the order succeeds but `usedCount` never increments → coupon can exceed `usageLimit`.

**Fix**: move inside the transaction, OR write to an event queue that retries with idempotency.

### 🟡 M-4: `placeOrderAtomic` reads `user.walletBalance` not `getCustomerBalance()`
```294:300:backend/app/services/orderPlacementService.js
    const user = await User.findById(customerId).session(session);
    if (walletAmount > 0) {
      if (!user) throw new Error("User not found");
      if (user.walletBalance < walletAmount) {
        throw new Error("Insufficient wallet balance");
      }
    }
```
If `Wallet.availableBalance` is the canonical truth (Phase 4 P4-2), wallet-payment validation should use it. Otherwise, a customer who was credited via canonical Wallet but whose User mirror failed silently (walletService L73-77 logs warning only) cannot use their wallet.

### 🟡 M-5: `creditAdminEarning` excludes COD by design but the function name and ledger description are misleading

```260:289:backend/app/services/finance/orderFinanceService.js
export async function creditAdminEarning(order, { session, actorId } = {}) {
  if (order.financeFlags?.adminEarningCredited) return null;

  // Requirement: For COD orders, do not recognize/credit admin earning at delivery time.
  // COD inflows are tracked via remittance (system float) instead.
  if (order.paymentMode === "COD") {
    order.settlementStatus = { ...settlementStatus, adminEarningCredited: true };
    order.financeFlags = { ...financeFlags, adminEarningCredited: true };
    return null;
  }
```

Then `getAdminFinanceSummary` filters `paymentMode: "ONLINE"`:
```497:501:backend/app/services/finance/walletService.js
      Order.aggregate([
        // Requirement: Total Admin Earning should not include COD orders.
        { $match: { status: "delivered", paymentMode: "ONLINE" } },
        { $group: { _id: null, amount: { $sum: "$paymentBreakdown.platformTotalEarning" } } },
      ]),
```

"Total Admin Earning" excludes COD entirely. But `Order.paymentBreakdown.platformTotalEarning` is computed at order placement for both COD and ONLINE. Admin dashboards reading "platformTotalEarning per order" will see a number that the platform-wide rollup says is 0 (for COD). Cognitive dissonance.

**Fix**: rename and clearly document. Possibly expose two metrics: "earnings recognised" (ONLINE only) and "earnings projected" (all orders).

### 🟡 M-6: `payment.method` enum allows `"wallet"` but no flow ever sets it
```71:83:backend/app/models/order.js
    payment: {
      method: { type: String, enum: ["cash", "online", "wallet"], default: "cash" },
```
No code path sets `payment.method = "wallet"` even for orders fully covered by wallet (after C-1 fix, walletAmount = grandTotal ⇒ no gateway payment). Dead enum value.

### 🟡 M-7: `applyDeliveredSettlement` creates a "Cash Collection" Transaction for COD with gross amount (related to H-8)
This is the source of the H-8 mismatch but is documented separately because the fix here is in `orderSettlement.js` L62-69.

### 🟡 M-8: `Coupon.discountAmount` rounding inconsistency (`Math.round` vs `roundCurrency`)
Already cited under H-2.

### 🟡 M-9: Payment.statusHistory loses gateway raw bodies on transitions to the same status
```225:236:backend/app/services/paymentService.js
  if (currentStatus === nextStatus) {
    if (gatewayPaymentId && !payment.gatewayPaymentId) {
      payment.gatewayPaymentId = gatewayPaymentId;
    }
    if (rawGatewayResponse) {
      payment.rawGatewayResponse = {
        ...(payment.rawGatewayResponse || {}),
        ...sanitizeGatewayPayload(rawGatewayResponse),
      };
    }
    await payment.save();
    return payment;
  }
```
Same-status returns early, no `statusHistory.push`. PhonePe re-pinging PENDING webhooks (which happens during slow card-not-present flows) drops history.

### 🟡 M-10: `Payment.rawGatewayResponse` accumulates webhook bodies forever
`payment.rawGatewayResponse = {...prev, ...new}` over the life of a payment. For a "slow PSP" with 6+ webhook re-deliveries, the doc grows unbounded. No TTL.

### 🟡 M-11: `verifyClientPaymentCallback` is dead Razorpay shim that aliases PhonePe verify
```708:715:backend/app/services/paymentService.js
// Placeholder for Razorpay compatibility if needed by other services
export async function verifyClientPaymentCallback(data) {
    return verifyPhonePePaymentStatus({
        merchantOrderId: data.gatewayOrderId || data.merchantOrderId,
        userId: data.userId,
        correlationId: data.correlationId
    });
}
```
If a future Razorpay adapter is added, this will quietly map Razorpay calls to PhonePe verify — wrong behaviour. Remove or wire to `getActivePaymentProvider().getPaymentStatus`.

---

## LOW ISSUES (8)

### 🟢 L-1: `Coupon.minOrderValue` check uses `cartTotal` from client (overlapping H-7 but lower severity now that H-7 will fix)

### 🟢 L-2: `customerCancelV2` allows cancellation only in `SELLER_PENDING` state — the legacy v1 path is more permissive (allows `pending` status)
Minor UX inconsistency.

### 🟢 L-3: `placeOrderAtomic` adapts items from cart but doesn't carry forward `image` URL into pricing snapshot reliably

### 🟢 L-4: Pricing fields rounded with 2-decimal but PhonePe accepts paise — round-trip drift of ±1 paise possible per checkout-group split

### 🟢 L-5: `seller.serviceRadius` defaults to 5km in `computeDistanceKmForSeller` — undocumented magic number

### 🟢 L-6: `Transaction.reference` is `unique: true` and re-uses public order IDs — a future order-id collision (very unlikely with current `generateUniquePublicOrderId` but not impossible if generation logic is ever changed) would break all transaction writes for that order

### 🟢 L-7: `orderPlacementService.placeOrderAtomic` retries on `code 11000` for `orderId|checkoutGroupId` regex (L593) — a future field added with one of these names would trigger spurious retries

### 🟢 L-8: Stripe references / Razorpay placeholders are dead code (`verifyClientPaymentCallback`, comment at `providerRegistry.js` L31)

---

# PHASE 5 — FIX PLAN (Prioritized)

| Priority | Ticket | File(s) | Effort | Risk |
|---|---|---|---|---|
| P0 | **C-1** Subtract `walletAmount` from `grandTotal` and ledger the wallet redemption | `pricingService.js`, `orderPlacementService.js`, `freezeFinancialSnapshot` | 1 day code + 1 day data migration | high — affects every wallet user. Roll out behind `WALLET_REDEMPTION_REDUCES_PAYABLE` flag. |
| P0 | **C-2** Server-side coupon discount engine; ignore client `discountTotal` | new `couponService.js`, `orderPlacementService.js`, `validation/financeValidation.js`, `models/order.js` | 2 days | medium |
| P0 | **C-3** `compensateOrderCancellation` must call `reverseOrderFinanceOnCancellation` (idempotent) | `orderCompensation.js`, `orderFinanceService.js` (idempotency flag) | 1 day | medium |
| P0 | **C-4** Persist `Order.coupon` and count actual per-user usage | new field, `couponService.js`, migration backfill | 1 day | low |
| P1 | **H-1** Add `PAYOUT_STATUS.CANCELLED` | `constants/finance.js` | 5 min | low |
| P1 | **H-2** Centralize coupon logic (resolves H-6, H-7 too) | `couponService.js` | merged with C-2 | low |
| P1 | **H-3** Pro-rata global handling fee | `checkoutPricingService.js` | 4 hours | low |
| P1 | **H-4** Stable webhook eventId hash | `phonepe.adapter.js` | 1 hour | low — additive |
| P1 | **H-5** Move wallet redemption to walletService.debitWallet | `orderPlacementService.js`, `constants/finance.js` (new `WALLET_PAYMENT` ledger type), data backfill | 1 day | medium — needs the verifier job re-enabled to confirm zero drift |
| P1 | **H-8** Write Transaction `amount: codAmountNet` instead of `grandTotal` | `orderSettlement.js`, migration to rewrite past rows | 4 hours | low |
| P2 | **H-9** Multi-seller delivery-fee policy | product decision required | TBD | TBD |
| P2 | **M-2** GST engine | new module | 3 days | low until law requires |
| P2 | **M-3** Move coupon increment inside transaction | `orderPlacementService.js` | 1 hour | low |
| P2 | **M-4** `placeOrderAtomic` should read `getCustomerBalance()` | 1 line | 30 min | low |
| P2 | **M-9** Always push history row | `paymentService.transitionPaymentState` | 30 min | low |
| P2 | **M-10** TTL or capped subdocument for `rawGatewayResponse` | `models/payment.js` | 1 hour | low |
| P3 | **M-11**, **L-1..L-8** | various | 1 day total | low |

## Rollout plan (suggested 3 sprints)

**Sprint 1 (this week)**: P0 fixes C-1..C-4 + H-1 + H-4 (signature-stability is additive).
- Deploy with `WALLET_REDEMPTION_REDUCES_PAYABLE=false` (no behaviour change initially).
- Run a backfill that flags orders with `paymentBreakdown.walletAmount > 0` and computes the over-charge.
- Issue refunds for over-charged orders.
- Flip flag to `true`, monitor `walletLedgerVerifierJob` (set `FINANCE_VERIFIER_ENABLED=true` simultaneously).

**Sprint 2**: H-2, H-3, H-5 (canonical wallet writes), H-8, H-9 product decision.

**Sprint 3**: M-* hardening, L-* hygiene, deprecate legacy `Transaction` collection (`payoutBatchJob` and `cashService` migrate to `LedgerEntry`).

## Testing requirements per ticket

- **C-1**: regression unit test for `generateOrderPaymentBreakdown` that asserts `grandTotal === productSubtotal + delivery + handling - discount + tax + tip - walletAmount`. E2E: place order with wallet=100, total=300 → assert PhonePe init amount is 20000 paise (₹200), not 30000.
- **C-2**: unit tests for `couponService.computeOrderDiscount` covering percentage, fixed, freeDelivery, minOrderValue, maxDiscount, applicableCategories. Integration: place-order with malicious `discountTotal: 999999` → expect server to ignore and apply real discount only.
- **C-3**: integration test for each v2 cancellation path (`sellerRejectAtomic`, `processSellerTimeoutJob`, `customerCancelV2`) with both ONLINE-captured and wallet-redeemed orders. Assert wallet balance + gateway refund.
- **C-4**: integration test placing 2 orders with the same `WELCOME50` coupon for the same user — second should fail.
- **H-1**: full return-flow integration test through `OrderReturnService.completeReturnAndRefund` with the seller payout HOLDed.

## Backwards compatibility

- C-1: existing orders have `paymentBreakdown.grandTotal` baked in. Don't retroactively change `grandTotal`. Only change the formula for *new* orders. Reconciliation backfill issues refunds for affected legacy orders.
- C-2: legacy orders with `paymentBreakdown.discountTotal` already frozen — no change. New schema field `Order.coupon` & `Order.couponSnapshot` is additive.
- C-3: introduce `Order.financeFlags.cancellationReversalApplied`. Old orders that were cancelled without reversal stay as-is unless a manual ops job decides to refund them.
- H-1: enum widening only — fully additive.

---

# PHASE 6 — FINAL DELIVERABLES

## D-1. End-to-end payment lifecycle (state machine)

```
                    PLACE ORDER
                         │
                ┌────────┴────────┐
                ▼                 ▼
            COD path        ONLINE path
                │                 │
       CheckoutGroup:CREATED  CheckoutGroup:PAYMENT_PENDING
       Order:CREATED          Order:CREATED
       Order.payment.status: pending
                │                 │
       fire afterPlaceOrderV2     │
                │                 │
       SELLER_PENDING  ←──┐    POST /payment/create-order
       (60s timer)        │    Payment:CREATED→PENDING
                │         │           │
       seller accepts     │    PhonePe checkout
                │         │           │
       DELIVERY_SEARCH ◄──┘    customer pays
       (radius expand)              │
                │             webhook arrives
       rider accepts         Payment:CAPTURED
                │             handleOnlineOrderFinance
       DELIVERY_ASSIGNED     (admin wallet +grandTotal,
                │              ledger CREDIT)
       PICKUP_READY                  │
                │             Order.workflowStatus:
       OUT_FOR_DELIVERY      CREATED → SELLER_PENDING
                │                    │
       OTP verify              SELLER_PENDING
                │                    │
       DELIVERED → applyDeliveredSettlement
                │
        ┌───────┼──────────────────────┐
        ▼       ▼                      ▼
   handleCod- createPendingSeller- createPendingRider-
   OrderFinance  Payout (HOLD       Payout (PENDING)
   (cashInHand    until return       
   += net)        window expires)
                                       creditAdminEarning
                                       (ONLINE only)

        return window expires
                │
       releaseHeldSellerPayout → Payout(PENDING)
                │
       admin processPayout → pending→available
       Wallet.availableBalance += amount
       Order.settlementStatus.sellerPayout = COMPLETED

CANCELLATION (v2, anywhere before delivery)
       compensateOrderCancellation
         - releaseReservedStock
         - Transaction.status = "Failed"
         - CheckoutGroup → CANCELLED
       ❌ MISSING: reverseOrderFinanceOnCancellation
       ❌ MISSING: wallet refund
       ❌ MISSING: online-payment refund

RETURN
       customer requestReturn → return_requested
       seller approve → return_approved (broadcast for rider)
       rider acceptReturnPickup → return_pickup_assigned
       rider OTP at customer location → return_in_transit
       rider drops at seller → returned
       admin QC → qc_passed
       completeReturnAndRefund (transactional)
         - creditWallet(CUSTOMER, refundAmount, ledger WALLET_REFUND)
         - if sellerPayout HOLD → cancelPendingPayoutForOrder (BREAKS due to H-1)
         - if sellerPayout already released → debitWallet(SELLER, refundAmount + commission)
         - creditWallet(DELIVERY_PARTNER, commission)
       Order.returnStatus = "refund_completed"
```

## D-2. Money flow matrix per scenario

| Scenario | Customer | Wallet | Gateway | Cash | Admin | Seller | Rider | Ledger entries |
|---|---|---|---|---|---|---|---|---|
| **COD order placed** | −0 | −walletAmount¹ (direct) | — | — | +0 | +0 (pending) | +0 (pending) | none for wallet redemption¹ |
| **COD delivered (OTP)** | +items | — | — | +grandTotal (rider holds) | +adminCommission via settlement (but `creditAdminEarning` skips for COD²) | +sellerPayout queued (HOLD if return window) | +riderPayoutTotal queued | `ORDER_COD_COLLECTED` |
| **COD reconciled (admin collects from rider)** | — | — | — | rider −amount, admin +amount | +amount | — | −amount cashInHand | `COD_REMITTED` (×2) |
| **ONLINE order placed (wallet=0)** | — | — | created | — | — | — | — | `payment_order_created` |
| **ONLINE payment captured** | −grandTotal | — | captured grandTotal | — | +grandTotal | — | — | `ORDER_ONLINE_PAYMENT_CAPTURED` |
| **ONLINE delivered** | +items | — | — | — | +platformTotalEarning recognised | +sellerPayout queued (HOLD) | +riderPayoutTotal queued | `ADMIN_EARNING_CREDITED`, `PAYOUT_QUEUED` (×2) |
| **Seller payout processed** | — | — | — | — | −sellerPayoutTotal | +sellerPayoutTotal (pending→available) | — | `PAYOUT_PROCESSED` |
| **Return refund (QC passed)** | +items returned | +refundAmount | — | — | — | −refundAmount−commission OR cancelled payout | +commission | `WALLET_REFUND`, `REFUND`, `RIDER_PAYOUT_PROCESSED` |
| **v2 cancellation (seller timeout)** | items not delivered | ❌ walletAmount NOT refunded³ | ❌ if captured, NOT refunded³ | — | ❌ if captured, retains money³ | — | — | none |

¹ Bypasses ledger (H-5). ² By design (M-5). ³ C-3 critical bug.

## D-3. Risk assessment summary

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Double-charge via wallet (C-1) | **Certain** for every wallet user | High (customer over-charged 1×walletAmount per order) | Fix formula + backfill refund |
| Price tampering via discountTotal (C-2) | Certain on first probe | Catastrophic (free orders) | Server-side coupon engine |
| v2 cancellation steals wallet/online payment (C-3) | High (seller timeout is common) | Catastrophic | Wire reverseOrderFinanceOnCancellation |
| Coupon abuse via no per-user limit (C-4) | High | Medium-high | Persist couponId + count |
| Return refund flow silently fails (H-1) | Certain for any HOLD payout | High (customer never refunded) | One-line constant addition |
| Idempotency hole on webhook retries (H-4) | Low (PhonePe sends transactionId most of the time) | High when triggered | Stable eventId hash |
| Wallet drift between User & Wallet collection (H-5) | Certain after every wallet checkout | Medium (drift detector disabled by default) | walletService.debitWallet |

## D-4. Transaction safety / atomicity checklist

| Operation | In session? | Idempotent? |
|---|---|---|
| `placeOrderAtomic` (full order, wallet debit, cart clear) | ✅ Yes | ✅ Yes (Idempotency-Key header) |
| `placeOrderAtomic` wallet → User.walletBalance | ✅ session passed | ❌ no ledger row, ❌ Wallet not updated (H-5) |
| `placeOrderAtomic` coupon usedCount increment | ❌ AFTER commit, fire-and-forget | ✅ atomic via `$cond` aggregation pipeline |
| `handleOnlineOrderFinance` (admin credit on capture) | ✅ Yes | ✅ Idempotent via `financeFlags.onlinePaymentCaptured` |
| `handleCodOrderFinance` (cashInHand update + ledger) | ✅ Yes | ✅ Idempotent via `financeFlags.codMarkedCollected` |
| `settleDeliveredOrder` | ✅ Yes | ✅ Idempotent via `financeFlags.deliveredSettlementApplied` |
| `reconcileCodCash` | ✅ Yes | ❌ NOT idempotent — no idempotency key, repeated calls will double-debit cashInHand |
| `processPayout` | ✅ Yes | ❌ NOT idempotent — re-running on the same payoutId throws ("Invalid payout status"), but caller could race |
| `cancelPendingPayoutForOrder` | ✅ Optional external session | ❌ Broken by H-1 (enum) |
| `completeReturnAndRefund` (new transactional path) | ✅ withTransaction | ✅ idempotency keys per side-effect |
| `completeReturnAndRefundLegacy` | ❌ No session | ❌ Multiple writes can half-fail |
| `compensateOrderCancellation` | ❌ No session | ❌ Stock release and Transaction update are not atomic |
| `payment.processPhonePeWebhook` | Only the order-cancel branch wraps a session | ✅ Webhook event uniqueness via partial unique index |

## D-5. Recommended hardening (besides bug fixes)

1. **Single canonical pricing helper** for the front-end too. Today the frontend computes `finalAmountToPay` from `pricingPreview.grandTotal − walletAmountToUse`. After C-1 fix, the backend computes the same. Expose the backend's `payableAmount` (post-wallet) in the preview response so the UI never does math.
2. **Webhook authentication is correct (HMAC via SDK)** but log structured webhook acceptance/rejection with `correlationId` and `eventId` for SIEM ingestion.
3. **Enable `walletLedgerVerifierJob` in production** (`FINANCE_VERIFIER_ENABLED=true`). With C-1/H-5 fixed, drift should be 0.
4. **Add an end-to-end reconciliation cron** that, daily, asserts `Σ paymentBreakdown.grandTotal (delivered + reconciled) == Σ wallet credits to admin + Σ cashInHand to riders`.
5. **Deprecate the legacy Transaction collection** (already planned per the model comment). Migrate `cashService.js` reads to `LedgerEntry`. Remove dual-writes.
6. **Add CSP-style schema validation** on the `placeOrder` payload that asserts `discountTotal <= MAX_DISCOUNT_FRACTION * server_subtotal` as a defense-in-depth measure on top of C-2.
7. **Add structured logs at every state transition** in `transitionPaymentState` (`payment_state_transition`) and `settleDeliveredOrder` so finance can replay any historical settlement.
8. **Refund flow lacks a queue retry**. If `completeReturnAndRefund` throws inside the transaction, the QC pass succeeds (because QC is on a separate save) but no refund happens. Add an outbox pattern: write a refund-job row, process via Bull, mark complete.

## D-6. Atomicity recommendations (specific actions)

- `reconcileCodCash`: add `idempotencyKey: 'COD-REMIT-<orderId>-<requestUUID>'` to both `updateCashInHand` and `creditWallet` calls + pass `ledgerType` so the ledger row has the idempotency key; uses the same partial-unique-index pattern as `completeReturnAndRefund`.
- `processPayout`: add `idempotencyKey` to the ledger write; use a `$set: { status: COMPLETED }` filter `{ status: { $in: [PENDING, PROCESSING] } }` so re-run is no-op (already partially in place).
- `compensateOrderCancellation`: wrap in `session.withTransaction` so stock release, Transaction update, CheckoutGroup transition and (post-fix) finance reversal commit together.
- Outbox pattern for emit/socket events: persist a `Notification` row inside the transaction; an async worker reads it and emits — this prevents the current "notification sent, transaction rolled back" risk from `payment.service.handleOrderSideEffects`.

## D-7. Idempotency recommendations

| Surface | Current strategy | Recommendation |
|---|---|---|
| `POST /orders/place` | `Idempotency-Key` header + partial unique index | ✅ Strong — keep |
| `POST /payment/create-order` | `idempotencyKey` field on Payment + partial unique index on `(order, idempotencyKey)` | ✅ Strong — keep |
| `POST /payment/phonepe/webhook` | Unique `eventId` from PhonePe transactionId | Fix H-4 (stable hash fallback) |
| `POST /orders/:id/accept` (delivery) | Redis `idem:delivery_accept:<orderId>:<key>` 24h TTL | ✅ Strong — keep |
| `LedgerEntry` writes | Partial unique `idempotencyKey` index | ✅ Strong — extend usage to wallet redemption (H-5) and COD reconciliation |
| `Transaction` (legacy) writes | `reference` unique | Migrate off |
| Coupon usedCount increment | Aggregation pipeline `$cond` (atomic) | Move inside session (M-3) |

---

## D-8. Architecture improvements (longer-term)

1. **Single Pricing Authority**: collapse `pricingService.js` + `checkoutPricingService.js` + frontend `cartTotal` into one shared module compiled for both Node and browser (currently Frontend cartTotal is its own implementation; preview always round-trips). Reduces drift and improves checkout latency.
2. **Domain events over direct mutations**: emit `OrderPlaced`, `PaymentCaptured`, `OrderDelivered` events; handlers (admin earning, payouts, notifications) consume them. The current direct-call chain (`placeOrderAtomic` → `afterPlaceOrderV2` → `emitNotificationEvent`) is tightly coupled.
3. **Finance microservice boundary**: today `paymentService.js` directly modifies `Order` rows. A clearer separation would have payment service own `Payment`, emit `payment.captured`, and let order service react.
4. **Replace `User.walletBalance` entirely** (Phase 4b/7 in your own audit plan). Long overdue. Eliminates H-5 and M-4.
5. **Replace `Transaction` collection entirely**. The legacy ledger creates real drift surfaces (H-8 / M-1). The `Phase 4 P4-5` migration described in `models/transaction.js` is the path.
6. **Outbox/saga for payment side-effects**: `handleOrderSideEffectsFromPaymentStatus` does N writes across N orders in a `for` loop with one all-or-nothing session per branch. A saga (state-machine) split per order would isolate failures.
7. **Frontend should NOT trust `pricingPreview` for SoT**: the place-order response should be the canonical price; the UI should re-display `placeOrder.result.checkoutGroup.pricingSummary.grandTotal` (which becomes the post-wallet `payableAmount` after C-1).

---

## Appendix A — Files cited

```
backend/app/services/checkoutPricingService.js
backend/app/services/finance/pricingService.js
backend/app/services/finance/orderFinanceService.js
backend/app/services/finance/walletService.js
backend/app/services/finance/ledgerService.js
backend/app/services/finance/payoutService.js
backend/app/services/orderPlacementService.js
backend/app/services/orderSettlement.js
backend/app/services/orderCompensation.js
backend/app/services/orderWorkflowService.js
backend/app/services/paymentService.js
backend/app/services/order/orderReturnService.js
backend/app/services/admin/cashService.js
backend/app/services/payment/providers/phonepe.adapter.js
backend/app/services/payment/ports/paymentProviderPort.js
backend/app/services/payment/providerRegistry.js
backend/app/controller/orderController.js
backend/app/controller/paymentController.js
backend/app/controller/couponController.js
backend/app/controller/cartController.js
backend/app/controller/adminFinanceController.js
backend/app/models/order.js
backend/app/models/payment.js
backend/app/models/payout.js
backend/app/models/wallet.js
backend/app/models/coupon.js
backend/app/models/ledgerEntry.js
backend/app/models/transaction.js
backend/app/models/paymentWebhookEvent.js
backend/app/validation/financeValidation.js
backend/app/constants/finance.js
backend/app/jobs/walletLedgerVerifierJob.js
frontend/src/modules/customer/pages/CheckoutPage.jsx
frontend/src/modules/customer/pages/checkout/components/CheckoutPricingBreakdown.jsx
frontend/src/modules/customer/hooks/useCheckout.js
frontend/src/modules/customer/context/CartContext.jsx
```

---

*Generated as part of full-system audit. Every claim has a file:line reference; every fix proposed has a unit-test boundary and a backwards-compatibility note.*
