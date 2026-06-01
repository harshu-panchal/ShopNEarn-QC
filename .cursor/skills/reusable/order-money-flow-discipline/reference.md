# Order Money Flow — Reference

Companion to `SKILL.md`. Read on demand when looking up field authority, the lifecycle state diagram, or the atomicity inventory. All references here are file + line citations from the audit performed against the codebase at the time of writing.

---

## 1. The 9 Pricing Engines (single source of truth per concern)

| # | Engine | File | Owns | Notes |
|---|---|---|---|---|
| 1 | Cart subtotal (client hint) | `frontend/src/modules/customer/context/CartContext.jsx` L309–315 | `cartTotal` (uses `salePrice` if `< price` else `price`) | UI only; never authoritative |
| 2 | Cart subtotal (server hydration) | `backend/app/services/finance/pricingService.js::calculateProductSubtotal` L104 | `productSubtotal` post server-pricing enforcement | Canonical |
| 3 | Category commission split | `pricingService.js::calculateCategoryCommission` L114–139 | `adminProductCommission`, `sellerPayout` per line | Canonical |
| 4 | Handling fee (per-seller, 4 strategies) | `pricingService.js::calculateHandlingFee` L149–217 | `handlingFeeCharged` | Canonical |
| 5 | Global handling fee override | `checkoutPricingService.js::computeGlobalHandlingFeeForCheckout` + `applyGlobalHandlingFeeToSellerBreakdowns` L162–246 | Forces a single seller to carry the cart-wide handling fee | See H-3 — flawed allocation |
| 6 | Customer delivery fee | `pricingService.js::calculateCustomerDeliveryFee` L219–272 | `deliveryFeeCharged`, distance rounding | Canonical |
| 7 | Rider payout | `pricingService.js::calculateRiderPayout` L274–308 | `riderPayoutBase/Distance/Bonus/Total` | Canonical |
| 8 | Aggregate breakdown / multi-seller | `checkoutPricingService.js::buildCheckoutPricingSnapshot` L248–323 | per-seller + aggregate `grandTotal` | Canonical |
| 9 | Coupon discount engine | `controller/couponController.js::validateCoupon` L79–212 | `discountAmount`, `freeDelivery` | **No server-side re-validation at place-order time — see C-2** |

**Engines that do not exist** (despite the schema implying so):
- No GST/tax engine. `taxTotal` is hard-coded `0` at `checkoutPricingService.js` L295.
- No surge/peak-pricing engine.
- No packaging-fee engine as a first-class concept (global handling fee doubles as packaging).

---

## 2. Field Ownership Map (Authority → Mirror → Read Sites)

> Arrows point **away from** authority. Two arrows pointing at one field = drift surface.

