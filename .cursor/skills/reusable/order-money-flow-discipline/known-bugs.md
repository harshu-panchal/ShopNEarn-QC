# Known Bugs Catalog — Order Pricing & Payment

Companion to `SKILL.md`. Read this **before** fixing or extending any pricing/payment code so you do not re-introduce a known issue or fix the same symptom twice from different angles.

Each entry has: **Severity** · **Root cause** · **File:Line** · **Repro** · **Fix sketch** · **Test boundary** · **Rollout** · **Status**.

> Status legend: **OPEN** = unfixed at last audit. **FIXED** = patch merged. **PARTIAL** = patch merged but a downstream surface still vulnerable. Update this column as you fix things.

---

## CRITICAL (P0 — merge blockers)

### C-1 · Wallet redemption double-charges the customer · **OPEN**

- **Root cause**: `grandTotal` formula does not subtract `walletAmount`, **and** `placeOrderAtomic` separately debits `User.walletBalance`. Customer pays full grandTotal via PhonePe (or in COD cash) AND loses wallet balance.
- **Files**:
  - `backend/app/services/finance/pricingService.js` L464-471 — `grandTotal = subtotal + delivery + handling − discount + tax + tip`. No walletAmount term.
  - `backend/app/services/orderPlacementService.js` L442-457 — direct `user.walletBalance -= walletAmount`.
  - `backend/app/services/paymentService.js` L195-208 — `getPayableAmountPaise` uses full `paymentBreakdown.grandTotal`.
  - `frontend/src/modules/customer/pages/CheckoutPage.jsx` L249-251 — UI shows `finalAmountToPay = grandTotal − walletAmountToUse` (correct from user POV).
- **Repro**: place ONLINE order with wallet=₹100, grandTotal=₹300 → PhonePe init amount is 30000 paise (₹300), not 20000 paise.
- **Fix**: subtract `walletAmount` from grandTotal in `generateOrderPaymentBreakdown`; route wallet redemption through `walletService.debitWallet` (see H-5); write `LedgerEntry({type: WALLET_PAYMENT, direction: DEBIT})` in the same session.
- **Test**: `expect(grandTotal).toBe(subtotal + delivery + handling − discount + tax + tip − walletAmount)`. E2E: PhonePe init payload = `(grandTotal − walletAmount) × 100`.
- **Rollout**: `WALLET_REDEMPTION_REDUCES_PAYABLE=true` (default off on legacy data, on for new orders); backfill script computes per-order over-charge and issues refunds.

---

### C-2 · Pricing tampering via client-supplied `discountTotal` · **OPEN**

- **Root cause**: Joi accepts `discountTotal: Joi.number().min(0)` with no upper bound and no relation to a real coupon document. `placeOrderAtomic` uses it verbatim.
- **Files**:
  - `backend/app/validation/financeValidation.js` L42-46 — schema accepts any discountTotal.
  - `backend/app/services/orderPlacementService.js` L312-318 — passes client `discountTotal` into pricing.
  - `backend/app/controller/couponController.js::validateCoupon` L79-212 — separate endpoint; result never re-checked at place time.
- **Repro**:
  ```bash
  curl -X POST /api/orders/place \
    -H "Authorization: Bearer <token>" \
    -d '{"address":{...},"paymentMode":"COD","items":[{product,quantity:1,price:50}],"discountTotal":9999999}'
  ```
  Server stores order with negative `grandTotal`.
- **Fix**: introduce `services/finance/couponService.js::computeOrderDiscount({couponCode, customerId, hydratedItems, session})` returning `{discountAmount, freeDelivery, couponSnapshot}`. Call from `buildCheckoutPricingSnapshot` and `placeOrderAtomic`. Persist `Order.coupon` + `Order.couponSnapshot`. Ignore client `discountTotal` entirely.
- **Test**: malicious `discountTotal: 999999` → server applies real discount; place-order with no coupon → discountTotal = 0 regardless of payload.
- **Rollout**: `SERVER_SIDE_COUPON_ENGINE=true`; new schema fields are additive.

---

### C-3 · v2 cancellations never refund wallet redemptions or online captures · **OPEN**

- **Root cause**: `compensateOrderCancellation` only releases stock and marks Transactions failed; it does NOT call `reverseOrderFinanceOnCancellation`. All v2 cancellation callers go through this chokepoint.
- **Files**:
  - `backend/app/services/orderCompensation.js` L16-58 — missing finance reversal.
  - `backend/app/controller/orderController.js` L305-316 — v2 orders early-return before the legacy reversal at L344-359.
  - Callers: `sellerRejectAtomic` L254, `processSellerTimeoutJob` L435, `processDeliveryTimeoutJob` L522, `customerCancelV2` L756, `orderAutoCancelJob`.
