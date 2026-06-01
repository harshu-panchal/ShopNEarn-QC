# Appzeto Quick-Commerce — Production-Grade Database Audit & Implementation Plan
## Part 3 of 4: Phased Implementation Roadmap (Phase 0 → Phase 7)

> Each phase is **independently mergeable**, **independently deployable**, and **independently rollback-able**. Every phase preserves backward compatibility for existing API consumers (frontend included). No phase removes a public field, route, or contract; deprecations are documented for Phase 7 removal only.

> **Effort and risk** are baselines for one mid-senior backend engineer with pairing/review. Multiply by 1.5x if the engineer is new to the codebase.

> **Acceptance criteria** below each phase must all be true before merging to `main`. A phase that fails one criterion stays open as a hot-fix branch; later phases proceed only on the green parts.

---

# PHASE 0 — PRE-FLIGHT VERIFICATION (Read-only)

**Objective:** before changing any code, verify every claim in Parts 1 + 2 against the **live database**. Some findings might turn out to be moot if a flow is dead in production. Some might be MORE severe. Output is a single Markdown report.

**Effort:** 1 day. **Risk:** None.

## 0.1 Steps

| # | Action | Command / SQL |
|---|---|---|
| 1 | Snapshot collection sizes | `db.getCollectionNames().forEach(n => print(n, db[n].countDocuments({})))` |
| 2 | Confirm the `withdrawals` collection is **empty** (or doesn't exist) | `db.withdrawals.countDocuments({})` |
| 3 | Count `Transaction` rows by `type` | `db.transactions.aggregate([{$group:{_id:"$type", c:{$sum:1}}}])` |
| 4 | Check for `Transaction` rows with `type:"Wallet Payment"` | `db.transactions.countDocuments({type:"Wallet Payment"})` — if > 0, **§2.2 is already producing failed writes** but somehow some succeeded (perhaps from a previous schema version). Audit needed. |
| 5 | Verify orphan field count: `db.orders.countDocuments({"financeFlags.sellerPayoutHeld": {$exists:true}})` — should be 0 (because Mongoose silently dropped writes). |
| 6 | Check `Notification.recipientModel` distribution: `db.notifications.aggregate([{$group:{_id:"$recipientModel", c:{$sum:1}}}])` — count rows with `"Customer"` (this is the migration target population). |
| 7 | Same for `MediaMetadata.uploadedByModel`, `Ticket.userType`, `OtpSession.userType`. |
| 8 | Verify Wallet-vs-User.walletBalance drift for a sample of 100 users: ```js db.users.aggregate([{$match:{walletBalance:{$gt:0}}}, {$limit:100}, {$lookup:{from:"wallets", let:{u:"$_id"}, pipeline:[{$match:{$expr:{$and:[{$eq:["$ownerType","CUSTOMER"]},{$eq:["$ownerId","$$u"]}]}}}], as:"w"}}, {$project:{walletBalance:1, walletAvail:{$arrayElemAt:["$w.availableBalance",0]}, drift:{$subtract:["$walletBalance",{$ifNull:[{$arrayElemAt:["$w.availableBalance",0]},0]}]}}}]) ``` |
| 9 | Verify LedgerEntry vs Wallet invariant: `for each wallet: sum LedgerEntry.amount where actorType=wallet.ownerType AND actorId=wallet.ownerId AND status="COMPLETED"` vs `wallet.availableBalance + wallet.pendingBalance + wallet.cashInHand`. Expect drift. |
| 10 | Count duplicate-cart-customer rows: `db.carts.aggregate([{$group:{_id:"$customerId", c:{$sum:1}}}, {$match:{c:{$gt:1}}}])` — should be 0 (schema enforces unique). |
| 11 | Verify all `Order.customer` resolve to existing User: ```js db.orders.aggregate([{$sample:{size:1000}}, {$lookup:{from:"users", localField:"customer", foreignField:"_id", as:"u"}}, {$match:{u:{$size:0}}}]) ``` — should be empty. |
| 12 | Index health: run `databaseIndexManager.verifyIndexes()` and capture the missing-index report. |
| 13 | Slow query top 20: enable profiler at 100ms briefly, dump `system.profile`. Identify any query that scans > 10k docs. |
| 14 | Confirm replica set (transactions need it): `rs.status()` → expect PRIMARY/SECONDARY. |
| 15 | Confirm write concern of the connection: read mongoose connection options in `app/dbConfig/`. |

## 0.2 Deliverable

A `db_preflight_report.md` artifact with the result of each step above. Findings that downgrade severity (e.g. a dead code path) → annotate the master plan. Findings that elevate severity (e.g. live wallet drift > 1000 INR) → escalate before Phase 1.

## 0.3 Acceptance

- [ ] Report committed to repo.
- [ ] No surprises requiring a rewrite of Part 1/2.
- [ ] Drift-by-collection table reviewed by finance/ops stakeholder.

---

# PHASE 1 — CORRECTNESS FIXES (Broken refs · broken enums · orphan fields)

**Objective:** fix every defect that can throw an exception, silently swallow a write, or break a future populate. No schema migration. No data migration. Pure code changes.

**Effort:** 2 days. **Risk:** Low.

## 1.1 Tickets

### P1-1: Fix `ref:"Customer"` → `ref:"User"` on 3 schemas

**Files:**
- `backend/app/models/cart.js:7`
- `backend/app/models/wishlist.js:7`
- `backend/app/models/checkoutGroup.js:19`

**Change:**
```diff
- ref: "Customer",
+ ref: "User",
```

**Tests (add):**
- `__tests__/models/cart.populate.test.js` — create a User + Cart, then `await Cart.findById(cart._id).populate('customerId')` and assert `populated.customerId.phone === user.phone`.
- Same for Wishlist and CheckoutGroup.

**Rollback:** revert single commit.

---

### P1-2: Add `"Wallet Payment"` and `"Wallet Refund"` to `Transaction.type` enum

**File:** `backend/app/models/transaction.js:19-23`

```diff
- enum: ["Order Payment", "Delivery Earning", "Withdrawal", "Refund", "Incentive", "Bonus", "Cash Collection", "Cash Settlement"],
+ enum: [
+   "Order Payment",
+   "Delivery Earning",
+   "Withdrawal",
+   "Refund",
+   "Incentive",
+   "Bonus",
+   "Cash Collection",
+   "Cash Settlement",
+   "Wallet Payment",
+   "Wallet Refund",
+ ],
```

**Tests (add):**
- `__tests__/services/orderPlacementService.walletRedemption.test.js` — place an order with `walletAmount > 0`. Assert `Transaction` row created with `type:"Wallet Payment"`.

**Rationale:** unblocks an existing broken code path. Phase 4 will migrate this off `Transaction` and onto `LedgerEntry` (`LEDGER_TRANSACTION_TYPE.WALLET_REFUND` already exists in constants/finance.js).

---

### P1-3: Add `sellerPayoutHeld:Boolean` to `Order.financeFlags`

**File:** `backend/app/models/order.js:243-250`

```diff
    financeFlags: {
      onlinePaymentCaptured: { type: Boolean, default: false },
      codMarkedCollected: { type: Boolean, default: false },
      deliveredSettlementApplied: { type: Boolean, default: false },
      sellerPayoutQueued: { type: Boolean, default: false },
      riderPayoutQueued: { type: Boolean, default: false },
      adminEarningCredited: { type: Boolean, default: false },
+     sellerPayoutHeld: { type: Boolean, default: false },
+     returnPickupCommissionPaid: { type: Boolean, default: false },
    },
```

`returnPickupCommissionPaid` is referenced as a guard at `orderController.js:1051` — confirm it's defined elsewhere; if not, add here.

**Tests:**
- Targeted unit on `orderController.applyReturnRefund` reading `order.financeFlags.sellerPayoutHeld`.

---

### P1-4: Wire `cartValidation.js` into cart routes

**Context:** `app/validation/cartValidation.js` already exists (1681 bytes). It's not wired.

**File:** `backend/app/routes/cartRoutes.js`

```diff
+ import validate from "../middleware/validate.js";
+ import { addToCartSchema, updateCartSchema, removeFromCartParamsSchema } from "../validation/cartValidation.js";

- router.post("/", verifyToken, cartController.addToCart);
+ router.post("/", verifyToken, validate(addToCartSchema), cartController.addToCart);

- router.put("/", verifyToken, cartController.updateQuantity);
+ router.put("/", verifyToken, validate(updateCartSchema), cartController.updateQuantity);

- router.delete("/:productId", verifyToken, cartController.removeFromCart);
+ router.delete("/:productId", verifyToken, validate(removeFromCartParamsSchema, "params"), cartController.removeFromCart);
```

Verify `validate.js` middleware supports passing the schema location (`"body"` default, `"params"`/`"query"`/`"headers"` optional). If not, extend it.

Same exercise (independently) for wishlist, customer profile updates, mapsRoutes, walletValidation, ticketValidation — all `validation` files that exist but aren't wired into their routes.

---

### P1-5: Add startup-time model-name sanity check

**File:** `backend/app/core/startup.js`

```diff
+ const REQUIRED_MODELS = [
+   "User", "Seller", "Delivery", "Admin",
+   "Order", "Payment", "PaymentWebhookEvent",
+   "Cart", "Wishlist", "CheckoutGroup",
+   "Product", "Category", "Coupon",
+   "Wallet", "LedgerEntry", "Payout", "Transaction", "FinanceAuditLog",
+   "OrderOtp", "OtpVerification", "OtpSession",
+   "Notification", "NotificationPreference", "PushToken",
+   "Review", "Ticket", "FAQ",
+   "Offer", "OfferSection", "ExperienceSection", "HeroConfig",
+   "Setting", "MediaMetadata", "GeocodeCache", "StockHistory",
+   "DashboardStats", "SellerMetrics", "FinanceReports", "SearchIndexFailure", "DeliveryAssignment",
+ ];
+
+ export function assertAllModelsRegistered() {
+   const registered = new Set(mongoose.modelNames());
+   const missing = REQUIRED_MODELS.filter((m) => !registered.has(m));
+   if (missing.length > 0) {
+     throw new Error(`Required Mongoose models missing: ${missing.join(", ")}`);
+   }
+ }
```

Call from existing startup function before serving traffic. Prevents future renames from silently breaking populate.

---

### P1-6: Lock down `Notification.recipientModel` enum (remove `"Customer"`) IF Phase 0 audit shows 0 existing rows with that value

This is normally a Phase 5 task. Move it here ONLY IF Phase 0 confirms no production rows have `recipientModel:"Customer"`. Otherwise defer.

---

## 1.2 Acceptance Criteria for Phase 1

- [ ] All 3 broken `ref:"Customer"` fixed and unit-tested (P1-1).
- [ ] `Transaction` enum extended; wallet-redemption order placement tested end-to-end (P1-2).
- [ ] `Order.financeFlags` schema extended; refund flow reads/writes the new flags (P1-3).
- [ ] Cart + wishlist + ≥3 other route files now use `validate()` middleware (P1-4).
- [ ] Startup-time model assertion passes (P1-5).
- [ ] CI: full test suite green.
- [ ] Staging soak ≥ 24 hours with synthetic load before merge.

## 1.3 Backward Compatibility

- All API request shapes unchanged.
- All API response shapes unchanged.
- No schema field removed; only additions and value-set extensions.
- No data migration needed.

## 1.4 Rollback (Phase 1)

- Single-commit revert per ticket (P1-1 through P1-5 each ship as own commit + PR).
- Maximum data exposure window: zero — Phase 1 changes are code-only.

---

# PHASE 2 — TRANSACTIONAL & LEDGER INTEGRITY

**Objective:** every multi-document financial write happens inside `mongoose.startSession()` and produces a matching `LedgerEntry`. `walletService` becomes the single funnel for all wallet mutations; ledger entries are generated automatically.

**Effort:** 4 days. **Risk:** Medium. **Dependencies:** Phase 1 merged.

## 2.1 Tickets

### P2-1: Extend `walletService` with ledger-aware variants

**Pattern:** **wrap and improve** — new functions added next to old. Old `creditWallet`/`debitWallet` remain working for transition. New `creditWalletWithLedger` is preferred.

Actually, cleaner: change the existing `creditWallet`/`debitWallet` to internally call ledger creation when sufficient metadata is provided, and log a `WARN` when called without it.

**File:** `backend/app/services/finance/walletService.js`

```js
// Updated signature (additive):
export async function creditWallet({
  ownerType,
  ownerId,
  amount,
  bucket = "available",
  session,
  // NEW (optional during transition; required by Phase 2.4)
  ledgerType,           // one of LEDGER_TRANSACTION_TYPE
  ledgerDirection = LEDGER_DIRECTION.CREDIT,
  ledgerReference = "",
  ledgerDescription = "",
  orderId = null,
  payoutId = null,
  paymentMode = null,
  metadata = {},
  idempotencyKey = null,
  correlationId = null,
}) {
  const normalizedAmount = assertPositiveAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, { session });
  if (wallet.status !== WALLET_STATUS.ACTIVE) throw new Error("Wallet is not active");

  const before = wallet[`${bucket}Balance`];
  wallet[`${bucket}Balance`] = addMoney(before, normalizedAmount);
  wallet.totalCredited = addMoney(wallet.totalCredited, normalizedAmount);
  await wallet.save({ session });

  // Auto-create ledger entry if type provided.
  if (ledgerType) {
    await createLedgerEntry(
      {
        orderId,
        payoutId,
        walletId: wallet._id,
        actorType: ownerType,
        actorId: ownerId,
        type: ledgerType,
        direction: ledgerDirection,
        amount: normalizedAmount,
        status: LEDGER_STATUS.COMPLETED,
        paymentMode,
        balanceBefore: roundCurrency(before),
        balanceAfter: roundCurrency(wallet[`${bucket}Balance`]),
        metadata: { ...metadata, bucket, idempotencyKey, correlationId },
        description: ledgerDescription,
        reference: ledgerReference,
      },
      { session },
    );
  } else if (process.env.NODE_ENV === "production") {
    logger.warn("walletService.creditWallet called without ledgerType — audit gap", {
      ownerType, ownerId, amount, bucket,
    });
  }

  return { wallet, amount: normalizedAmount, before, after: wallet[`${bucket}Balance`], bucket };
}
```

Same shape for `debitWallet`, `movePendingToAvailable`, `updateCashInHand`.

### P2-2: Migrate every `creditWallet/debitWallet` call site

Identify call sites (already enumerated):
- `orderController.js:1020-1077` (return refund)
- `orderWorkflowController.js:328`
- `orderFinanceService.js:349, 655, 766, 798`

For each, add the `ledgerType`, `orderId`, `ledgerReference`, `ledgerDescription`, `paymentMode`, `metadata` properties to the call. The ledger types are already enumerated in `constants/finance.js`.

Add a CI lint rule (or grep-in-pre-commit) that fails if `creditWallet(` or `debitWallet(` is invoked without `ledgerType:` in the same expression. Strict enforcement after Phase 2 merges.

### P2-3: Add `idempotencyKey` + `correlationId` to `LedgerEntry`

**File:** `backend/app/models/ledgerEntry.js`

```diff
+   idempotencyKey: {
+     type: String,
+     default: undefined,
+   },
+   correlationId: {
+     type: String,
+     default: null,
+     index: true,
+   },
    metadata: { type: Object, default: {} },
    ...
  },
  { timestamps: true },
);

+ ledgerEntrySchema.index(
+   { idempotencyKey: 1 },
+   {
+     unique: true,
+     partialFilterExpression: { idempotencyKey: { $type: "string" } },
+     name: "idx_ledger_idempotency_partial",
+   },
+ );
```

This makes ledger entry insert idempotent at the DB level — retries of webhook handlers can't double-credit.

### P2-4: Wrap return-refund flow in a transaction

**File:** create `backend/app/services/order/orderRefundService.js` (extracted from `orderController.js:949-1098`):

```js
import mongoose from "mongoose";
import Order from "../../models/order.js";
import User from "../../models/customer.js";
import { creditWallet, debitWallet } from "../finance/walletService.js";
import { createLedgerEntry } from "../finance/ledgerService.js";
import FinanceAuditLog from "../../models/financeAuditLog.js";
import {
  LEDGER_TRANSACTION_TYPE,
  LEDGER_DIRECTION,
  OWNER_TYPE,
  FINANCE_AUDIT_ACTION,
} from "../../constants/finance.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";

export async function applyReturnRefund(orderId, { actorId, actorType = OWNER_TYPE.ADMIN } = {}) {
  const session = await mongoose.startSession();
  try {
    let resultOrder = null;
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order || order.returnStatus !== "qc_passed") return;

      const refundAmount = computeRefundAmount(order);
      const commission = order.returnDeliveryCommission || 0;
      const reference = `REFUND-${order.orderId}`;

      // 1. Credit customer wallet via canonical service (writes both Wallet doc AND LedgerEntry).
      if (order.customer && refundAmount > 0) {
        await creditWallet({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: order.customer,
          amount: refundAmount,
          bucket: "available",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
          ledgerDirection: LEDGER_DIRECTION.CREDIT,
          ledgerReference: reference,
          ledgerDescription: `Return refund for order ${order.orderId}`,
          orderId: order._id,
          paymentMode: order.paymentMode,
          idempotencyKey: `${reference}-customer`,
        });

        // Transitional: also update legacy User.walletBalance until Phase 4c removes it.
        await User.findByIdAndUpdate(order.customer, { $inc: { walletBalance: refundAmount } }, { session });
      }

      // 2. Seller debit / payout cancellation
      if (order.seller && (refundAmount + commission) > 0) {
        const isHeld =
          order.settlementStatus?.sellerPayout === "HOLD" ||
          order.financeFlags?.sellerPayoutHeld;
        if (isHeld) {
          const { cancelPendingPayoutForOrder } = await import("../finance/payoutService.js");
          await cancelPendingPayoutForOrder(order._id, "SELLER", { session, remarks: "Return QC passed" });
          order.settlementStatus.sellerPayout = "CANCELLED";
          order.financeFlags.sellerPayoutHeld = false;
        } else {
          await debitWallet({
            ownerType: OWNER_TYPE.SELLER,
            ownerId: order.seller,
            amount: refundAmount + commission,
            bucket: "available",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.REFUND,
            ledgerDirection: LEDGER_DIRECTION.DEBIT,
            ledgerReference: reference,
            ledgerDescription: `Refund adjustment for order ${order.orderId}`,
            orderId: order._id,
            idempotencyKey: `${reference}-seller`,
          });
        }
      }

      // 3. Delivery commission (idempotent via flag)
      if (
        order.returnDeliveryBoy &&
        commission > 0 &&
        !order.financeFlags?.returnPickupCommissionPaid
      ) {
        await creditWallet({
          ownerType: OWNER_TYPE.DELIVERY_PARTNER,
          ownerId: order.returnDeliveryBoy,
          amount: commission,
          bucket: "available",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.RIDER_PAYOUT_PROCESSED,
          ledgerReference: reference,
          ledgerDescription: `Return-pickup commission for order ${order.orderId}`,
          orderId: order._id,
          idempotencyKey: `${reference}-rider`,
        });
        order.financeFlags.returnPickupCommissionPaid = true;
      }

      // 4. Order status update
      order.returnStatus = "refund_completed";
      if (order.payment) order.payment.status = "refunded";
      // Canonical field — Phase 4 makes this primary:
      order.paymentStatus = "REFUNDED";
      order.refundIssuedAt = new Date();
      await order.save({ session });

      // 5. Audit log
      await FinanceAuditLog.create([{
        action: FINANCE_AUDIT_ACTION.FINANCE_ADJUSTMENT_APPLIED,
        actorType,
        actorId,
        orderId: order._id,
        metadata: { reason: "RETURN_REFUND", refundAmount, commission },
      }], { session });

      resultOrder = order;
    });

    if (resultOrder) {
      emitNotificationEvent(NOTIFICATION_EVENTS.REFUND_COMPLETED, {
        orderId: resultOrder.orderId,
        customerId: resultOrder.customer,
        userId: resultOrder.customer,
        sellerId: resultOrder.seller,
        deliveryId: resultOrder.returnDeliveryBoy,
        data: {
          refundAmount: computeRefundAmount(resultOrder),
          returnDeliveryCommission: resultOrder.returnDeliveryCommission || 0,
          isCOD: resultOrder.paymentMode === "COD",
        },
      });
    }
    return resultOrder;
  } finally {
    session.endSession();
  }
}

function computeRefundAmount(order) {
  if (order.returnRefundAmount) return order.returnRefundAmount;
  if (!Array.isArray(order.returnItems)) return 0;
  return order.returnItems.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
}
```

Update `orderController.js` to call `applyReturnRefund(orderId, { actorId: req.user.id })` instead of the inline block.

### P2-5: Wrap order-status updates (cancellation, status changes) in transactions

`orderController.updateOrderStatus` has cancellation + stock-reversal + transaction-update blocks. Wrap each "status change with side effects" branch in a session.

### P2-6: Wrap delivery OTP flows (cash collection, return pickup) in transactions

`deliveryController.js:162` Cash Collection write, `:313` Withdrawal write — same pattern.

### P2-7: Atomic coupon usage increment

**File:** `backend/app/services/checkoutPricingService.js` (or wherever Coupon is applied)

Replace read-then-increment with:
```js
const updated = await Coupon.findOneAndUpdate(
  {
    _id: couponId,
    isActive: true,
    validFrom: { $lte: now },
    validTill: { $gte: now },
    $or: [{ usageLimit: null }, { usageLimit: { $exists: false } }, { usedCount: { $lt: "$usageLimit" } }],
  },
  { $inc: { usedCount: 1 } },
  { new: true, session },
);
if (!updated) throw new Error("Coupon invalid or exhausted");
```

Note Mongo doesn't allow `$lt` reference to another doc field in find query — use aggregation update pipeline instead:
```js
const updated = await Coupon.findOneAndUpdate(
  { _id: couponId, isActive: true, validFrom: { $lte: now }, validTill: { $gte: now } },
  [
    {
      $set: {
        usedCount: {
          $cond: [
            { $or: [
              { $eq: ["$usageLimit", null] },
              { $not: ["$usageLimit"] },
              { $lt: ["$usedCount", "$usageLimit"] },
            ]},
            { $add: ["$usedCount", 1] },
            "$usedCount", // unchanged → caller treats as failure
          ],
        },
      },
    },
  ],
  { new: true, session },
);
// caller checks updated.usedCount didn't change to detect exhaustion
```

### P2-8: Stock decrement atomicity audit

`reserveStockForItems` in `stockService.js` should already be using atomic `findOneAndUpdate({stock: {$gte: qty}}, {$inc: {stock: -qty}})`. **Verify** in Phase 0 audit; if missing, fix here.

### P2-9: Verifier cron — wallet ↔ ledger invariant

Add a low-frequency cron (every 6 hours) that samples 100 wallets, computes `expectedBalance = sum of LedgerEntry` for that owner, compares to `wallet.availableBalance + pendingBalance + cashInHand`. Any drift > 1 INR logs `ERROR` and posts to a finance Slack channel via the existing notification mechanism.

## 2.2 Acceptance Criteria for Phase 2

- [ ] `walletService.creditWallet/debitWallet` always produce ledger entries when `ledgerType` provided.
- [ ] All current call sites updated to pass `ledgerType`.
- [ ] Refund flow (`applyReturnRefund`) is fully transactional, audit-logged.
- [ ] Order cancellation flow is transactional.
- [ ] Delivery cash-collection flow is transactional.
- [ ] Wallet ↔ ledger verifier cron in place, alert wired.
- [ ] Coupon usage is atomic.
- [ ] CI integration test: refund of a delivered order, then force-kill the worker mid-flight — verify either fully refunded or fully rolled back (no half states).
- [ ] Replica-set required for transactions — confirmed in Phase 0.

## 2.3 Backward Compatibility

- All wallet helper signatures gained optional fields; old callers continue working with the `WARN` log.
- Refund response shape unchanged (still returns the updated order).
- No schema field removed.

## 2.4 Rollback (Phase 2)

- Each ticket P2-N is a separate PR. Rollback by reverting the PR.
- The Phase 2 verifier cron is feature-flagged (`FINANCE_VERIFIER_ENABLED=true`); disable via env var without re-deploying code.

---

# PHASE 3 — INDEX HYGIENE

**Objective:** correct `databaseIndexManager.js` to reference real fields and real collections. Eliminate index duplication between schema and manager. Remove dead indexes.

**Effort:** 2 days. **Risk:** Low. **Dependencies:** Phase 0 (live verification of which indexes exist) is essential.

## 3.1 Tickets

### P3-1: Drop dead indexes

The dead indexes identified in §2.5 must be **explicitly dropped** from production. Adding the fix to `databaseIndexManager.js` alone won't remove existing wrong indexes.

Script: `backend/scripts/drop-dead-indexes.js` (see Part 4 §M3-1).

| Index name | Collection | Reason |
|---|---|---|
| `idx_user_created_type` | `transactions` | field `userId` doesn't exist |
| `idx_user_status_created` | `transactions` | same |
| `idx_recipient_read_created` | `notifications` | field `read` is actually `isRead` |
| `idx_ownerType_ownerId_created` | `ledgerentries` | fields are `actorType`/`actorId` |
| All `withdrawals` indexes | `withdrawals` | collection doesn't exist |

### P3-2: Correct `databaseIndexManager.js`

```diff
  transactions: [
-   { keys: { userId: 1, createdAt: -1, type: 1 }, options: { name: "idx_user_created_type", background: true } },
-   { keys: { userId: 1, status: 1, createdAt: -1 }, options: { name: "idx_user_status_created", background: true } },
+   { keys: { user: 1, userModel: 1, type: 1, createdAt: -1 }, options: { name: "idx_user_userModel_type_created", background: true } },
+   { keys: { user: 1, userModel: 1, status: 1, type: 1, createdAt: -1 }, options: { name: "idx_user_userModel_status_type_created", background: true } },
    { keys: { user: 1, userModel: 1, status: 1, createdAt: -1 }, options: { name: "idx_user_userModel_status_created", background: true } },
  ],

  notifications: [
    { keys: { recipient: 1, createdAt: -1 }, options: { name: "idx_recipient_created", background: true } },
-   { keys: { recipient: 1, read: 1, createdAt: -1 }, options: { name: "idx_recipient_read_created", background: true } },
+   { keys: { recipient: 1, isRead: 1, createdAt: -1 }, options: { name: "idx_recipient_isRead_created", background: true } },
    { keys: { type: 1, createdAt: -1 }, options: { name: "idx_type_created", background: true } },
  ],

  ledgerentries: [
    { keys: { orderId: 1, actorType: 1, createdAt: -1 }, options: { name: "idx_orderId_actorType_created", background: true } },
-   { keys: { ownerType: 1, ownerId: 1, createdAt: -1 }, options: { name: "idx_ownerType_ownerId_created", background: true } },
+   { keys: { actorType: 1, actorId: 1, createdAt: -1 }, options: { name: "idx_actorType_actorId_created", background: true } },
  ],

- withdrawals: [
-   { keys: { status: 1, createdAt: -1 }, options: { name: "idx_status_created", background: true } },
-   { keys: { user: 1, userModel: 1, createdAt: -1 }, options: { name: "idx_user_userModel_created", background: true } },
- ],
```

### P3-3: Deduplicate indexes between schema and manager

Convert `databaseIndexManager.js` to **verification-first**: it warns on missing indexes but does not silently create overlapping ones.

Rule: if a model file declares an index, the manager does not declare it. Manager only owns indexes that need explicit `background:true` or specific naming.

Audit each manager entry against its schema; cherry-pick only the truly-additive ones.

### P3-4: Add missing performance indexes

Identified from Phase 0 slow-query analysis. Examples likely to appear:
- `wallets({ownerType:1, ownerId:1, status:1})` — for wallet status filtering
- `payouts({beneficiaryId:1, payoutType:1, status:1, createdAt:-1})` — for per-seller / per-rider payout history (current index is `(beneficiaryId, payoutType, status)` — missing createdAt sort)
- `financeauditlogs({orderId:1, action:1})` — for "all audit events for this order"
- `orderotps({orderMongoId:1, type:1, consumedAt:1, expiresAt:-1})` — covering index for OrderReturnService active-OTP lookup (current is `(orderId:1, type:1, expiresAt:-1)` which uses the public order ID, not the Mongo ref)

### P3-5: Replace regex-with-no-prefix-anchor in product search

`productController` likely uses `{name: {$regex: searchTerm, $options:"i"}}` without `^` — cannot use index. Switch to either:
1. `{name: {$regex: `^${escapeRegex(searchTerm)}`, $options:"i"}}` for prefix search, OR
2. `{$text: {$search: searchTerm}}` (text index already exists at `product.js:143`).

Decision: use text index when search term length ≥ 3; fall back to anchored regex otherwise.

### P3-6: Convert `databaseIndexManager` to a verification-only tool

After P3-1/P3-2 land, `createAllIndexes()` becomes idempotent and additive only — the bulk of indexes live in schemas. `verifyIndexes()` is kept as a startup diagnostic.

## 3.2 Acceptance Criteria for Phase 3

- [ ] Dead indexes dropped from production via migration script (5-minute window during low traffic).
- [ ] `databaseIndexManager.verifyIndexes()` reports `healthy:true`.
- [ ] No two indexes on the same keys (verify via `db.<col>.getIndexes()` parsing).
- [ ] No `IndexOptionsConflict` warning in startup logs.
- [ ] Slow query > 100ms count drops by ≥ 50% (from baseline captured in Phase 0).

## 3.3 Backward Compatibility

- 100% backward compatible — index changes are transparent to API consumers.
- `background: true` ensures no write blocking during creation.

## 3.4 Rollback (Phase 3)

- Re-running the index creation script with the OLD `databaseIndexManager.js` will re-create the wrong indexes (they're harmless, just unused).
- Schema-level indexes can't be rolled back individually without revert; risk is minimal.

---

# PHASE 4 — SCHEMA CANONICALIZATION (Legacy field deprecation)

**Objective:** mark `Order.payment.*` (nested doc), `Order.pricing.*` (nested doc), `User.walletBalance`, `Transaction` (collection) as **deprecated read-only**. All new writes go to canonical fields/collections. Legacy fields are populated by sync hooks during the transition.

**Effort:** 1 week. **Risk:** Medium. **Dependencies:** Phase 2 (canonical writers in place).

## 4.1 Tickets

### P4-1: Strengthen `Order` sync hooks

Add a `pre('findOneAndUpdate')` hook that, when `paymentStatus` or `orderStatus` or `status` is updated, derives the legacy mirror fields.

```js
orderSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() || {};
  const set = update.$set || update;

  if (set.paymentStatus) {
    const ps = set.paymentStatus;
    const legacy =
      ps === "PAID" ? "completed" :
      ps === "REFUNDED" ? "refunded" :
      ps === "FAILED" ? "failed" :
      "pending";
    set["payment.status"] = legacy;
  }
  if (set.status && !set.orderStatus) set.orderStatus = set.status;
  if (set.orderStatus && !set.status) set.status = set.orderStatus;
  ...
  next();
});
```

Tested at unit level: every `findOneAndUpdate` that touches a payment field updates both representations.

### P4-2: Make canonical fields the single read path

In query services (`orderQueryService.js`, `dashboardService.js`, etc.), prefer:
- `order.paymentStatus` over `order.payment.status`
- `order.paymentBreakdown.grandTotal` over `order.pricing.total`
- `wallet({ownerType:"CUSTOMER"}).availableBalance` over `user.walletBalance`

Add helper `getCustomerBalance(userId)` in `walletService` that reads from Wallet first, falls back to `User.walletBalance` if Wallet doesn't exist (legacy).

### P4-3: Transactional update of `User.walletBalance` from `Wallet`

In every Wallet credit/debit involving `ownerType:"CUSTOMER"`, also `User.findByIdAndUpdate({_id: ownerId}, {$inc: {walletBalance: ±amount}}, {session})`. Two-way sync.

When the codebase is verified to read from Wallet only (post-Phase 4b), remove the User-side write.

### P4-4: Migration script to backfill `Wallet` for customers with `walletBalance > 0`

Script ensures every User with `walletBalance > 0` has a corresponding `Wallet({ownerType:"CUSTOMER", ownerId:user._id, availableBalance: user.walletBalance})`.

See Part 4 §M4-1.

### P4-5: Backfill `LedgerEntry` from legacy `Transaction` rows

Idempotent script: for each `Transaction`, create a matching `LedgerEntry` only if no entry with `transactionId === Transaction.reference` exists.

Mapping table:
| `Transaction.type` | `LedgerEntry.type` | direction |
|---|---|---|
| `"Order Payment"` | `ORDER_ONLINE_PAYMENT_CAPTURED` (if paid) | CREDIT |
| `"Delivery Earning"` | `RIDER_PAYOUT_PROCESSED` | CREDIT |
| `"Withdrawal"` | `WITHDRAWAL` | DEBIT |
| `"Refund"` | `REFUND` | depends on actor |
| `"Cash Collection"` | `ORDER_COD_COLLECTED` | DEBIT |
| `"Cash Settlement"` | `COD_REMITTED` | DEBIT |
| `"Wallet Payment"` | `WALLET_REFUND` | DEBIT (customer wallet redemption) |
| `"Wallet Refund"` | `WALLET_REFUND` | CREDIT |
| `"Incentive"` / `"Bonus"` | `ADJUSTMENT` | CREDIT |

Detailed script in Part 4 §M4-2.

### P4-6: Update `walletAdminService` to read from `LedgerEntry` exclusively

After backfill, `walletAdminService.getAdminWalletOverview` already reads from `LedgerEntry` ✓. Audit the other methods (`getDeliveryTransactionsData`, `getSellerWithdrawalsData`, etc.) — they still read from `Transaction`. Switch to LedgerEntry-backed queries with a shim function `legacyTransactionToLedgerView()` for the response shape (preserves frontend contract).

### P4-7: Deprecate `Order.payment.*` and `Order.pricing.*` in code

Add JSDoc `@deprecated` on the schema fields:
```js
/**
 * @deprecated since Phase 4. Use `paymentStatus` instead. Kept as legacy mirror for frontend compatibility until Phase 7.
 */
payment: { ... },
```

### P4-8: Add reverse virtuals (zero-risk, optional adoption)

Add the virtuals listed in §4.2. Each is one Mongoose statement. No data impact.

### P4-9: Deprecate duplicate `Order.deliveryPartner` field

`deliveryBoy` and `deliveryPartner` carry the same FK. Pick `deliveryBoy` as canonical (used by all indexes). Stop writing `deliveryPartner` from controllers/services. Sync hook in pre('save') already mirrors them. Phase 7 removes `deliveryPartner` after frontend migration confirmed.

## 4.2 Acceptance Criteria for Phase 4

- [ ] `Order.pre('findOneAndUpdate')` hook keeps payment-status mirrors in sync; unit-tested.
- [ ] `getCustomerBalance(userId)` helper added; all wallet read sites that read `user.walletBalance` migrated.
- [ ] Backfill scripts run on staging, then production (off-peak window).
- [ ] `LedgerEntry` row count matches expected backfill count.
- [ ] Reverse virtuals added; at least one consumer (e.g. admin user-detail page) uses one virtual successfully.
- [ ] `walletAdminService` reads from ledger; frontend response shape unchanged.

## 4.3 Backward Compatibility

- `Order.payment.*` still readable; sync hook keeps it current.
- `Order.pricing.*` still readable.
- `User.walletBalance` still readable; backfill ensures wallets exist for migrated users.
- `Transaction` collection still readable + writable (writes happen alongside `LedgerEntry` until Phase 7 drop).
- Frontend response shapes unchanged.

## 4.4 Rollback (Phase 4)

- Removing the sync hook leaves drift but doesn't break reads.
- Backfill scripts are idempotent and don't delete legacy rows — re-running has no effect.
- Critical: hold Phase 4 in production for **≥ 30 days** before Phase 7 removes anything.

---

# PHASE 5 — NAMING ALIGNMENT & DUPLICATE-MODEL CONSOLIDATION

**Objective:** unify the `Customer`/`User` discriminator across all polymorphic refs. Consolidate OTP storage into `OtpSession` (deprecate `OtpVerification` + inline OTP fields).

**Effort:** 1 week. **Risk:** Medium. **Dependencies:** Phase 1 (broken refs already fixed).

## 5.1 Tickets

### P5-1: Introduce `app/constants/refModels.js`

```js
export const USER_MODEL_NAMES = Object.freeze({
  USER: "User",
  SELLER: "Seller",
  DELIVERY: "Delivery",
  ADMIN: "Admin",
});
export const ALL_USER_MODEL_NAMES = Object.freeze(Object.values(USER_MODEL_NAMES));
```

### P5-2: Update all polymorphic enums to use `ALL_USER_MODEL_NAMES`

Files:
- `app/models/notification.js:71` — drop `"Customer"`.
- `app/models/mediaMetadata.js:115` — `"Customer"` → `"User"`.
- `app/models/ticket.js:12` — `["Customer","Seller","Rider"]` → `["User","Seller","Delivery"]`.
- `app/modules/otp/otp.model.js:13` — `"Customer"` → `"User"`.
- `app/models/transaction.js:10-14` — already `["Seller","Delivery","Admin","User"]` ✓ (no change).

### P5-3: Migration script — rewrite `"Customer"` and `"Rider"` values

`backend/scripts/migrate-customer-to-user-discriminator.js` (Part 4 §M5-1).

Sample:
```js
await db.notifications.updateMany(
  { recipientModel: "Customer" },
  { $set: { recipientModel: "User" } },
);
await db.mediametadatas.updateMany(
  { uploadedByModel: "Customer" },
  { $set: { uploadedByModel: "User" } },
);
await db.tickets.updateMany(
  { userType: "Customer" },
  { $set: { userType: "User" } },
);
await db.tickets.updateMany(
  { userType: "Rider" },
  { $set: { userType: "Delivery" } },
);
await db.otpsessions.updateMany(
  { userType: "Customer" },
  { $set: { userType: "User" } },
);
```

### P5-4: Add `refPath` to `Payout.beneficiaryId`

```diff
+   beneficiaryModel: {
+     type: String,
+     enum: ["Seller", "Delivery"],
+     required: true,
+   },
    beneficiaryId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
+     refPath: "beneficiaryModel",
    },
```

Migration: derive `beneficiaryModel` from existing `payoutType`:
- `payoutType:"SELLER"` → `beneficiaryModel:"Seller"`
- `payoutType:"DELIVERY_PARTNER"` → `beneficiaryModel:"Delivery"`

```js
await db.payouts.updateMany({ payoutType: "SELLER" }, { $set: { beneficiaryModel: "Seller" } });
await db.payouts.updateMany({ payoutType: "DELIVERY_PARTNER" }, { $set: { beneficiaryModel: "Delivery" } });
```

### P5-5: Add `ref:"Admin"` to `Payout.createdBy`

`payout.js:53-56`:
```diff
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
+     ref: "Admin",
      default: null,
    },
```

### P5-6: Consolidate OTP storage

**Canonical: `OtpSession`** (mobile-OTP login).

**Step 1:** add a new write path. `otpAuthService.js` already uses `OtpSession`. Verify `customerAuthController.otpLogin`, `sellerAuthController.otpLogin`, `deliveryAuthController.otpLogin`, and `adminAuthController` (if any) all funnel through `otpAuthService` — NOT through inline `User.otp*` writes.

Migrate any direct writes:
- `customerAuthController` accesses `user.otp`, `user.otpHash`, `user.otpExpiresAt` etc. — replace with `otpAuthService.sendOtp` / `verifyOtp`.
- Same for delivery controller if it writes inline.

**Step 2:** Mark `OtpVerification` model deprecated; in code, `import OtpVerification` is replaced by `import OtpSession`. Add a deprecation log on `OtpVerification` model load (one-time).

**Step 3:** keep the inline OTP fields on `User` and `Delivery` schemas (don't remove yet). New writes go to OtpSession; old reads degrade gracefully.

**Step 4 (Phase 7):** drop inline OTP fields from `User` and `Delivery`.

### P5-7: Document the `Cart.customerId` vs `Order.customer` naming convention

Add an `app/models/README.md` (or expand existing) documenting:
- `xxxId` form used in models that bundle FK alongside their own `_id`.
- bare form used where the FK is the principal reference.
- Future schemas SHOULD follow established choice per existing model.

## 5.2 Acceptance Criteria for Phase 5

- [ ] All polymorphic enums use `ALL_USER_MODEL_NAMES`.
- [ ] Migration script run on staging; no rows left with deprecated discriminator values.
- [ ] `Payout.beneficiaryId` populated via `populate('beneficiaryId')` returns the correct model.
- [ ] All OTP login flows go through `otpAuthService` → `OtpSession`.
- [ ] No new writes to `OtpVerification` (verified by log + grep).
- [ ] `User.otp*` and `Delivery.otp*` inline fields receive no new writes (verified by 7-day observation post-deploy).

## 5.3 Backward Compatibility

- API request/response shapes unchanged (no public field is renamed).
- Backfill ensures every existing row has the canonical discriminator value.
- `Cart.customerId`, `Order.customer`, etc. all still point at the `User` model — the alias is internal.

## 5.4 Rollback (Phase 5)

- Discriminator migration is reversible: re-run with `User` → `Customer` (but we don't, because nothing depends on the old value after Phase 5).
- `OtpSession` was already used; the only behavior change is "writes now exclusive". Rollback = re-enable inline OTP writers.

---

# PHASE 6 — SOFT-DELETE · AUDIT-FIELD STANDARDIZATION · CASCADE HANDLING

**Objective:** every financially-relevant entity has `deletedAt`/`deletedBy`/`updatedBy`. Soft-delete is honored everywhere via Mongoose `pre('find')` hooks. Hard-delete events have audit entries.

**Effort:** 3 days. **Risk:** Low. **Dependencies:** Phase 1-2 merged.

## 6.1 Tickets

### P6-1: Add audit fields to financial entities

**Models:** `Order`, `Payment`, `Transaction`, `LedgerEntry`, `Payout`, `Wallet`, `FinanceAuditLog`, `Coupon`.

Add:
```js
deletedAt: { type: Date, default: null, index: true },
deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null }, // for admin-driven updates
```

These are nullable — won't affect existing rows. New writes can populate. Add a small middleware that wraps admin-side `findByIdAndUpdate` to inject `updatedBy: req.user.id`.

### P6-2: Soft-delete `pre('find')` filter on User, Seller, Delivery, Product, Coupon

```js
// Example for Product
productSchema.pre(/^find/, function(next) {
  // Only auto-filter when caller didn't explicitly query soft-deleted records.
  if (!this.getQuery().__includeDeleted) {
    this.where({ deletedAt: null });
  }
  next();
});
```

Add `Model.findIncludingDeleted = function(...)` helper to bypass when needed. Carefully audit existing call sites; any that today return inactive entities (admin lists) must opt in to `__includeDeleted`.

### P6-3: Cascade-on-customer-soft-delete

When `User.deletedAt` is set:
- `Cart.deleteOne({customerId: user._id})` — hard delete (no need to retain).
- `Wishlist.deleteOne({customerId: user._id})` — hard delete.
- `Order.find({customer: user._id})` — soft-delete each order? **NO** — financial records must be retained. Leave intact.

Encapsulate in `userLifecycleService.softDeleteCustomer(userId, adminId)`.

### P6-4: Cascade-on-product-soft-delete

When `Product.status = "inactive"` (existing soft-delete pattern):
- `Cart.updateMany({}, {$pull: {items: {productId: productId}}})` — already happens in cart controller's `sanitizeCartItems` filter via `populate match`. Verify.
- `Wishlist.updateMany({}, {$pull: {products: productId}})` — verify; if not, add.
- `Order.items[].product` — DO NOT touch. Orders are historical.

### P6-5: Validate three-level category chain on Product create/update

`Product` pre-save:
```js
productSchema.pre('save', async function(next) {
  if (this.isModified('headerId') || this.isModified('categoryId') || this.isModified('subcategoryId')) {
    const [header, cat, sub] = await Promise.all([
      mongoose.model('Category').findById(this.headerId).select('type parentId'),
      mongoose.model('Category').findById(this.categoryId).select('type parentId'),
      mongoose.model('Category').findById(this.subcategoryId).select('type parentId'),
    ]);
    if (!header || header.type !== 'header') return next(new Error('headerId must reference a header category'));
    if (!cat || cat.type !== 'category' || String(cat.parentId) !== String(header._id)) return next(new Error('categoryId must reference a category whose parent is the headerId'));
    if (!sub || sub.type !== 'subcategory' || String(sub.parentId) !== String(cat._id)) return next(new Error('subcategoryId must reference a subcategory whose parent is the categoryId'));
  }
  next();
});
```

### P6-6: Setting singleton enforcement

`setting.js` pre('save'):
```js
settingSchema.pre('save', async function(next) {
  if (this.isNew && !this.tenantId) {
    const existing = await mongoose.model('Setting').findOne({ tenantId: null });
    if (existing) return next(new Error('Default Setting document already exists'));
  }
  next();
});
```

### P6-7: Coupon usage tracking (`CouponUsage` collection)

New model:
```js
const couponUsageSchema = new mongoose.Schema({
  coupon: { type: ObjectId, ref: "Coupon", required: true, index: true },
  customer: { type: ObjectId, ref: "User", required: true, index: true },
  order: { type: ObjectId, ref: "Order", required: true, index: true },
  discountApplied: { type: Number, required: true },
  usedAt: { type: Date, default: Date.now },
}, { timestamps: true });
couponUsageSchema.index({ coupon: 1, customer: 1 });
```

Write a row inside the order-placement transaction whenever a coupon is applied. Enforce `perUserLimit` via `CouponUsage.countDocuments({coupon, customer}) < perUserLimit`.

### P6-8: Audit hard-delete events

Wherever `Model.deleteOne/deleteMany/findByIdAndDelete` is called (audit grep), wrap with a `recordDeletion(model, doc, actor)` helper that writes to `FinanceAuditLog` (or a generic `EntityAuditLog` if non-financial).

### P6-9: Ticket message archival

`Ticket.messages[]` cap at 100. When exceeded, archive oldest 50 to a `TicketMessageArchive` collection.

Implementation: pre-save guard + a separate `archiveOldMessages(ticketId)` admin tool.

## 6.2 Acceptance Criteria for Phase 6

- [ ] All targeted models have `deletedAt`, `deletedBy`, `updatedBy` fields.
- [ ] Soft-delete `pre('find')` hooks pass unit tests.
- [ ] Customer soft-delete cascades cart and wishlist.
- [ ] Product moderation cascades cart removal.
- [ ] Coupon usage tracked per customer; `perUserLimit` enforcement test passes.
- [ ] Settings singleton invariant enforced.
- [ ] Three-level category chain validation works.

## 6.3 Backward Compatibility

- All new fields are nullable; existing rows continue working.
- `pre('find')` hooks can be bypassed by admin code via `__includeDeleted`.

## 6.4 Rollback (Phase 6)

- Disable hooks by reverting model files.
- Cascade logic is encapsulated in service functions; revert the service.

---

# PHASE 7 — FINAL CLEANUP (Removes deprecated fields)

**Objective:** drop fields and collections that have been deprecated since Phase 4-5 and have soaked in production for ≥ 30 days with zero reads.

**Effort:** 2 days. **Risk:** Medium. **Dependencies:** Phase 4, 5 in production for ≥ 30 days; frontend confirmed to no longer read legacy fields.

## 7.1 Tickets

### P7-1: Remove `Order.payment.*` nested doc (legacy)

Migration:
1. Confirm zero frontend reads via log analysis.
2. Add an `unset` migration to strip `payment` field from all orders.
3. Remove the schema field.

### P7-2: Remove `Order.pricing.*` nested doc (legacy)

Same pattern as P7-1.

### P7-3: Remove `Order.deliveryPartner`

Migration unsets the field.

### P7-4: Remove `User.walletBalance`

After confirming all reads go through `walletService.getCustomerBalance()`.

### P7-5: Drop `Transaction` collection (after all data backfilled to `LedgerEntry`)

Rename collection to `transactions_archive` (don't drop — keep for emergency rollback). Update model file to either delete or repoint to the archive.

### P7-6: Drop `OtpVerification` collection

Same: archive don't delete.

### P7-7: Remove inline OTP fields from `User` and `Delivery`

Migration unsets the fields.

### P7-8: Remove `OfferSection.categoryId` (singular, legacy)

After confirming `categoryIds[]` carries the value.

### P7-9: Remove `notification.recipient`/`recipientModel` (legacy)

If `userId`/`role` is fully adopted. Otherwise defer.

## 7.2 Acceptance Criteria for Phase 7

- [ ] All listed fields/collections removed (or archived).
- [ ] Full test suite green.
- [ ] No production error spike for 7 days post-deploy.

## 7.3 Backward Compatibility

This is the first phase that breaks backward compatibility — but only of fields that have been formally deprecated and are confirmed unread.

## 7.4 Rollback (Phase 7)

- Re-add removed fields with `default: null` — no data is restored (archived collections are still queryable for emergency).
- Recommended: hold archived collections for ≥ 6 months before final deletion.

---

# DEPENDENCY ORDER SUMMARY

```
Phase 0 (audit) ── must complete before any other phase
   │
   ├── Phase 1 (correctness) ── independent
   │
   ├── Phase 2 (transactions + ledger) ── depends on Phase 1
   │      │
   │      └── Phase 3 (index hygiene) ── can run in parallel with Phase 2 if separate engineers
   │
   ├── Phase 4 (canonicalization) ── depends on Phase 2 (canonical writers must exist first)
   │      │
   │      └── Phase 5 (naming alignment) ── depends on Phase 1 (broken refs already fixed)
   │
   ├── Phase 6 (soft-delete + audit) ── depends on Phase 2 (audit-log infrastructure)
   │
   └── Phase 7 (final cleanup) ── depends on ALL prior + 30-day production soak
```

Critical path: 0 → 1 → 2 → 4 → 7. Minimum ~3 weeks if sequential. With parallel teams: ~2.5 weeks.

---

# CROSS-PHASE THEMES

## T1 — Wrap and Improve (default for every refactor)

Per the existing `safe-refactor-strategy` skill: every extraction starts as a wrapper around existing logic. The legacy code path stays callable until verified obsolete.

Example: `applyReturnRefund` (Phase 2) is a wrapper around the existing inline logic. Once tests prove parity, the inline block in `orderController` is replaced by the wrapper call. No surprise breakage.

## T2 — Feature flags

Every potentially-risky change has an env-var off switch:
- `FINANCE_VERIFIER_ENABLED=true|false`
- `LEDGER_AUTO_CREATE_ON_WALLET=true|false` (when set false, falls back to Phase 1 behavior)
- `SOFT_DELETE_FILTERS_ENABLED=true|false`
- `OTP_CONSOLIDATION_ENABLED=true|false`

## T3 — Observability

Every phase adds:
- Structured log lines with `phase` tag and `correlationId`.
- Prom metrics: `ledger_entries_created_total`, `wallet_drift_detected_total`, `index_verification_missing_total`.
- Sentry breadcrumb on every transactional commit/abort.

## T4 — Tests are the contract

Each acceptance criterion translates to a CI test. The test suite is the executable form of this plan. If a test fails, the corresponding phase is incomplete.

---

End of Part 3. **Part 4** contains the migration scripts, testing checklist, rollback procedures, risk matrix, and backward-compatibility verification protocol.