| Field | Authority (write) | Mirror (sync) | Read sites | Drift surface |
|---|---|---|---|---|
| `Order.paymentBreakdown.productSubtotal` | `pricingService.generateOrderPaymentBreakdown` | `Order.pricing.subtotal` via `syncLegacyPricing` | UI, settlement, dashboards | none |
| `Order.paymentBreakdown.deliveryFeeCharged` | same | `Order.pricing.deliveryFee` | UI, settlement | none |
| `Order.paymentBreakdown.handlingFeeCharged` | `applyGlobalHandlingFeeToSellerBreakdowns` overwrites per-seller value | `Order.pricing.platformFee` | UI, settlement | **H-3** — handling fee lands on "wrong" seller in multi-seller carts |
| `Order.paymentBreakdown.tipTotal` | `allocateCheckoutTipToSellerBreakdowns` (last-seller residual) | `Order.pricing.tip` | rider payout (`riderTipAmount`) | none |
| `Order.paymentBreakdown.discountTotal` | **Client payload** via Joi → `placeOrderAtomic` L316 | `Order.pricing.discount` | grandTotal subtractor | **C-2** — pricing tampering |
| `Order.paymentBreakdown.taxTotal` | Hard-coded `0` at `checkoutPricingService.js` L295 | `Order.pricing.gst` | grandTotal additive | **M-2** — dead (engine missing) |
| `Order.paymentBreakdown.grandTotal` | `pricingService.generateOrderPaymentBreakdown` L464–471: `subtotal + delivery + handling − discount + tax + tip`. **Does not subtract walletAmount.** | `Order.pricing.total` | `paymentService.getPayableAmountPaise`, `handleOnlineOrderFinance`, COD cash collection | **C-1** — wallet double-charge |
| `Order.paymentBreakdown.walletAmount` | `placeOrderAtomic` L374 (proportionate split per group) → `freezeFinancialSnapshot` L122 | `Order.pricing.walletAmount` | display only — never used to reduce payable | dead arithmetic |
| `Order.paymentBreakdown.sellerPayoutTotal` | `pricingService.generateOrderPaymentBreakdown` L431 | `CheckoutGroup.sellerBreakdown[].sellerPayout`, `Payout.amount`, `Wallet.pendingBalance` | seller dashboards | none |
| `Order.paymentBreakdown.adminProductCommissionTotal` | same | `Order.paymentBreakdown.platformTotalEarning` | admin earnings (`getAdminFinanceSummary`) | **M-5** — admin aggregation filters ONLINE only |
| `Order.paymentBreakdown.riderPayoutTotal` | `pricingService.calculateRiderPayout` + tip allocator | `Payout({type:DELIVERY_PARTNER}).amount`, `Wallet.pendingBalance` (rider) | rider app | none |
| `Order.paymentBreakdown.platformLogisticsMargin` | `applyGlobalHandlingFeeToSellerBreakdowns` L239–241 or `generateOrderPaymentBreakdown` L481 | none | finance report | none |
| `Order.paymentBreakdown.codCollectedAmount` | `handleCodOrderFinance` L478 (gross−rider, NOT gross) | `Wallet.cashInHand` (rider) | admin "System Float COD" | **M-1 / H-8** |
| `Order.paymentBreakdown.codRemittedAmount` | `reconcileCodCash` L711 | none | finance | none |
| `Order.paymentStatus` | mixed: `paymentService.transitionPaymentState`, `handleOnlineOrderFinance`, `handleCodOrderFinance`, `reconcileCodCash`, schema `pre('save')`, schema `pre('findOneAndUpdate')` | `payment.status` legacy via mirror hook | dashboards | well-mirrored |
| `Order.settlementStatus.sellerPayout` | `createPendingSellerPayout`, `processPayout`, return refund flow | `Order.financeFlags.sellerPayoutQueued/Held` | seller dashboards | **H-1** — enum mismatch |
| `Order.settlementStatus.riderPayout` | `createPendingRiderPayout`, `processPayout` | `Order.financeFlags.riderPayoutQueued` | rider dashboards | none |
| `User.walletBalance` (legacy, customer) | `orderPlacementService` direct `user.walletBalance -= walletAmount` L445 **AND** `walletService.creditWallet/debitWallet` | mirrored from `Wallet({ownerType:"CUSTOMER"})` | `orderPlacementService` validation L297, frontend `user.walletBalance` | **C-3 + H-5 dual-write drift** |
| `Wallet.availableBalance` (canonical) | `walletService.creditWallet/debitWallet` | `User.walletBalance` (one-way, soft) | `getCustomerBalance`, admin dashboards | drift from `User.walletBalance` unless every write goes through walletService |
| `Wallet.pendingBalance` | `createPendingPayoutForOrder`, `processPayout`, `cancelPendingPayoutForOrder` | `Order.settlementStatus.*Payout` | finance | **H-1 leaks pending** when payout cancel throws |
| `Wallet.cashInHand` (rider) | `updateCashInHand` (COD collect) + `reconcileCodCash` | none | admin cash dashboards | **M-1 / H-8** dual source with Transaction-derived view |
| `Coupon.usedCount` | `placeOrderAtomic` L497 (fire-and-forget, after commit) | none | usageLimit check | **M-3** atomic but per-user limit not enforced (**C-4**) |
| `Payment.status` | `paymentService.transitionPaymentState` only | none | webhook/verify | none |
| `Payment.statusHistory` | same | none | audit | **M-9** loses gateway raw on same-status transitions |
| `LedgerEntry` rows | `ledgerService.createLedgerEntry` (idempotent via partial unique index on `idempotencyKey`) | parallel mirror to legacy `Transaction` in some flows | finance audit log | parallel ledger (Transaction) is **not** dual-written for wallet redemption at checkout — see **C-3 / H-5** |