- **Repro**: place ONLINE order with wallet=₹100, grandTotal=₹500 → PhonePe captures ₹500 → seller times out at 60s → wallet=₹0, customer is out ₹600.
- **Fix**: at top of `compensateOrderCancellation`, call `reverseOrderFinanceOnCancellation(existing._id, {actorId, reason})`. Use `order.financeFlags.cancellationReversalApplied` for idempotency. Wrap in `session.withTransaction()`.
- **Test**: integration per v2 cancel path × {ONLINE captured, COD with walletAmount, wallet-only}. Assert wallet credit + payment refund + ledger entry.
- **Rollout**: not flagged — bug fix only; `financeFlags` field is additive.

---

### C-4 · Per-user coupon limit is hard-coded to never trigger · **OPEN**

- **Root cause**: `userUsageCount = 0` hard-coded.
- **File**: `backend/app/controller/couponController.js` L117-119:
  ```
  // We are not storing coupon reference on order yet, so this is a soft check.
  // Once couponId gets stored on orders, we can count exact usages.
  userUsageCount = 0;
  ```
- **Repro**: same account uses `WELCOME50` (perUserLimit=1) → cancel → reuse. Indefinitely.
- **Fix**: store `Order.coupon`, count `Order.countDocuments({customer, coupon, status: {$ne: 'cancelled'}})` at validate time. Lock with unique compound index `(customer, coupon)` when `perUserLimit === 1`.
- **Test**: place 2 orders with same coupon for same user → second fails.
- **Rollout**: depends on `SERVER_SIDE_COUPON_ENGINE` (rolls out with C-2).

---

## HIGH (P1)

### H-1 · `PAYOUT_STATUS.CANCELLED` is `undefined` · **OPEN**

- **Root cause**: enum is missing `CANCELLED` but code references it 3 times.
- **Files**:
  - `backend/app/constants/finance.js` L68-78 — enum lacks `CANCELLED`.
  - `backend/app/services/finance/payoutService.js` L43-48 — `{$ne: undefined}` matches all docs (idempotency check effectively disabled).
  - `backend/app/services/finance/payoutService.js` L243-247 — sets `payout.status = undefined` → schema enum throws on save.
  - `backend/app/models/order.js` L180-184 — `settlementStatus.sellerPayout` enum DOES include `'CANCELLED'`. Order schema permits it; Payout schema does not. Drift.
- **Symptom**: every return refund with `sellerPayout: HOLD` aborts; new transactional path propagates the error and rolls back the entire refund.
- **Fix**: one-line addition `CANCELLED: 'CANCELLED'`. `ALL_PAYOUT_STATUSES = Object.values(PAYOUT_STATUS)` so the enum propagates.
- **Test**: full return-flow integration through `OrderReturnService.completeReturnAndRefund` with seller payout HOLDed.

---

### H-2 · Coupon validation soft-checks bypass the discount engine · **OPEN**

- **Root cause**: `validateCoupon` uses `Math.round` (integer rupees) instead of `roundCurrency` (2-decimal); reads `cartTotal` from client; `freeDelivery: true` is never honored by the place-order pricing engine.
- **File**: `backend/app/controller/couponController.js` L183-201.
- **Fix**: rolled into C-2 — centralized `couponService.computeOrderDiscount`. When `freeDelivery=true`, snapshot `deliveryFeeCharged = 0` server-side **before** computing grandTotal.

---

### H-3 · Global handling fee lands on a single seller's invoice · **OPEN**

- **Root cause**: `applyGlobalHandlingFeeToSellerBreakdowns` allocates the full cart-wide handling fee to whichever seller has an item in the relevant header category (or the first seller as fallback).
- **File**: `backend/app/services/checkoutPricingService.js` L191-246.
- **Symptom**: per-seller reconciliation shows one seller "owing" the cart-wide handling fee.
- **Fix**: allocate pro-rata across sellers (mirror tip-allocation logic). Or keep at CheckoutGroup level only and exclude from per-seller `grandTotal`.

---

### H-4 · Webhook eventId fallback to `randomUUID()` defeats idempotency · **OPEN**

- **Root cause**: PhonePe webhooks without `transactionId` (early CREATED/PENDING callbacks) generate a fresh UUID per delivery → same logical event processed twice.
- **File**: `backend/app/services/payment/providers/phonepe.adapter.js` L124-131.
- **Fix**: stable hash `sha256(merchantOrderId|state|payloadHash)` as fallback. See Forbidden Pattern #3 in SKILL.md.
- **Test**: redeliver same webhook → second is no-op.

