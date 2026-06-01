---
name: order-money-flow-discipline
description: Enforce the canonical order-pricing and money-flow invariants for cart, checkout, payment, settlement, refund, cancellation, and payout. Use when editing any file under `services/checkoutPricingService.js`, `services/finance/*`, `services/payment*`, `services/orderPlacementService.js`, `services/orderSettlement.js`, `services/orderCompensation.js`, `services/order/orderReturnService.js`, `controllers/orderController.js`, `controllers/paymentController.js`, `controllers/couponController.js`, payment models, or the customer checkout frontend; when the user mentions pricing, grandTotal, walletAmount, discount, coupon, refund, payout, settlement, PhonePe webhook, double-charge, or COD reconciliation; whenever adding a new fee, discount, tax, or payment provider.
---

# Order Money Flow Discipline

## Purpose

Every rupee that enters or leaves the system must obey one canonical formula, write to one canonical ledger, and survive every cancellation/refund/retry path without leaking. This skill codifies the rules derived from a full pricing+payment audit (see [known-bugs.md](known-bugs.md)) so future code does not re-create the four CRITICAL bugs that already shipped:

1. wallet double-charge on online + COD
2. client-supplied `discountTotal` pricing tampering
3. v2 cancellations skipping finance reversal
4. coupon per-user limit not enforced

Read [reference.md](reference.md) for the full field ownership map, money flow matrix, and state machine. Read [known-bugs.md](known-bugs.md) before fixing or extending any pricing/payment surface.

## When To Use

- Editing any file under `backend/app/services/finance/`, `backend/app/services/payment/`, `backend/app/services/checkoutPricingService.js`, `backend/app/services/orderPlacementService.js`, `backend/app/services/orderSettlement.js`, `backend/app/services/orderCompensation.js`, `backend/app/services/order/orderReturnService.js`
- Editing `backend/app/controller/{orderController,paymentController,couponController,cartController,adminFinanceController}.js`
- Editing `backend/app/models/{order,payment,wallet,coupon,payout,ledgerEntry,transaction,paymentWebhookEvent}.js`
- Editing `backend/app/validation/financeValidation.js`
- Editing `frontend/src/modules/customer/pages/CheckoutPage.jsx` and `pages/checkout/components/CheckoutPricingBreakdown.jsx`
- Adding a new fee (handling, packaging, surge, platform), a new discount/coupon type, a new tax, a new payment provider, or a new settlement rule
- The user mentions: "double charge", "pricing tampering", "wallet drift", "discount", "coupon", "refund", "payout", "settlement", "PhonePe webhook", "COD float", "grandTotal", "walletAmount", "tip allocation"

## The One Pricing Equation

```
grandTotal = productSubtotal
           + deliveryFeeCharged
           + handlingFeeCharged
           + taxTotal
           + tipTotal
           − discountTotal
           − walletAmount
```

This is what the **customer is asked to pay through the payment gateway (ONLINE)** or **the rider collects in cash (COD)**. Today the formula in `pricingService.generateOrderPaymentBreakdown` is missing the `− walletAmount` term — see C-1 in [known-bugs.md](known-bugs.md). Any change to grandTotal must keep this invariant.

The canonical implementation lives in **exactly one file**: `backend/app/services/finance/pricingService.js`. Frontend `cartTotal` (`CartContext.jsx`) is a UI hint only and must never be authoritative.

## The Nine Invariants

Every change to pricing/payment code must preserve all nine. Violating any one is a P0 finding.