---

## 3. Shadow Ledgers (Why Drift Exists)

Three parallel "balance/event" stores plus one derived view:

1. `Wallet({available, pending, cashInHand})` — canonical balances.
2. `LedgerEntry` — canonical event log (partial idempotency by `idempotencyKey`).
3. `Transaction` — legacy event log; dual-written by return refund, COD settlement, withdrawals (`models/transaction.js` L3-19 comment).
4. `admin/cashService.js` L30-55 aggregates `Cash Collection − Cash Settlement` Transaction rows → rider `currentCash`. **Not** `Wallet.cashInHand`. (Cause of H-8.)

All new finance writes go through `walletService` + `LedgerEntry`. `Transaction` is in deprecation (skill: `legacy-field-deprecation`).

---

## 4. Order Lifecycle State Machine

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
       SELLER_PENDING            POST /payment/create-order
       (60s timer)               Payment:CREATED→PENDING
                │                       │
       seller accepts            PhonePe checkout
                │                       │
       DELIVERY_SEARCH           customer pays
       (radius expand)                 │
                │                 webhook arrives
       rider accepts             Payment:CAPTURED
                │                 handleOnlineOrderFinance
       DELIVERY_ASSIGNED         (admin wallet +grandTotal,
                │                  ledger CREDIT)
       PICKUP_READY                    │
                │                 Order.workflowStatus:
       OUT_FOR_DELIVERY          CREATED → SELLER_PENDING
                │                       │
       OTP verify                SELLER_PENDING
                │                       │
       DELIVERED → applyDeliveredSettlement
                │
        ┌───────┼──────────────────────────┐
        ▼       ▼                          ▼
   handleCod-     createPendingSeller-   createPendingRider-
   OrderFinance   Payout (HOLD until     Payout (PENDING)
   (cashInHand    return window expires)
   += net)                                creditAdminEarning
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
       ❌ MISSING (C-3): reverseOrderFinanceOnCancellation
       ❌ MISSING (C-3): wallet refund
       ❌ MISSING (C-3): online-payment refund


RETURN
       customer requestReturn → return_requested
       seller approve → return_approved (broadcast for rider)
       rider acceptReturnPickup → return_pickup_assigned
       rider OTP at customer location → return_in_transit
       rider drops at seller → returned
       admin QC → qc_passed
       completeReturnAndRefund (transactional)
         - creditWallet(CUSTOMER, refundAmount, ledger WALLET_REFUND)
         - if sellerPayout HOLD → cancelPendingPayoutForOrder (BROKEN by H-1)
         - if sellerPayout released → debitWallet(SELLER, refundAmount + commission)
         - creditWallet(DELIVERY_PARTNER, commission)
       Order.returnStatus = "refund_completed"