---

### H-5 · Wallet redemption at checkout bypasses ledger AND canonical Wallet · **OPEN**

- **Root cause**: `placeOrderAtomic` writes only `user.walletBalance -= walletAmount` and a legacy `Transaction` row. Canonical `Wallet({ownerType:CUSTOMER}).availableBalance` and `LedgerEntry` are skipped.
- **Files**:
  - `backend/app/services/orderPlacementService.js` L443-457.
  - `backend/app/services/finance/walletService.js` L33-43 (header comment acknowledges the gap).
- **Symptoms**:
  1. `walletLedgerVerifierJob` flags drift (job is disabled by default — drift goes unnoticed).
  2. `getCustomerBalance` returns too-high balance (reads Wallet, not User).
  3. Refund via `reverseOrderFinanceOnCancellation` credits canonical Wallet → Wallet inflated by `walletAmount` because debit never happened there.
- **Fix**: replace with `walletService.debitWallet({ownerType: CUSTOMER, ownerId, amount, bucket: 'available', session, ledgerType: WALLET_PAYMENT, ledgerReference: 'WLT-CHOUT-<groupId>', idempotencyKey: 'WLT-CHOUT-<groupId>', syncUserWalletBalance: true})`. Add `WALLET_PAYMENT` to `LEDGER_TRANSACTION_TYPE`.
- **Rollout**: needs verifier job re-enabled to confirm zero drift post-fix. Backfill historical orders.

---

### H-6 · Free-delivery coupon is silently broken · **OPEN**

- Documented under H-2. Frontend stores `freeDelivery` from validate response but backend never reads it; pricing engine never zeros `deliveryFeeCharged`.
- **Fix**: rolled into C-2.

---

### H-7 · Coupon `cartTotal` / `items` come from client — minOrderValue bypassable · **OPEN**

- **Root cause**: `validateCoupon` trusts `req.body.cartTotal` and `req.body.items`.
- **File**: `backend/app/controller/couponController.js` L81-154.
- **Repro**: POST `cartTotal: 600` for a real ₹100 cart → MIN500 coupon passes.
- **Fix**: ignore client `cartTotal`/`items`. Re-hydrate the customer's cart server-side. Rolled into C-2.

---

### H-8 · admin/cashService.js rider cash balance is a parallel ledger to `Wallet.cashInHand` · **OPEN**

- **Root cause**: `admin/cashService.js` computes `currentCash` from `Cash Collection − Cash Settlement` Transaction rows. `applyDeliveredSettlement` writes `Transaction({type: 'Cash Collection', amount: grandTotal})` (**gross**), but `handleCodOrderFinance` writes `Wallet.cashInHand += grandTotal − riderPayout` (**net**).
- **Files**:
  - `backend/app/services/admin/cashService.js` L30-55.
  - `backend/app/services/orderSettlement.js` L55-69.
  - `backend/app/services/finance/orderFinanceService.js` L466.
- **Symptom**: admin "Rider Cash" panel shows higher cash than `Wallet.cashInHand`. Settlement doesn't agree across views.
- **Fix**: write `Transaction.amount: codAmountNet`. Migration to rewrite past rows. Or migrate admin panel to read `Wallet.cashInHand` directly (cleaner long-term).

---

### H-9 · Multi-seller checkout charges N delivery fees per order · **OPEN (product decision)**

- **Root cause**: `buildCheckoutPricingSnapshot` L281-307 computes `deliveryFeeCharged` per seller; aggregate sums them. Customer buying from 3 sellers pays 3 base delivery fees. UI shows single "Delivery Fee" line without breakdown.
- **File**: `backend/app/services/checkoutPricingService.js`.
- **Fix options**: (a) charge a single delivery fee for the longest distance, (b) explicit per-seller breakdown in UI, (c) route-merging negotiation with sellers. Requires product decision.

---

## MEDIUM (P2)