| # | Invariant | Enforcement point |
|---|---|---|
| **I-1** | `grandTotal` matches the one pricing equation above | `pricingService.generateOrderPaymentBreakdown` unit test |
| **I-2** | All inputs that affect money (`discountTotal`, `taxTotal`, `tipAmount`, `walletAmount`, `couponId`) are **re-validated server-side** against the customer's cart and the canonical coupon document before being trusted | `placeOrderAtomic`, `checkoutPreview`, new `couponService.computeOrderDiscount` |
| **I-3** | Wallet mutations happen **only** through `walletService.creditWallet/debitWallet/movePendingToAvailable/updateCashInHand` — never direct `User.walletBalance ±= x` or `Wallet.findOneAndUpdate({$inc})` | `walletService.js` is the single funnel |
| **I-4** | Every wallet mutation passes `ledgerType`, `idempotencyKey`, and `session` so a `LedgerEntry` is created in the same transaction (see related skill `wallet-ledger-atomicity`) | partial unique index on `LedgerEntry.idempotencyKey` |
| **I-5** | Multi-document writes (≥2 collections) run inside `mongoose.startSession()` + `session.withTransaction()` (see related skill `mongoose-transaction-wrap`) | `placeOrderAtomic`, `OrderReturnService.completeReturnAndRefund`, `handleOnlineOrderFinance`, `handleCodOrderFinance`, `reconcileCodCash`, `settleDeliveredOrder` |
| **I-6** | Every cancellation path (v1 and v2) calls `reverseOrderFinanceOnCancellation` idempotently | `compensateOrderCancellation` must call it; `orderController.cancelOrder` already does for v1 |
| **I-7** | Payment status transitions use the state-machine helper (`canTransitionPaymentStatus`); no direct `payment.status = X` assignments outside `transitionPaymentState` | `paymentService.transitionPaymentState` |
| **I-8** | Webhook idempotency uses a **stable** `eventId` derived from `(merchantOrderId, state, payloadHash)` — never a random UUID fallback | `phonepe.adapter.decodeWebhookPayload` |
| **I-9** | Notifications, socket emissions, and queue enqueues happen **after** `withTransaction` resolves — never inside the closure | `placeOrderAtomic` L545+, `OrderReturnService` L687+ |

## The Five Forbidden Patterns

These have already caused real bugs. Reject any PR that re-introduces them.

```js
// ❌ FORBIDDEN — direct User.walletBalance mutation
user.walletBalance -= walletAmount;
await user.save({ session });

// ✅ CORRECT — funnel through walletService
await walletService.debitWallet({
  ownerType: OWNER_TYPE.CUSTOMER, ownerId: customerId,
  amount: walletAmount, bucket: 'available', session,
  ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_PAYMENT,
  ledgerReference: `WLT-CHOUT-${checkoutGroupId}`,
  idempotencyKey: `WLT-CHOUT-${checkoutGroupId}`,
});
```

```js
// ❌ FORBIDDEN — trust client discountTotal
const discount = Math.max(0, Number(payload.discountTotal || 0));

// ✅ CORRECT — re-derive from coupon + hydrated cart
const { discountAmount, freeDelivery, couponSnapshot } =
  await couponService.computeOrderDiscount({
    couponCode: payload.couponCode,
    customerId,
    hydratedItems,
    session,
  });
```

```js
// ❌ FORBIDDEN — random UUID fallback defeats webhook dedup
eventId: payload.transactionId || crypto.randomUUID(),

// ✅ CORRECT — stable hash of the logical event
eventId: payload.transactionId
  || crypto.createHash('sha256')
       .update(`${payload.merchantOrderId}|${payload.state}|${JSON.stringify(payload)}`)
       .digest('hex'),
```

```js
// ❌ FORBIDDEN — compensation without finance reversal
export async function compensateOrderCancellation(order, orderIdString) {
  await releaseReservedStockForOrder(existing, { reason: 'Cancelled' });
  await Transaction.findOneAndUpdate({ reference: orderIdString }, { status: 'Failed' });
  // ❌ wallet redemption & captured payment never refunded
}

// ✅ CORRECT — finance reversal is part of the chokepoint
export async function compensateOrderCancellation(order, orderIdString, { actorId, reason } = {}) {
  await releaseReservedStockForOrder(existing, { reason: 'Cancelled' });
  await Transaction.findOneAndUpdate({ reference: orderIdString }, { status: 'Failed' });

  // Idempotent — financeFlags.cancellationReversalApplied short-circuits re-runs
  if (existing.paymentBreakdown?.grandTotal != null) {
    await reverseOrderFinanceOnCancellation(existing._id, {
      actorId, reason: reason || 'Cancelled before settlement',
    });
  }
}
```