```

---

## 5. Money Flow Matrix Per Scenario

| Scenario | Customer | Wallet | Gateway | Cash | Admin | Seller | Rider | Ledger entries |
|---|---|---|---|---|---|---|---|---|
| **COD order placed** | −0 | −walletAmount¹ (direct) | — | — | +0 | +0 (pending) | +0 (pending) | none for wallet redemption¹ |
| **COD delivered (OTP)** | +items | — | — | +grandTotal (rider holds) | +adminCommission via settlement (`creditAdminEarning` skips for COD²) | +sellerPayout queued (HOLD if return window) | +riderPayoutTotal queued | `ORDER_COD_COLLECTED` |
| **COD reconciled (admin collects from rider)** | — | — | — | rider −amount, admin +amount | +amount | — | −amount cashInHand | `COD_REMITTED` (×2) |
| **ONLINE order placed (wallet=0)** | — | — | created | — | — | — | — | `payment_order_created` |
| **ONLINE payment captured** | −grandTotal | — | captured grandTotal | — | +grandTotal | — | — | `ORDER_ONLINE_PAYMENT_CAPTURED` |
| **ONLINE delivered** | +items | — | — | — | +platformTotalEarning recognised | +sellerPayout queued (HOLD) | +riderPayoutTotal queued | `ADMIN_EARNING_CREDITED`, `PAYOUT_QUEUED` (×2) |
| **Seller payout processed** | — | — | — | — | −sellerPayoutTotal | +sellerPayoutTotal (pending→available) | — | `PAYOUT_PROCESSED` |
| **Return refund (QC passed)** | +items returned | +refundAmount | — | — | — | −refundAmount−commission OR cancelled payout | +commission | `WALLET_REFUND`, `REFUND`, `RIDER_PAYOUT_PROCESSED` |
| **v2 cancellation (seller timeout)** | items not delivered | ❌ walletAmount NOT refunded³ | ❌ if captured, NOT refunded³ | — | ❌ if captured, retains money³ | — | — | none |

¹ Bypasses ledger (H-5). ² By design (M-5). ³ C-3 critical bug.

---

## 6. Cron / Queue / Job Inventory

| Job | File | Money-flow side-effect |
|---|---|---|
| `orderAutoCancelJob` | `app/jobs/orderAutoCancelJob.js` | Cancels stale `pending` orders → `compensateOrderCancellation` (does NOT refund wallet — see C-3) |
| `returnWindowReleaseJob` | `app/jobs/returnWindowReleaseJob.js` | Releases HELD seller payouts after return window |
| `payoutBatchJob` | `app/jobs/payoutBatchJob.js` | Bulk processes pending payouts |
| `firebaseTrackingCleanupJob` | `app/jobs/firebaseTrackingCleanupJob.js` | RTDB cleanup, no money |
| `walletLedgerVerifierJob` | `app/jobs/walletLedgerVerifierJob.js` | **Read-only** drift detector. Disabled by default (`FINANCE_VERIFIER_ENABLED=false`) |
| `orderQueueProcessors.js` | `app/queues/` | Bull processors for seller/delivery/return timeout |
| `bullJobScheduler.js` | `app/services/workflow/` | Schedules SELLER_TIMEOUT, DELIVERY_TIMEOUT, RETURN_PICKUP_TIMEOUT |

---

## 7. Transaction Safety / Atomicity Inventory

| Operation | In session? | Idempotent? |
|---|---|---|
| `placeOrderAtomic` (full order, wallet debit, cart clear) | yes | yes — `Idempotency-Key` header |
| `placeOrderAtomic` wallet → User.walletBalance | session passed | ❌ no ledger row, ❌ Wallet not updated (H-5) |
| `placeOrderAtomic` coupon usedCount increment | ❌ AFTER commit, fire-and-forget | atomic via `$cond` aggregation |
| `handleOnlineOrderFinance` (admin credit on capture) | yes | yes — `financeFlags.onlinePaymentCaptured` |
| `handleCodOrderFinance` (cashInHand update + ledger) | yes | yes — `financeFlags.codMarkedCollected` |
| `settleDeliveredOrder` | yes | yes — `financeFlags.deliveredSettlementApplied` |
| `reconcileCodCash` | yes | ❌ no idempotency key, repeats double-debit cashInHand |
| `processPayout` | yes | partial — re-running same payoutId throws but caller could race |
| `cancelPendingPayoutForOrder` | optional external session | ❌ broken by H-1 (enum mismatch) |
| `completeReturnAndRefund` (transactional) | withTransaction | yes — idempotency keys per side-effect |
| `completeReturnAndRefundLegacy` | ❌ no session | ❌ multiple writes can half-fail |
| `compensateOrderCancellation` | ❌ no session | ❌ stock release and Transaction update are not atomic |
| `paymentService.processPhonePeWebhook` | only order-cancel branch wraps a session | yes — webhook event uniqueness via partial unique index |

Target end-state: all flows in this table run inside a session with idempotency keys on every wallet/ledger write.

---

## 8. Idempotency Surface Inventory

| Surface | Current strategy | Verdict |
|---|---|---|
| `POST /orders/place` | `Idempotency-Key` header + partial unique index on `Order.placement.idempotencyKey` | Strong — keep |
| `POST /payment/create-order` | `idempotencyKey` field on Payment + partial unique index on `(order, idempotencyKey)` | Strong — keep |
| `POST /payment/phonepe/webhook` | Unique `eventId` from PhonePe `transactionId` | **Fix H-4** — stable hash fallback |
| `POST /orders/:id/accept` (delivery) | Redis `idem:delivery_accept:<orderId>:<key>` 24h TTL | Strong — keep |
| `LedgerEntry` writes | Partial unique `idempotencyKey` index | Strong — extend usage to wallet redemption (H-5) + COD reconciliation |
| `Transaction` (legacy) writes | `reference` unique | Migrate off |
| Coupon usedCount increment | Aggregation pipeline `$cond` (atomic) | Move inside session (M-3) |

---

## 9. Notification & Socket Emission Inventory

| Event | Emitter | Carries money fields? | Timing relative to transaction |
|---|---|---|---|
| `order:new` | `afterPlaceOrderV2` | `orderId`, `sellerPendingExpiresAt` only | post-commit |
| `delivery:broadcast` | `emitDeliveryBroadcastForSeller` | `preview.total` (legacy `pricing.total`) | post-commit |
| `delivery:otp:validated` | `verifyHandoffOtpAndDeliver` | none | post-commit |
| `order:status:update` | `emitOrderStatusUpdate` | workflowStatus only | post-commit |
| `PAYMENT_SUCCESS` / `NEW_ORDER` | `paymentService.handleOrderSideEffectsFromPaymentStatus` L376–388 | order summary | **emits inside forEach before `afterPlaceOrderV2` downstream resolves** — risk if `.catch` silently swallows |

Socket payloads use legacy `pricing.total`. Drift surface if `paymentBreakdown.grandTotal` is updated post-creation but `pricing.total` not re-synced. `syncLegacyPricing` (`orderFinanceService.js` L78–90) syncs only on save paths through `freezeFinancialSnapshot`. `updateOne` paths skip it.

---

## 10. Recommended Long-Term Hardening

1. **Single canonical pricing helper** for the front-end. Today `cartTotal` in `CartContext.jsx` is its own implementation; preview always round-trips. Expose `payableAmount` (post-wallet) in the preview response so the UI never does math.
2. **Webhook structured logging** with `correlationId` and `eventId` for SIEM ingestion (HMAC auth via SDK is already correct).
3. **Enable `walletLedgerVerifierJob` in production** (`FINANCE_VERIFIER_ENABLED=true`) once C-1 / H-5 are fixed; drift should be 0.
4. **Daily reconciliation cron** asserting `Σ paymentBreakdown.grandTotal (delivered + reconciled) == Σ wallet credits to admin + Σ cashInHand to riders`.
5. **Deprecate legacy `Transaction` collection** entirely (Phase 4 P4-5 in audit plan). Migrate `cashService.js` reads to `LedgerEntry`.
6. **CSP-style schema validation** asserting `discountTotal <= MAX_DISCOUNT_FRACTION * server_subtotal` as defense-in-depth on top of C-2.
7. **Outbox pattern for notifications** — persist a `Notification` row inside the transaction; async worker emits. Prevents "notification sent, transaction rolled back" risk.
8. **Refund flow queue retry** — if `completeReturnAndRefund` throws inside the transaction, QC pass succeeds (separate save) but no refund happens. Outbox row → Bull worker → mark complete.

---

## 11. Architecture Improvements (Longer-Term)

1. **Single Pricing Authority** — collapse `pricingService.js` + `checkoutPricingService.js` + frontend `cartTotal` into one shared isomorphic module.
2. **Domain events over direct mutations** — emit `OrderPlaced`, `PaymentCaptured`, `OrderDelivered`; handlers consume.
3. **Finance microservice boundary** — `paymentService` owns `Payment`, emits `payment.captured`, lets order service react.
4. **Replace `User.walletBalance` entirely** — Phase 4b/7. Eliminates H-5 and M-4.
5. **Replace `Transaction` collection entirely** — Phase 4 P4-5.
6. **Outbox/saga for payment side-effects** — split per-order in `handleOrderSideEffectsFromPaymentStatus` instead of one all-or-nothing forEach.
7. **Frontend trusts `placeOrder.result.checkoutGroup.pricingSummary.grandTotal` as canonical** — not the preview.

---

## Appendix — Files Cited

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