| ID | Title | File:Line | Fix sketch |
|---|---|---|---|
| M-1 | Two source-of-truth views for rider cash | (covered by H-8) | Migrate `cashService` reads to `LedgerEntry` / `Wallet.cashInHand` |
| M-2 | GST/tax wired but never computed | `checkoutPricingService.js` L295 (hard-coded 0) | Build a tax engine keyed off category HSN, or remove field |
| M-3 | `Coupon.updateOne` increment is fire-and-forget AFTER commit | `orderPlacementService.js` L495-523 | Move inside transaction; on failure throw and let the order abort |
| M-4 | `placeOrderAtomic` reads `user.walletBalance` not `getCustomerBalance()` | `orderPlacementService.js` L294-300 | One-line swap to `getCustomerBalance` |
| M-5 | `creditAdminEarning` excludes COD by design but name/description are misleading | `orderFinanceService.js` L260-289; admin aggregation `walletService.js` L497-501 | Rename to `creditOnlineAdminEarning` or expose two metrics |
| M-6 | `payment.method` enum allows `"wallet"` but no flow ever sets it | `models/order.js` L71-83 | Remove `"wallet"` from enum, or actually set it for wallet-fully-covered orders |
| M-7 | `applyDeliveredSettlement` creates a "Cash Collection" Transaction with gross | `orderSettlement.js` L62-69 | Source of H-8; fix with H-8 |
| M-8 | `Coupon.discountAmount` rounds with `Math.round` instead of `roundCurrency` | `couponController.js::validateCoupon` | Rolled into C-2 |
| M-9 | `Payment.statusHistory` loses gateway raw on same-status transitions | `paymentService.js` L225-236 | Always push to history when `rawGatewayResponse` is present |
| M-10 | `Payment.rawGatewayResponse` accumulates webhook bodies forever | `models/payment.js` | Cap subdocument size or move to TTL collection |
| M-11 | `verifyClientPaymentCallback` is dead Razorpay shim aliasing PhonePe verify | `paymentService.js` L708-715 | Remove or wire through `getActivePaymentProvider().getPaymentStatus` |

---

## LOW (P3)

| ID | Title | File:Line / Concern |
|---|---|---|
| L-1 | `Coupon.minOrderValue` check uses client `cartTotal` | overlaps H-7 |
| L-2 | `customerCancelV2` only permits `SELLER_PENDING`; v1 permits `pending` | UX inconsistency |
| L-3 | `placeOrderAtomic` doesn't reliably carry `image` URL into pricing snapshot | minor display bug |
| L-4 | Pricing fields rounded to 2-decimal but PhonePe expects paise → ±1 paise drift per checkout-group split | `pricingService.js` rounding boundary |
| L-5 | `seller.serviceRadius` defaults to 5km in `computeDistanceKmForSeller` — undocumented magic number | document or move to seller schema default |
| L-6 | `Transaction.reference` is `unique: true` and re-uses public order IDs | future order-id generator change would break writes |
| L-7 | `placeOrderAtomic` retries on `code 11000` for `orderId|checkoutGroupId` regex | future field with these names triggers spurious retries |
| L-8 | Stripe references / Razorpay placeholders are dead code | `verifyClientPaymentCallback`, `providerRegistry.js` L31 |

---

## Quick Triage Map (Symptom → Likely Issue)

| Symptom | First check | Likely issue |
|---|---|---|
| Customer says "I paid twice" / "double-charged" | wallet was used? | **C-1** |
| Negative `paymentBreakdown.grandTotal` in DB | `discountTotal` on the order | **C-2** |
| Customer ID has cancelled-and-replaced same coupon multiple times | `Order.couponSnapshot` populated? | **C-4** |
| Cancelled order, wallet not refunded | v2 path? `financeFlags.cancellationReversalApplied` set? | **C-3** |
| Cancelled ONLINE order, money not refunded to bank | same as above | **C-3** |
| Return refund fails with `ValidationError` on `Payout.status` | `PAYOUT_STATUS` enum includes `CANCELLED`? | **H-1** |
| Same PhonePe webhook processed twice | `eventId` came from `randomUUID()`? | **H-4** |
| `Wallet.availableBalance > User.walletBalance` | wallet redemption path | **H-5** |
| Coupon `MIN500` worked on a ₹100 cart | client `cartTotal`? | **H-7** |
| Admin "Rider Cash" ≠ `Wallet.cashInHand` | aggregation source | **H-8** |
| "Delivery Fee: ₹90" on a 3-seller order | per-seller summation | **H-9** |
| GST line showing ₹0 | engine not implemented | **M-2** |
| Coupon `usedCount` not incremented after order | post-commit fire-and-forget failed | **M-3** |
| Customer with credited Wallet can't use it at checkout | reads `user.walletBalance` not Wallet | **M-4** |

---

## Cross-Reference With Audit Plan

| Audit plan ticket | Bug ID(s) |
|---|---|
| P0 | C-1, C-2, C-3, C-4 |
| P1 | H-1, H-2, H-3, H-4, H-5, H-6, H-7, H-8 |
| P2 | H-9, M-2, M-3, M-4, M-9, M-10 |
| P3 | M-11, L-1 .. L-8 |

When closing a bug, set its Status to **FIXED** in the heading and add the PR / commit hash. If a fix introduces a new surface, add it as a new entry (e.g., `C-1.1`).