```js
// ❌ FORBIDDEN — emit before commit
await session.withTransaction(async () => {
  await order.save({ session });
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_PLACED, {...}); // ❌
});

// ✅ CORRECT — capture intent inside, emit after commit
let savedOrder = null;
await session.withTransaction(async () => {
  await order.save({ session });
  savedOrder = order;
});
if (savedOrder) {
  emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_PLACED, {...});
}
```

## Field Ownership Rules

When introducing or renaming a money field, declare its authority **exactly once** and add the mirror entry to [reference.md](reference.md). The Order document already has three parallel namespaces — `paymentBreakdown.*` (canonical), `pricing.*` (legacy mirror), and `payment.*` (deprecated legacy nested doc). Writes go to `paymentBreakdown.*` only; `syncLegacyPricing` and the schema `pre('findOneAndUpdate')` hook propagate to the mirrors.

| Adding a field about… | Write to | Mirror to | Read from |
|---|---|---|---|
| Customer-payable money | `paymentBreakdown.<field>` | `pricing.<legacyName>` if a legacy mirror exists | `paymentBreakdown.<field>` ?? `pricing.<legacyName>` |
| Settlement/payout amounts | `paymentBreakdown.<field>` + new `LedgerEntry` row | none | `paymentBreakdown.<field>` |
| Wallet movement | `Wallet({ownerType, ownerId})` via `walletService` + `LedgerEntry` | `User.walletBalance` ONLY when `ownerType === CUSTOMER` and `bucket === 'available'` — and only via walletService's built-in mirror | `getCustomerBalance(userId)` (canonical reader) |
| Payment state | `Payment.status` + `Payment.statusHistory` via `transitionPaymentState` | `Order.paymentStatus` (via `handleOrderSideEffectsFromPaymentStatus`) → `Order.payment.status` (via schema hook) | `Payment.status` |

## Pre-Change Checklist

Copy this checklist into the PR description before touching pricing/payment code:

```
Pre-Change Checklist:
- [ ] Read .cursor/skills/reusable/order-money-flow-discipline/known-bugs.md
- [ ] Confirm change does not violate any of I-1 .. I-9
- [ ] Confirm change does not re-introduce any of the 5 forbidden patterns
- [ ] If field added/renamed: updated reference.md field ownership map
- [ ] If wallet/ledger touched: passes `walletService` funnel + `ledgerType` + `idempotencyKey`
- [ ] If multi-doc write: wrapped in `session.withTransaction()`
- [ ] If cancellation/refund path touched: `reverseOrderFinanceOnCancellation` still reachable
- [ ] If webhook handler touched: eventId is a stable hash, not a UUID
- [ ] If notification emitted: emitted AFTER commit
- [ ] Unit test for the canonical grandTotal equation
- [ ] Fault-injection test (mock one inner write to throw, assert zero partial state)
- [ ] Backfill script written for legacy data (if schema-breaking)
- [ ] Feature flag wired (if behavior-changing for existing orders)
```

## Canonical Workflows

### A. Adding a new fee (e.g., packaging fee, surge multiplier)

1. Add the field to `paymentBreakdown` in `backend/app/models/order.js` with a default of `0`.
2. Compute it inside `pricingService.generateOrderPaymentBreakdown`. Sum it into the canonical `grandTotal` equation. **Do not** add it ad-hoc inside a controller.
3. Add a Joi field to `checkoutPreviewSchema` and `createFinanceOrderSchema` only if the **server** needs an input (e.g., user-selected packaging tier). Never accept the computed amount from the client.
4. Add a legacy mirror in `pricing.<name>` only if downstream consumers expect it. Update `syncLegacyPricing` in `orderFinanceService.js`.
5. Surface in `CheckoutPricingBreakdown.jsx` reading from `pricingPreview.<field>`.
6. Add a unit test asserting the equation still balances.
7. Snapshot the rule used into `paymentBreakdown.snapshots.*` so a historical order can be re-explained later.

### B. Adding a new discount/coupon rule

1. Extend `app/services/finance/couponService.js::computeOrderDiscount` (create the file if it does not yet exist — see C-2 fix in [known-bugs.md](known-bugs.md)).
2. The function takes `{couponCode, customerId, hydratedItems, session}` and returns `{discountAmount, freeDelivery, couponSnapshot}`.
3. Call it from `buildCheckoutPricingSnapshot` and `placeOrderAtomic`. **Do not** trust client-supplied `discountTotal`.
4. Persist `couponSnapshot` on the Order so the rule that fired is replayable.
5. If `freeDelivery: true`, set `deliveryFeeCharged = 0` server-side **before** computing `grandTotal`.
6. If `perUserLimit` is set, count `Order.countDocuments({customer, 'couponSnapshot.couponId': coupon._id, status: {$ne: 'cancelled'}})` and reject if the count would exceed.
7. Test: malicious client with `discountTotal: 999999` → server applies real discount only.

### C. Adding a new payment provider

1. Add an adapter at `backend/app/services/payment/providers/<name>.adapter.js` extending `PaymentProviderPort`.
2. Implement `initiatePayment`, `getPaymentStatus`, `validateWebhook`, `decodeWebhookPayload`, `mapStatusToInternal`, `providerName`.
3. Register in `providerRegistry.js` under a new switch case.
4. Add the provider name to `ALL_PAYMENT_GATEWAYS` in `constants/payment.js`.
5. Webhook eventId must be a **stable hash**, not a random UUID (I-8).
6. Opt-in via `PAYMENT_PROVIDER=<name>` env. Default stays the existing provider so rollback is an env flip.
7. Reuse `paymentService.processPhonePeWebhook`/`verifyPhonePePaymentStatus` semantics — they are provider-agnostic except for the name. Rename if you migrate fully.

### D. Modifying refund/cancellation flow

1. Find the chokepoint (`compensateOrderCancellation` for v2, `cancelOrder` for v1, `OrderReturnService.completeReturnAndRefund` for returns).
2. Wrap all writes in `session.withTransaction()` (skill: `mongoose-transaction-wrap`).
3. Every wallet movement passes `ledgerType` + `idempotencyKey` (skill: `wallet-ledger-atomicity`).
4. Capture notification payloads inside; emit after commit (I-9).
5. Add an `Order.financeFlags.<flagName>` idempotency guard to prevent re-running.
6. Fault-injection test: mock one inner write to throw, assert wallet, ledger, and order are untouched.

### E. Modifying COD remittance / rider cash

1. Wallet mutations on `cashInHand` go through `walletService.updateCashInHand` only.
2. Both ends of the COD remittance (`updateCashInHand` debit on rider + `creditWallet` on admin) live in **one** session.
3. Update `paymentBreakdown.codCollectedAmount`, `codRemittedAmount`, `codPendingAmount` consistently. `codPendingAmount = codCollectedAmount − codRemittedAmount` must hold after every write.
4. **Do not** create a legacy `Transaction({type: 'Cash Collection'})` row with `grandTotal` — use `codAmountNet` so the admin's Transaction-derived view matches `Wallet.cashInHand` (see H-8 in [known-bugs.md](known-bugs.md)).

## Required Tests Per Change

| Change type | Required test |
|---|---|
| Any modification to `pricingService.generateOrderPaymentBreakdown` | Unit test asserting `grandTotal === productSubtotal + delivery + handling - discount + tax + tip - walletAmount` |
| Wallet movement added/changed | Fault-injection test verifying rollback semantics |
| Coupon engine extension | E2E: client posts `discountTotal: 999999` → server applies real discount |
| Refund flow extension | Idempotency test: call twice, assert single effect |
| Webhook handler extension | Duplicate-webhook test: re-deliver same `eventId` → second is no-op |
| Cancellation path | Wallet-was-debited test: cancel → wallet refunded + ledger row created |
| Multi-seller checkout | Tip-allocation precision test: sum of per-seller `tipTotal` === group `tipAmount` ±0 paise |

## Debugging Workflow

When investigating a "money missing" / "double-charge" / "wrong total" report:

1. **Pull the Order doc**: `Order.findOne({orderId: 'AZ-…'})`. Read `paymentBreakdown`, `payment`, `pricing`, `financeFlags`, `settlementStatus`.
2. **Pull the Payment doc(s)**: `Payment.find({order: order._id}).sort({createdAt:1})`. Inspect `statusHistory` and `rawGatewayResponse`.
3. **Pull the LedgerEntry rows**: `LedgerEntry.find({orderId: order._id}).sort({createdAt:1})`. The sum of CREDITs minus DEBITs per `actorType+actorId` is what each party should have received.
4. **Pull the legacy Transactions**: `Transaction.find({order: order._id})`. These are the source of the admin/seller/rider dashboards.
5. **Compare**: `Wallet.findOne({ownerType, ownerId})` balance vs sum of ledger entries for that owner. Drift = bug.
6. **Check the webhook log**: `PaymentWebhookEvent.find({publicOrderId: order.orderId}).sort({createdAt:1})` — duplicates here mean idempotency hole (I-8).
7. **Check the FinanceAuditLog**: `FinanceAuditLog.find({orderId: order._id})` — shows who triggered the action.

Use [known-bugs.md](known-bugs.md) as a triage tree: match symptoms to known issues before assuming a new bug.

## Backward Compatibility Rules

- Schema additions are always additive (`default: 0` for new money fields).
- Schema removals never go directly to drop. Follow the canonical sync-hook + deprecate + soak + drop pattern (skill: `legacy-field-deprecation`).
- New behavior on existing orders **must** be feature-flagged. Default OFF for historical data, ON for new orders after deploy. Examples already in code: `TRANSACTIONAL_REFUND_ENABLED`, `AUTO_RELEASE_SELLER_PAYOUT`, `PAYMENT_PROVIDER`, `FINANCE_VERIFIER_ENABLED`.
- A behavior change on the grandTotal equation requires a backfill that computes the historical correct amount and issues refunds for over-charged orders. See `idempotent-data-migration` skill.

## Rollout & Rollback

| Change | Flag | Rollback |
|---|---|---|
| Subtract walletAmount from grandTotal (fix C-1) | `WALLET_REDEMPTION_REDUCES_PAYABLE=true` | Env flip to `false`; new orders revert to current (buggy) behavior |
| Server-side coupon engine (fix C-2) | `SERVER_SIDE_COUPON_ENGINE=true` | Env flip to `false`; falls back to current trust-client behavior |
| Finance reversal in compensation (fix C-3) | not flagged — bug fix only, idempotent via `financeFlags.cancellationReversalApplied` | Revert PR; `financeFlags` field is additive and harmless |
| Per-user coupon limit (fix C-4) | depends on `SERVER_SIDE_COUPON_ENGINE` | Env flip |
| New payment provider | `PAYMENT_PROVIDER=<name>` | Env flip to previous provider |
| Webhook eventId hash (fix H-4) | not flagged — additive | Revert PR |

## Sequencing With The Audit Plan

| Audit-plan ticket | This skill's section |
|---|---|
| P0 — C-1 wallet double-charge | "The One Pricing Equation" + "Canonical Workflow A" |
| P0 — C-2 server-side coupon | "Canonical Workflow B" |
| P0 — C-3 cancellation reversal | "Forbidden Patterns" #4 + "Canonical Workflow D" |
| P0 — C-4 per-user coupon limit | "Canonical Workflow B" |
| P1 — H-1 PAYOUT_STATUS.CANCELLED | one-line constant fix, no skill section needed |
| P1 — H-4 stable webhook eventId | "Forbidden Patterns" #3 + "Canonical Workflow C" |
| P1 — H-5 wallet redemption via walletService | "Forbidden Patterns" #1 |
| P1 — H-8 COD Transaction amount alignment | "Canonical Workflow E" |

## Related Skills

- `wallet-ledger-atomicity` — the contract for **inside** any wallet mutation (always passes ledgerType + idempotencyKey + session)
- `mongoose-transaction-wrap` — the `session.withTransaction()` envelope around multi-doc writes
- `idempotent-data-migration` — for the wallet/discount/ledger backfill scripts
- `legacy-field-deprecation` — for retiring `User.walletBalance`, `Transaction`, `Order.pricing.*`, `Order.payment.*`
- `polymorphic-discriminator-discipline` — for `LedgerEntry.actorType`, `Payout.beneficiaryModel`
- `provider-adapter-pattern` — for adding a new payment gateway behind `PaymentProviderPort`
- `realtime-architecture-audit` — for notification emission timing relative to transactions
- `db-audit-execution-playbook` — orchestrates this skill against the database audit plan
