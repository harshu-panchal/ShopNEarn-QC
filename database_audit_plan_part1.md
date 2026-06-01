# Appzeto Quick-Commerce — Production-Grade Database Audit & Implementation Plan
## Part 1 of 4: Executive Summary · Architecture Snapshot · Critical Findings · Model Inventory

> **Audit goal:** verify every API persists and reads from the database correctly, eliminate orphan fields, fix broken associations, restore single-source-of-truth, and produce an execution-ready, backward-compatible roadmap.
> **Constraint:** preserve existing flows, prefer wrap-and-improve over rewrites, every change must be independently deployable with a sub-5-minute rollback.
> **Scope:** `backend/app/**` only. Frontend integration touchpoints noted but not refactored here.

---

# 0. EXECUTIVE SUMMARY

## 0.1 Highest-Impact Findings (Read First)

| # | Finding | Risk | Files of Record | Phase |
|---|---|---|---|---|
| **C-1** | `cart.js`, `wishlist.js`, `checkoutGroup.js` all declare `ref: "Customer"` — **no model named `"Customer"` is registered anywhere**. The customer file at `app/models/customer.js` registers as `mongoose.model("User", …)`. Any `populate('customerId')` on these collections silently returns `null`. | **Critical** | `app/models/cart.js:7`, `app/models/wishlist.js:7`, `app/models/checkoutGroup.js:19`, `app/models/customer.js:133` | Phase 1 |
| **C-2** | `Transaction.type` enum does **not** include `"Wallet Payment"`, yet `orderPlacementService.js:451` writes that exact literal inside the order-placement transaction. Any checkout that redeems wallet balance throws a `ValidationError` and aborts the transaction. | **Critical** | `app/services/orderPlacementService.js:448-456`, `app/models/transaction.js:21` | Phase 1 |
| **C-3** | `walletService.creditWallet/debitWallet` mutate the `wallets` collection **without writing a matching `LedgerEntry`**. The "canonical" ledger is therefore incomplete: refund flows, return-pickup commissions, COD adjustments, and other direct wallet calls produce zero audit rows. | **Critical** | `app/services/finance/walletService.js:57-116`, `app/controller/orderController.js:1020-1077`, `app/services/finance/ledgerService.js` (only 8 call-sites repo-wide) | Phase 2 |
| **C-4** | The return-refund flow in `orderController.js` (~lines 950-1098) performs **6+ writes across 4 collections without `mongoose.startSession()`**: customer wallet credit, Transaction insert, seller wallet debit, Transaction insert, delivery wallet credit, Transaction insert, order save. Any mid-flight failure leaves the order half-refunded. | **Critical** | `app/controller/orderController.js:949-1098` | Phase 2 |
| **C-5** | `databaseIndexManager.js` registers indexes on **fields and collections that don't exist**: `withdrawals` (no such collection — withdrawals live in `transactions` with `type:"Withdrawal"`), `transactions.userId` (schema field is `user`), `notifications.read` (schema field is `isRead`), `ledgerentries.ownerType` (schema field is `actorType`). These are dead indexes that consume RAM and mislead future devs. | **High** | `app/services/databaseIndexManager.js:44-52, 57-58, 99-102, 110-114` | Phase 3 |
| **C-6** | Triple bookkeeping: financial state of an order is mirrored in `payment` (nested doc on Order, legacy), `paymentMode + paymentStatus` (top-level on Order, current), `payments` collection (gateway-level), `transactions` collection (legacy ledger), `ledgerentries` (canonical ledger), and `wallets` (balance only). Drift between them is unbounded. | **High** | `app/models/order.js`, `app/models/payment.js`, `app/models/transaction.js`, `app/models/ledgerEntry.js`, `app/models/wallet.js` | Phase 4 |
| **C-7** | `User` (file `customer.js`) carries `walletBalance: Number` directly on the document. `Wallet` (separate model) also tracks the same money keyed on `ownerType:"CUSTOMER", ownerId`. Two writers, no invariant. | **High** | `app/models/customer.js:107-110`, `app/models/wallet.js`, `app/services/orderPlacementService.js:445-446`, `app/controller/orderController.js:972-973` | Phase 4 |
| **C-8** | Five distinct OTP storage locations: `app/models/otpVerification.js`, `app/models/orderOtp.js`, `app/modules/otp/otp.model.js` (`OtpSession`), inline OTP fields on `customer.js` (8 fields), inline OTP fields on `delivery.js` (2 fields). Three of them duplicate "OTP for login by mobile" with different shapes. | **High** | `app/models/otpVerification.js`, `app/models/orderOtp.js`, `app/modules/otp/otp.model.js`, `app/models/customer.js:62-103`, `app/models/delivery.js:100-108` | Phase 5 |
| **C-9** | Naming-discriminator chaos for the customer entity. The actual Mongoose model is `User`. Polymorphic `refPath` enums variously allow `"User"`, `"Customer"`, or both, depending on file:<br>• `transaction.userModel` → `["Seller","Delivery","Admin","User"]` ✓ correct<br>• `notification.recipientModel` → `["Seller","Admin","Customer","Delivery","User"]` ✗ allows both<br>• `mediaMetadata.uploadedByModel` → `["Customer","Seller","Admin","Delivery"]` ✗ wrong<br>• `ticket.userType` → `["Customer","Seller","Rider"]` ✗ wrong **and** uses `"Rider"` instead of `"Delivery"`<br>• `otp.model.js userType` → `["Admin","Seller","Customer","Delivery"]` ✗ wrong | **High** | `app/models/transaction.js:13`, `app/models/notification.js:71`, `app/models/mediaMetadata.js:115`, `app/models/ticket.js:12`, `app/modules/otp/otp.model.js:13` | Phase 5 |
| **C-10** | `order.customer` is declared `ref: "User"` and **required: true**, but the same schema also carries the legacy nested `payment.{method,status,transactionId}` doc whose statuses (`pending/completed/failed/refunded`) drift from the canonical `paymentStatus` enum (`CREATED/PAID/CASH_COLLECTED/…`). Pre-save hook copies values one way at insert time only — subsequent updates desynchronize. | **High** | `app/models/order.js:63-106, 492-533`, `app/controller/orderController.js:1080-1082` | Phase 4 |

> **Note on severity language:** "Critical" means a production correctness or financial-integrity bug that can be triggered by routine user actions. "High" means a class of defect that compounds with every new feature touching the area.

## 0.2 What Is NOT Broken (Keep As-Is)

| Strength | Evidence |
|---|---|
| Order placement happens inside a real `mongoose.startSession()` + `withTransaction()` with `snapshot` read concern and `majority` write concern. | `app/services/orderPlacementService.js:276-282` |
| `orderFinanceService.js` settlement paths consistently create `LedgerEntry` rows alongside wallet movements and pass `session` correctly. | `app/services/finance/orderFinanceService.js:291, 357, 505, 669, 686, 774, 807` |
| `payoutService.js` writes ledger entries on both queue and process, all under one transaction. | `app/services/finance/payoutService.js:79, 249` |
| `Payment` schema (gateway record) has proper compound unique partial index on `(order, idempotencyKey)` with `partialFilterExpression`. | `app/models/payment.js:156-164` |
| `Order` has a **partial TTL index** on `placement.idempotencyKeyExpiry` — correct shape. | `app/models/order.js:484-490` |
| `OtpVerification` and `OtpSession` both have TTL indexes on `expiresAt`. | `app/models/otpVerification.js:53-56`, `app/modules/otp/otp.model.js:57-60` |
| `Order.pre('findOneAndUpdate')` blocks `$unset:{customer:1}` and `$set:{customer:null}` — guards a critical invariant. | `app/models/order.js:535-548` |
| `Setting` and `Category` both ship pre-save hooks that keep legacy+new finance fields in sync — buys time while migration happens. | `app/models/category.js:117-229`, `app/models/setting.js:170-201` |
| Geocode cache, search-index-failure, dashboard-stats, finance-reports, seller-metrics are read-optimized denormalized models with proper TTL/unique indexes. They are **not** primary truth — fine as-is. | `app/models/geocodeCache.js`, `app/models/searchIndexFailure.js`, `app/models/dashboardStats.js`, `app/models/financeReports.js`, `app/models/sellerMetrics.js` |
| Domains scaffold (`app/domains/<entity>/`) exists as re-export shims — no logic moved yet, no breakage. | `app/domains/README.md` |

## 0.3 Phase-Level Summary

| Phase | Name | Effort | Risk | Why this order |
|---|---|---|---|---|
| **0** | Pre-flight: read-only audit verification | 1d | None | Confirms every finding on the live cluster before touching code. |
| **1** | Correctness fixes (broken refs, broken enums) | 2d | Low | Bugs that can throw in prod or silently corrupt data. Zero schema migration. |
| **2** | Transactional & ledger integrity | 4d | Medium | Wraps existing refund/return/cash flows in sessions; auto-creates ledger entries inside wallet service. |
| **3** | Index hygiene | 2d | Low | Removes dead indexes, adds genuinely missing ones, dedupes schema↔manager overlap. |
| **4** | Schema canonicalization (legacy field deprecation) | 1w | Medium | Marks `Order.payment.*`, `User.walletBalance`, `Transaction` as deprecated. Read-only legacy, all new writes go to canonical fields. |
| **5** | Naming alignment + duplicate model consolidation | 1w | Medium | `Customer` ⟷ `User` ref correction, OTP consolidation, polymorphic enum cleanup. |
| **6** | Soft-delete + audit-field standardization | 3d | Low | Adds `deletedAt/deletedBy/updatedBy` where missing on financially-relevant entities; introduces `pre('find')` hook to auto-filter. |
| **7** | Final cleanup: remove deprecated fields & legacy collections | 2d | Medium | Only after Phase 4 has soaked in production for ≥ 30 days. |

Total ≈ **4-5 weeks** end-to-end. Every phase is independently mergeable and rollback-able.

---

# 1. CURRENT ARCHITECTURE SNAPSHOT (data-layer view)

## 1.1 Stack

| Layer | Tech | Notes |
|---|---|---|
| ODM | Mongoose 8 | ESM imports throughout. |
| Storage | MongoDB (replica set required for the transactions used in `orderPlacementService` and `orderFinanceService`). | Confirmed via `mongoose.startSession()` + `session.startTransaction({ readConcern: 'snapshot', writeConcern: 'majority' })` in placement service. |
| Cache | Redis (ioredis) via `cacheService.js` with SCAN-based pub/sub invalidation. | `app/services/cacheService.js` |
| Queue | Bull (Redis-backed) — seller/delivery timeout, notification queue, search-sync queue. | `app/queues/`, `app/modules/notifications/notification.queue.js`, `app/services/searchSyncService.js` |
| Scheduler | Distributed scheduler with Redis lock. | `app/services/distributedScheduler.js` |
| Idempotency | Server-side via `idempotencyService.js` + DB-backed via partial unique indexes on `Order.placement.idempotencyKey` and `CheckoutGroup.placement.idempotencyKey` and `Payment.(order,idempotencyKey)`. | Three layers; all needed because Redis isn't authoritative. |

## 1.2 Process roles

`backend/index.js` separates `HTTP / Worker / Scheduler` startup paths. All three open Mongoose connections; the index manager (`databaseIndexManager.createAllIndexes()`) runs at boot. Workers consume Bull queues; scheduler fires distributed crons.

## 1.3 Routes → Domains map (top-level)

From `app/routes/index.js`:

| Mount | Router file | Domain |
|---|---|---|
| `/api/customer` | `customerAuth.js` | customer auth + profile |
| `/api/delivery` | `deliveryAuth.js` | delivery auth + workflow |
| `/api/admin/categories` | `categoryRoutes.js` | category mgmt (admin surface, mounted twice — see anomaly below) |
| `/api/admin` | `adminAuth.js` | admin auth + finance + dashboard + cash settlement + users |
| `/api/seller` | `sellerAuth.js` | seller auth + dashboard + withdrawals |
| `/api/settings` | `settingsRoutes.js` | system settings |
| `/api/categories` | `categoryRoutes.js` | **same handler as admin/categories** — public browsing surface |
| `/api/products` | `productRoutes.js` | product CRUD + public listing |
| `/api/cart` | `cartRoutes.js` | customer cart |
| `/api/wishlist` | `wishlistRoutes.js` | customer wishlist |
| `/api/orders` | `orderRoutes.js` | order lifecycle (customer, seller, delivery, admin) |
| `/api/payments` | `paymentRoutes.js` | gateway init / callback / verify |
| `/api/maps` | `mapsRoutes.js` | maps proxy (geocode cache) |
| `/api/media` | `mediaRoutes.js` | Cloudinary upload + metadata |
| `/api/` (root) | `experienceRoutes.js`, `offerRoutes.js`, `couponRoutes.js` | Mounted at `/` because each router uses absolute paths internally. **Intentional but a smell.** |
| `/api/notifications` | `notificationRoutes.js` | in-app notification log + read-state |
| `/api/auth/otp` | `app/modules/otp/otp.routes.js` | unified OTP send/verify endpoints |
| `/api/push` | `pushRoutes.js` | push-token registration |
| `/api/tickets` | `ticketRoutes.js` | customer/seller/rider support tickets |
| `/api/reviews` | `reviewRoutes.js` | product reviews |
| `/api/admin/faqs`, `/api/public/faqs` | `faqRoutes.js` | FAQ — also mounted twice (intentional) |
| `/health`, `/metrics` | health/metrics | unmounted under `/api` (correct for probes) |

**Anomaly 1 (intentional):** `categoryRoutes` is mounted at both `/admin/categories` and `/categories`. The route file declares the same handlers; auth is enforced inside handlers. Same for `faqRoutes` (`/admin/faqs` + `/public/faqs`). The comments in `routes/index.js` explicitly call this out — keep it, but Phase 6 will introduce a single `categoryReadRouter` + `categoryAdminRouter` split.

**Anomaly 2 (intentional but smelly):** `experienceRoute`, `offerRoute`, `couponRoute` are mounted at `/` because each router has absolute paths. Phase 6 cleanup migrates them to relative prefixes.

## 1.4 Models inventory

37 schemas under `app/models/` + 4 under `app/modules/` (`notification.model.js` — re-export, `preference.model.js`, `token.model.js`, `otp.model.js`):

| File | `mongoose.model(...)` name | Collection | Purpose | Status |
|---|---|---|---|---|
| `admin.js` | `Admin` | `admins` | Admin user + bcrypt password | OK |
| `cart.js` | `Cart` | `carts` | Customer-owned cart, 1:1 with customer | **Broken `ref:"Customer"` on `customerId`** |
| `category.js` | `Category` | `categories` | Tree (header/category/subcategory) via self `parentId`; commission + handling-fee config | Healthy (legacy alias hooks active) |
| `checkoutGroup.js` | `CheckoutGroup` | `checkoutgroups` | Multi-seller cart→checkout aggregator. 1 group → N orders | **Broken `ref:"Customer"` on `customer`** |
| `coupon.js` | `Coupon` | `coupons` | Coupon definitions | Healthy. No usage tracking model. |
| `customer.js` | **`User`** | `users` | **Customer** (despite the filename). `role` enum allows `user/admin/delivery/seller` but only `user` rows live here. | **Filename ↔ model name mismatch is the root of half the chaos in this codebase** |
| `dashboardStats.js` | `DashboardStats` | `dashboardstats` | Async precomputed metrics (read-side) | Healthy |
| `delivery.js` | `Delivery` | `deliveries` | Rider profile + GPS + 2dsphere index | Inline OTP fields duplicate OtpSession |
| `deliveryAssignment.js` | `DeliveryAssignment` | `deliveryassignments` | Broadcast lifecycle: candidates → winner | Healthy. `meta:Mixed` |
| `experienceSection.js` | `ExperienceSection` | `experiencesections` | Home-page CMS sections | Healthy |
| `faq.js` | `FAQ` | `faqs` | FAQs by audience | Healthy |
| `financeAuditLog.js` | `FinanceAuditLog` | `financeauditlogs` | Audit trail for finance-affecting ops | Healthy. Underused — many finance writes don't audit. |
| `financeReports.js` | `FinanceReports` | `financereports` | Daily aggregate cache | Healthy |
| `geocodeCache.js` | `GeocodeCache` | `geocodecaches` | TTL'd map-lookup cache | Healthy |
| `heroConfig.js` | `HeroConfig` | `heroconfigs` | Hero banner config | Healthy |
| `ledgerEntry.js` | `LedgerEntry` | `ledgerentries` | Canonical double-entry ledger | **Not written from `walletService` — under-used** |
| `mediaMetadata.js` | `MediaMetadata` | `mediametadatas` | Cloudinary asset metadata | `uploadedByModel` enum uses `"Customer"` ✗ |
| `notification.js` | `Notification` | `notifications` | Push + in-app log (unified) | Dual schema (legacy `recipient/recipientModel` + new `userId/role`), `recipientModel` enum includes `"Customer"` ✗ |
| `offer.js` | `Offer` | `offers` | Marketing offer config | Healthy |
| `offerSection.js` | `OfferSection` | `offersections` | Offer landing-strip config | `categoryId` (legacy) + `categoryIds[]` (new) coexist |
| `order.js` | `Order` | `orders` | **THE central document** (14 KB schema) | Multiple deprecated mirror fields (see §3.1) |
| `orderOtp.js` | `OrderOtp` | `orderotps` | Delivery + return-pickup + return-drop OTPs | Healthy |
| `otpVerification.js` | `OtpVerification` | `otpverifications` | Generic OTP-by-(purpose,channel,target) | Overlaps with `OtpSession` |
| `payment.js` | `Payment` | `payments` | Gateway-side payment record | Healthy. Best-modeled of the finance group. |
| `paymentWebhookEvent.js` | `PaymentWebhookEvent` | `paymentwebhookevents` | Idempotent webhook log | Healthy |
| `payout.js` | `Payout` | `payouts` | Seller / rider payout requests | `beneficiaryId` has no `refPath` — silent polymorphism |
| `product.js` | `Product` | `products` | Products, three Category refs, variants | Healthy. No soft-delete (uses `status:"inactive"`). |
| `review.js` | `Review` | `reviews` | Product reviews | Healthy |
| `searchIndexFailure.js` | `SearchIndexFailure` | `searchindexfailures` | Failed-search-sync log | Healthy |
| `seller.js` | `Seller` | `sellers` | Seller profile + 2dsphere | Healthy |
| `sellerMetrics.js` | `SellerMetrics` | `sellermetrics` | Daily seller aggregates | Healthy |
| `setting.js` | `Setting` | `settings` | Global config (singleton-ish) | Legacy aliases kept in sync via hook |
| `stockHistory.js` | `StockHistory` | `stockhistories` | Stock movement audit | Healthy |
| `ticket.js` | `Ticket` | `tickets` | Support tickets | `userType:["Customer","Seller","Rider"]` ✗ |
| `transaction.js` | `Transaction` | `transactions` | **Legacy** ledger using `refPath:'userModel'` | Heavily used despite being legacy — see §3.2 |
| `wallet.js` | `Wallet` | `wallets` | Multi-tenant balances (`ownerType,ownerId`) | Healthy. Compound unique partial index OK. |
| `wishlist.js` | `Wishlist` | `wishlists` | Customer wishlist | **Broken `ref:"Customer"` on `customerId`** |
| `modules/notifications/token.model.js` | `PushToken` | `pushtokens` | FCM device tokens | Healthy |
| `modules/notifications/preference.model.js` | `NotificationPreference` | `notificationpreferences` | Per-user notification toggles | Healthy |
| `modules/otp/otp.model.js` | `OtpSession` | `otpsessions` | Mobile-OTP login sessions | **Duplicates `OtpVerification`** |

**Dead-model search:** no schemas exist for `Withdrawal`, `Refund`, `Return`, `Cancellation`, `OrderEvent`. The first three are absorbed into `Transaction.type` + `Order` embedded fields; lifecycle events flow through `workflowStatus` enum + `WORKFLOW_STATUS` constants — no event log persisted. Phase 4 evaluates whether dedicated models are warranted.

---

# 2. CROSS-CUTTING CRITICAL FINDINGS (P0 + P1)

Each finding is repeated here in full evidence + root-cause + remediation framing. Phase numbers refer to Part 3.

## 2.1 [P0-C1] Broken `ref:"Customer"` on three core collections

**Evidence:**
```7:9:backend/app/models/cart.js
        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
```
```5:11:backend/app/models/wishlist.js
        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true,
            unique: true,
        },
```
```17:23:backend/app/models/checkoutGroup.js
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
```
The actual registered model is `User`:
```133:133:backend/app/models/customer.js
export default mongoose.model("User", userSchema);
```
The 4 models that correctly reference the customer entity use `ref:"User"`:
```17:21:backend/app/models/order.js
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
```
`payment.js:62-66`, `review.js:5-9`, `ticket.js:5-9` all use `ref:"User"` correctly.

**Why nothing visibly explodes today:** `cartController.js`, `wishlistController.js`, and `checkoutGroup`-related services **never call `populate('customerId')` or `populate('customer')`** on these three models. They only populate `items.productId` / `items.product`. So the broken ref is dormant. The moment any future feature does `Cart.findById(id).populate('customerId')`, it will silently return a cart with `customerId === null` — the kind of bug that takes a quarter to diagnose.

**Root cause:** the original schema author treated the file name (`customer.js`) as authoritative. Later refactors normalized authentication into a unified `User` collection but did not update the 3 affected schemas.

**Fix (Phase 1, ≤ 1 hour, zero migration):**
1. Replace `ref: "Customer"` with `ref: "User"` in those 3 files.
2. Add an explicit no-op startup assertion in `app/core/startup.js`:
   ```js
   const customerModelName = "User";
   if (!mongoose.modelNames().includes(customerModelName)) {
     throw new Error("Customer model alias missing — refactor regression");
   }
   ```
3. Add a unit test that runs `Cart.populate('customerId')` and asserts the populated doc is non-null. Same for Wishlist and CheckoutGroup.

**Rollback:** single-commit revert. No data shape changes.

---

## 2.2 [P0-C2] `orderPlacementService` writes invalid `Transaction.type` literal

**Evidence:**
```19:23:backend/app/models/transaction.js
        type: {
            type: String,
            enum: ["Order Payment", "Delivery Earning", "Withdrawal", "Refund", "Incentive", "Bonus", "Cash Collection", "Cash Settlement"],
            required: true,
        },
```
```448:456:backend/app/services/orderPlacementService.js
      await Transaction.create({
        user: customerId,
        userModel: "User",
        type: "Wallet Payment",
        amount: -walletAmount,
        status: "Settled",
        reference: `WLT-CHOUT-${checkoutGroupId}`,
        meta: { checkoutGroupId }
      }, { session });
```
The literal `"Wallet Payment"` is **not** in the enum. Mongoose schema validation will throw a `ValidationError` on `.create()`. The surrounding `withTransaction()` will roll back. **Every checkout that uses wallet balance fails.**

**Likely current state of production:** this code path is never exercised because the frontend doesn't expose wallet redemption at checkout, OR `walletAmount` is always 0. Confirm in Phase 0 audit. Either way, the bug is dormant land-mine.

**Fix (Phase 1):**
- Add `"Wallet Payment"` and `"Wallet Refund"` to the enum on `transaction.js` (forward-compatible).
- In parallel, the canonical fix in Phase 4 retires `Transaction` writes from `orderPlacementService` and replaces them with `createLedgerEntry({ actorType: "CUSTOMER", type: LEDGER_TRANSACTION_TYPE.WALLET_REFUND, direction: "DEBIT", … }, { session })`. `LEDGER_TRANSACTION_TYPE` already has the constant.

---

## 2.3 [P0-C3] `walletService` mutates balance without writing a `LedgerEntry`

**Evidence:**
```57:83:backend/app/services/finance/walletService.js
export async function creditWallet({
  ownerType,
  ownerId,
  amount,
  bucket = "available",
  session,
}) {
  const normalizedAmount = assertPositiveAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, { session });

  if (wallet.status !== WALLET_STATUS.ACTIVE) {
    throw new Error("Wallet is not active");
  }

  const before = wallet[`${bucket}Balance`];
  wallet[`${bucket}Balance`] = addMoney(before, normalizedAmount);
  wallet.totalCredited = addMoney(wallet.totalCredited, normalizedAmount);

  await wallet.save({ session });
  return {
    wallet,
    amount: normalizedAmount,
    before: roundCurrency(before),
    after: roundCurrency(wallet[`${bucket}Balance`]),
    bucket,
  };
}
```
No `createLedgerEntry()` call inside. Same for `debitWallet`, `movePendingToAvailable`, `updateCashInHand`.

**Cross-reference of every `createLedgerEntry` caller (whole repo):**
- `app/services/finance/payoutService.js:79, 249`
- `app/services/finance/orderFinanceService.js:291, 357, 505, 669, 686, 774, 807`
- nowhere else.

So any wallet movement triggered from outside those two services produces **zero ledger rows** — e.g. the return-refund flow at `orderController.js:1020-1077`.

**Fix (Phase 2):**
1. Refactor `creditWallet` / `debitWallet` / `movePendingToAvailable` to accept a richer payload (`type`, `orderId`, `payoutId`, `metadata`, `reference`) and write a matching `LedgerEntry` inside the same session. The new signature is **strictly additive** — old callers continue working.
2. Replace every call site to pass the metadata (compile-time TypeScript would have caught this; in JS we rely on a code-grep + tests).
3. Add a startup-time assertion: if a non-test environment encounters `wallet.totalCredited - wallet.totalDebited !== balance sum across buckets`, log a finance-alert warning (already audited via `financeAuditLog`).

---

## 2.4 [P0-C4] Return-refund flow is non-transactional

**Evidence:** `orderController.js:949-1098` performs the following writes in order — none of them share a `session`:

| Step | Operation | Collection |
|---|---|---|
| 1 | `customer.save()` to bump `walletBalance` | `users` |
| 2 | `Transaction.create({ type: "Refund" })` | `transactions` |
| 3 | `cancelPendingPayoutForOrder()` OR `debitWallet({ ownerType:"SELLER" })` | `payouts` / `wallets` |
| 4 | `Order.findByIdAndUpdate({ "settlementStatus.sellerPayout": "CANCELLED" })` | `orders` |
| 5 | `Transaction.create({ user: seller, type: "Refund", amount: -adjustment })` | `transactions` |
| 6 | `walletService.creditWallet({ ownerType:"DELIVERY_PARTNER" })` | `wallets` |
| 7 | `Transaction.create({ user: returnDeliveryBoy, type: "Delivery Earning" })` | `transactions` |
| 8 | `order.save()` with `returnStatus:"refund_completed"` + `payment.status:"refunded"` | `orders` |

Any error between step 1 and step 8 leaves the order in a **partially refunded** state. Bullet-point examples:
- Customer wallet credited but Order not updated → customer can re-request refund.
- Seller debited but no audit trail in `LedgerEntry`.
- Rider commission paid twice (once at pickup OTP and once here) if `commissionAlreadyPaid` flag wasn't set before crash.

**Fix (Phase 2):**
1. Extract entire body into `app/services/order/orderRefundService.js:applyReturnRefund(orderId, { session })`.
2. Wrap in `mongoose.startSession() + withTransaction()`.
3. Replace direct `Transaction.create` calls with `createLedgerEntry()` (Phase 4 will deprecate `Transaction` entirely, but the new ledger entries should be created *immediately* in Phase 2; the legacy `Transaction.create` calls remain in parallel during the transition).
4. Add `FinanceAuditLog.create({ action: FINANCE_AUDIT_ACTION.FINANCE_ADJUSTMENT_APPLIED, … }, { session })` at the end of the transaction.

---

## 2.5 [P1-C5] `databaseIndexManager.js` references non-existent collections and fields

**Detailed map:**

| File:Line | Declared | Reality | Impact |
|---|---|---|---|
| `databaseIndexManager.js:99-102` | indexes on `withdrawals` collection | No `withdrawals` collection exists; withdrawals are `Transaction.type:"Withdrawal"` rows in `transactions`. | Dead — Mongo creates an empty collection with these indexes. Confuses devs. |
| `databaseIndexManager.js:44-46` | `transactions: { userId: 1, createdAt: -1, type: 1 }` | Schema field is `user`, not `userId`. | Index exists on a never-queried field; query planner ignores it. |
| `databaseIndexManager.js:47` | `transactions: { userId: 1, status: 1, createdAt: -1 }` | Same — `user`, not `userId`. | Dead. |
| `databaseIndexManager.js:50` | `transactions: { user: 1, userModel: 1, status: 1, createdAt: -1 }` | Schema fields match. | **Good** — but doesn't help the `walletAdminService.getSellerWithdrawalsData` query which filters by `{userModel, type}` — `type` isn't in the index. |
| `databaseIndexManager.js:58` | `notifications: { recipient: 1, read: 1, createdAt: -1 }` | Schema field is `isRead`. | Dead. |
| `databaseIndexManager.js:113` | `ledgerentries: { ownerType: 1, ownerId: 1, createdAt: -1 }` | Schema fields are `actorType` + `actorId`. | Dead. |
| `databaseIndexManager.js:118` | `paymentwebhookevents: { eventId: 1 }` with `unique:true` | Schema already declares `eventId: { unique: true }` (line 9-11 of `paymentWebhookEvent.js`). | Duplicate. Mongo no-ops or warns. |
| `databaseIndexManager.js:125` | `payments: { gatewayOrderId: 1 }` with `unique:false` | Schema declares `gatewayOrderId: { unique:true }` (`payment.js:75-80`). | **Conflicting options** — Mongo throws `IndexOptionsConflict`. Code path silently catches via `error.code === 85` (line 179) and treats as existing. |

**Fix (Phase 3):**
1. Delete the four dead-field entries.
2. Rename `ownerType`/`ownerId` → `actorType`/`actorId` in the `ledgerentries` block.
3. Either delete the duplicate index defs entirely (let schemas own them) or convert `databaseIndexManager` into a **verification-only** tool. The plan in Part 3 recommends "schemas own indexes; manager only verifies and reports missing".

---

## 2.6 [P1-C6] Triple-bookkeeping of order finance state

The same financial event has up to four mirror representations:

| Concept | Legacy (read-only) | Current (writable) | Canonical (target) |
|---|---|---|---|
| Order payment mode | `Order.payment.method` (cash/online/wallet) | `Order.paymentMode` (COD/ONLINE) | `Order.paymentMode` (single source) |
| Order payment status | `Order.payment.status` (pending/completed/failed/refunded) | `Order.paymentStatus` (CREATED/PENDING_CASH_COLLECTION/…) | `Order.paymentStatus` |
| Order status | `Order.status` (pending/confirmed/packed/out_for_delivery/delivered/cancelled) | `Order.orderStatus` (mirrors `status`) + `Order.workflowStatus` (richer state machine) | `Order.workflowStatus` (canonical), `Order.status` (UI-facing read alias maintained via hook) |
| Money out (refund/payout) | `Transaction` (TitleCase, `refPath` polymorphism) | partial: some flows write to `Transaction`, others to `LedgerEntry` | `LedgerEntry` (ALL CAPS, indexed) — `Transaction` is read-only legacy |
| User wallet balance | `User.walletBalance` (single number on user doc) | parallel: `Wallet({ownerType:"CUSTOMER",ownerId:userId})` exists but rarely consulted for customer balance | `Wallet` is authoritative — `User.walletBalance` becomes a denormalized read cache |

The hooks in `order.js:492-533` copy values **at insert time and during legacy fallbacks**, not on every update. A direct `Order.updateOne({_id}, {$set:{paymentStatus:"REFUNDED"}})` doesn't update the legacy `payment.status:"refunded"` — drift accumulates.

**Fix (Phase 4):** detailed in Part 3.

---

## 2.7 [P1-C7] `User.walletBalance` vs `Wallet({ownerType:"CUSTOMER"})`

**Evidence:**
```107:110:backend/app/models/customer.js
        walletBalance: {
            type: Number,
            default: 0,
        },
```
```294:300:backend/app/services/orderPlacementService.js
    const user = await User.findById(customerId).session(session);
    if (walletAmount > 0) {
      if (!user) throw new Error("User not found");
      if (user.walletBalance < walletAmount) {
        throw new Error("Insufficient wallet balance");
      }
    }
```
```970:984:backend/app/controller/orderController.js
    const customer = await User.findById(order.customer);
    if (customer) {
      customer.walletBalance = (customer.walletBalance || 0) + Number(walletRefundTotal.toFixed(2));
      await customer.save();

      await Transaction.create({
        user: customer._id,
        userModel: "User",
        order: order._id,
        type: "Refund",
        amount: Number(walletRefundTotal.toFixed(2)),
        status: "Settled",
        reference: `REF-WALLET-${order.orderId}`,
        meta: { orderId: order._id, type: "return_wallet" }
      });
    }
```
Meanwhile `walletService.creditWallet({ownerType:"CUSTOMER", ownerId: order.customer, …})` exists and is used elsewhere for admin/seller/rider wallets. The customer wallet path is the **only** ownerType still using the legacy `User.walletBalance` field.

**Fix (Phase 4):**
1. Phase 4a — every new customer-wallet write goes through `walletService.creditWallet/debitWallet({ownerType:"CUSTOMER"})`. The service ALSO updates `User.walletBalance` (denormalized cache) inside the same session, transitionally.
2. Phase 4b — flip all reads (`user.walletBalance`) to read from `Wallet({ownerType:"CUSTOMER", ownerId:userId})`. Add a helper `getCustomerWalletBalance(userId)` in `walletService`.
3. Phase 4c (later) — drop `User.walletBalance` field.

---

## 2.8 [P1-C8] Five OTP storage locations

**Locations:**
1. `app/models/otpVerification.js` — `OtpVerification({purpose, channel, target})` — generic.
2. `app/modules/otp/otp.model.js` — `OtpSession({mobile, userType, purpose})` — used by the new unified `/auth/otp` routes.
3. `app/models/orderOtp.js` — `OrderOtp({orderId, type:"delivery|return_pickup|return_drop"})` — delivery / pickup OTPs. **Legitimately different.**
4. `app/models/customer.js:63-103` — 8 inline fields on the User doc (`otp`, `otpExpiry`, `otpHash`, `otpExpiresAt`, `otpFailedAttempts`, `otpLockedUntil`, `otpLastSentAt`, `otpSessionVersion`).
5. `app/models/delivery.js:100-108` — 2 inline fields on the Delivery doc (`otp`, `otpExpiry`).

Locations 1, 2, 4, 5 all serve "mobile OTP for login" — same logical concept, four storage shapes.

**Fix (Phase 5):**
1. Designate `OtpSession` (location 2) as canonical for login/signup/password-reset OTPs.
2. Deprecate `OtpVerification` (location 1) — mark dead model, schedule deletion in Phase 7.
3. Strip inline OTP fields from `User` and `Delivery` schemas. Add a Mongoose `pre('save')` discard hook to silently drop them from incoming writes during migration.
4. Keep `OrderOtp` — it's a different domain.

---

## 2.9 [P1-C9] `Customer` vs `User` enum chaos in polymorphic refs

Already enumerated in §0.1 row C-9. The fix is uniform — every polymorphic enum across the codebase **MUST** use `User` (matching the actual registered model name). The plan addresses each file in Phase 5:

| File | Field | Current | Target |
|---|---|---|---|
| `app/models/notification.js:71` | `recipientModel` | `["Seller","Admin","Customer","Delivery","User"]` | `["Seller","Admin","Delivery","User"]` (drop `Customer`) |
| `app/models/mediaMetadata.js:115` | `uploadedByModel` | `["Customer","Seller","Admin","Delivery"]` | `["User","Seller","Admin","Delivery"]` |
| `app/models/ticket.js:12` | `userType` | `["Customer","Seller","Rider"]` | `["User","Seller","Delivery"]` (drop "Rider" too) |
| `app/modules/otp/otp.model.js:13` | `userType` | `["Admin","Seller","Customer","Delivery"]` | `["Admin","Seller","User","Delivery"]` |

A **migration script** rewrites existing rows from `"Customer"` → `"User"` and `"Rider"` → `"Delivery"`. Documented in Part 4.

---

## 2.10 [P1-C10] `Order.payment.status` ↔ `Order.paymentStatus` drift

**Evidence (write paths):**

| Write site | Updates | Drift after write? |
|---|---|---|
| `orderPlacementService.js:382-390` | both `paymentStatus` AND `payment.status:"pending"` | OK — synced at insert |
| `orderController.js:1080-1082` (return refund) | `payment.status:"refunded"` only | YES — `paymentStatus` stays `PAID` / `CASH_COLLECTED` |
| `orderFinanceService.js handleOnlineOrderFinance` | `paymentStatus:"PAID"` only | YES — `payment.status` stays `"pending"` |
| `orderController.js cancel handler` (`status:"cancelled"`) | `status:"cancelled"` only | Neither payment field touched |

The `Order.pre('save')` hook does NOT re-sync these on update — only on first-save. So after every async update, drift increases by one row.

**Fix (Phase 4):**
1. Move sync logic from `pre('save')` into a `pre('findOneAndUpdate')` hook that also re-derives the legacy `payment.status` from canonical `paymentStatus`.
2. Eventually deprecate the entire nested `payment` doc once frontend stops reading it (Phase 7).

---

# 3. MODEL-BY-MODEL DETAIL

This section is the per-model inventory. Issues are tagged `[P0]` `[P1]` `[P2]` `[P3]` for priority. Phase column maps to Part 3.

## 3.1 Order (`order.js`) — central document

**Fields summary:**
- Identity: `orderId` (public string, unique), Mongoose `_id`
- Parties: `customer (User, required)`, `seller (Seller)`, `deliveryBoy (Delivery)`, `deliveryPartner (Delivery)` ← **mirror of `deliveryBoy`**, `returnDeliveryBoy (Delivery)`, `returnQcBy (Admin)`, `returnDropVerifiedBy (Delivery)`, `skippedBy[] (Delivery)`
- Items snapshot: `items[]` with `product (Product, required)`, `name`, `quantity`, `price`, `variantSlot`, `image`
- Address snapshot: nested `address` (no `Address` model — denormalized on order)
- Pricing (legacy): nested `pricing.{subtotal, deliveryFee, platformFee, gst, tip, discount, total, walletAmount}`
- Pricing (canonical): nested `paymentBreakdown.*` (15 fields including `codCollectedAmount`, `codRemittedAmount`, `codPendingAmount`, `platformTotalEarning`, …)
- Payment (legacy): nested `payment.{method:cash|online|wallet, status:pending|completed|failed|refunded, transactionId:String}`
- Payment (canonical): `paymentMode:COD|ONLINE`, `paymentStatus:CREATED|PAID|…`
- Settlement: `settlementStatus.{overall, sellerPayout, riderPayout, adminEarningCredited, reconciledAt}`
- Finance flags: `financeFlags.{onlinePaymentCaptured, codMarkedCollected, deliveredSettlementApplied, sellerPayoutQueued, riderPayoutQueued, adminEarningCredited}`
- Workflow: `status:pending|confirmed|packed|out_for_delivery|delivered|cancelled`, `orderStatus` (mirror), `workflowStatus:Object.values(WORKFLOW_STATUS)`, `workflowVersion:Number`
- Workflow timing: `sellerPendingExpiresAt`, `deliverySearchExpiresAt`, `sellerAcceptedAt`, `assignedAt`, `assignmentVersion`, `pickupConfirmedAt`, `pickupReadyAt`, `outForDeliveryAt`, `deliveryRiderStep:1-4`, `expiresAt`, `acceptedAt`, `deliveredAt`
- Cancellation: `cancelledBy:customer|seller|admin|system`, `cancelReason:String`
- Stock: `stockReservation.{status, reservedAt, expiresAt, releasedAt}`
- Group: `checkoutGroupId:String`, `checkoutGroupSize:Number`, `checkoutGroupIndex:Number`
- Idempotency: `placement.{idempotencyKey:String, idempotencyKeyExpiry:Date, createdFrom:DIRECT_ITEMS|CART}`
- Distance: `distanceSnapshot.{distanceKmActual, distanceKmRounded, source}`
- Pricing snapshot: `pricingSnapshot.{deliverySettings:Object, handlingFeeStrategy:String, handlingCategoryUsed:Object, categoryCommissionSettings:Array}`
- Return: 21 fields covering full return workflow embedded on order
- OTP delivery proof: `deliveryProofImages[]`, `otpValidatedAt`, `otpValidationLocation.{lat,lng}`
- UX: `timeSlot:"now"`, `deviceType`, `trafficSource`

**Schema-level indexes (15):** comprehensive — covered well by `databaseIndexManager.js` overlap. See Part 3 §3.

**Issues:**
- `[P1] order-1` Triple status: `status` + `orderStatus` + `workflowStatus`. Sync hook only at insert/legacy-fallback. — see §2.10.
- `[P1] order-2` Dual delivery refs: `deliveryBoy` + `deliveryPartner` — same FK, kept in sync via pre-save hook (lines 521-526). Pick one in Phase 4, deprecate the other.
- `[P1] order-3` Nested `payment.*` legacy mirror — see §2.10.
- `[P1] order-4` Nested `pricing.*` legacy mirror of `paymentBreakdown.*` — drift risk identical.
- `[P2] order-5` `pricingSnapshot.deliverySettings:Object` and `handlingCategoryUsed:Object` are unindexed unstructured maps — fine for snapshotting but never queryable. Document as opaque.
- `[P2] order-6` `Order.items.image` is a single URL snapshot. When product main image changes, order shows stale image — acceptable for "what was shipped" but document.
- `[P3] order-7` No reverse virtual for `Payment.order → Order` from `Order.payments`. Add `orderSchema.virtual('paymentRecords', { ref: 'Payment', localField: '_id', foreignField: 'order' })` for admin UIs.
- `[P3] order-8` `returnItems[].itemIndex:Number` has no validator; could point to a stale offset in `items[]` after splits.

## 3.2 Transaction (`transaction.js`) — legacy ledger

**Status: LEGACY but still written to from 8+ places.** Replacement target: `LedgerEntry`.

**Issues:**
- `[P0] tx-1` TitleCase statuses + non-canonical types violate the `LedgerEntry` schema's ALL_CAPS conventions. They cannot be unified by a simple migration — value mapping is required.
- `[P0] tx-2` `"Wallet Payment"` literal violates enum — see §2.2.
- `[P1] tx-3` `userModel` enum `["Seller","Delivery","Admin","User"]` does NOT match `notification.recipientModel` (`["Seller","Admin","Customer","Delivery","User"]`) or `mediaMetadata.uploadedByModel` (`["Customer","Seller","Admin","Delivery"]`). Inconsistency.
- `[P2] tx-4` `reference: { unique: true }` (line 36) — every refund/withdrawal/cash-collection has to pick a unique reference. Codebase uses `REF-WALLET-${orderId}`, `REF-SELL-${orderId}`, `RET-DEL-${orderId}` — collisions possible if an order is refunded twice (returns + cancel-after-delivered).
- `[P2] tx-5` No `idempotencyKey` field — duplicate inserts on retry are not blocked by DB.

## 3.3 LedgerEntry (`ledgerEntry.js`) — canonical ledger (under-used)

**Issues:**
- `[P0] ledger-1` Only written by 8 call sites. Not written by `walletService.creditWallet/debitWallet`. — see §2.3.
- `[P1] ledger-2` No `idempotencyKey` field. `transactionId` is unique, but generated server-side from `Date.now() + random` — not deterministic from the originating action. Two webhook retries of the same payment can create two ledger rows. **Phase 2 adds `idempotencyKey` + unique partial index.**
- `[P2] ledger-3` `metadata:Object` is a `Mixed` field — fine for audit but never queryable.
- `[P2] ledger-4` `balanceBefore`/`balanceAfter` are nullable; populated only by some callers. Inconsistent for replay.
- `[P2] ledger-5` `walletId` ref exists but is rarely populated by call-sites — orderFinanceService writes `walletId: wallet._id` but payoutService and refund flows don't. Add validator.

## 3.4 Wallet (`wallet.js`)

**Issues:**
- `[P0] wallet-1` `creditWallet/debitWallet` doesn't write ledger — see §2.3.
- `[P1] wallet-2` `cashInHand` is a separate bucket but its movement isn't tied to a `Payout` or `LedgerEntry`. Used for delivery riders carrying cash — must be ledger-tracked. Phase 2 fix.
- `[P2] wallet-3` `meta:Object` mixed; document opaque semantics.
- `[P3] wallet-4` Compound unique index `(ownerType, ownerId)` with `partialFilterExpression: {ownerType: {$exists:true}}` — partial filter is redundant because `ownerType` is `required:true`. Simplify.

## 3.5 Payment (`payment.js`) — gateway record (healthy)

**Issues:**
- `[P2] pay-1` `rawGatewayResponse:Mixed` — keep but redact PII before write.
- `[P3] pay-2` `gatewaySignature: { select: false }` — good. But never read except for debugging. Verify it's actually populated.
- `[P3] pay-3` `orderIds[]` + singular `order` coexist for multi-order checkouts. Document semantics: `order` is the **primary** (first) order; `orderIds` is the full set.

## 3.6 PaymentWebhookEvent (`paymentWebhookEvent.js`) — healthy

Use as the idempotency gate for webhook handlers. No issues other than `databaseIndexManager` duplicate index (§2.5).

## 3.7 Payout (`payout.js`)

**Issues:**
- `[P1] payout-1` `beneficiaryId` has **no `refPath`** — silent polymorphism. The accompanying `payoutType:"SELLER"|"DELIVERY_PARTNER"` determines the model. Two options for fix in Phase 5: introduce `refPath: 'beneficiaryModel'` with `beneficiaryModel:String` field, OR keep flat but add a comment + dedicated populate helpers (`populateBeneficiary(payout)`).
- `[P2] payout-2` `createdBy` has no `ref` — should be `ref:"Admin"` for `processPayout` actions.
- `[P3] payout-3` Add reverse virtual on `Order` for payouts queued: `Order.virtual('payouts', { ref:'Payout', localField:'_id', foreignField:'relatedOrderIds' })`.

## 3.8 CheckoutGroup (`checkoutGroup.js`)

**Issues:**
- `[P0] cg-1` Broken `ref:"Customer"` — see §2.1.
- `[P0] cg-2` `sellerBreakdown[].order` — `ref:"Order"` ✓ correct, but the field is nullable; if checkout never produced an order (PAYMENT_PENDING expired), the reference stays null. Document.
- `[P2] cg-3` Multi-seller fan-out has `orderIds` (refs) AND `publicOrderIds[]` (strings). Both kept by `orderPlacementService.js:428-429`. Verify both are populated by every code path.

## 3.9 Cart (`cart.js`)

**Issues:**
- `[P0] cart-1` Broken `ref:"Customer"` — see §2.1.
- `[P1] cart-2` No soft-delete: when a customer is deactivated, their cart row lives forever. Phase 6 adds `pre('find')` filter on the customer side.
- `[P2] cart-3` `items[].variantSku:String` — empty string is the canonical "no variant" sentinel. Consider `null` for clarity.

## 3.10 Wishlist (`wishlist.js`)

**Issues:**
- `[P0] wish-1` Broken `ref:"Customer"` — see §2.1.
- `[P2] wish-2` `products:[ObjectId, ref:"Product"]` — no per-item timestamp. Cannot answer "added on which date". Phase 6 expands to `[{product, addedAt}]`.
- `[P3] wish-3` Schema doesn't restrict to active customer products — `wishlistController` must filter. Verify.

## 3.11 Product (`product.js`)

**Issues:**
- `[P1] prod-1` Three Category refs (`headerId`, `categoryId`, `subcategoryId`) — all `ref:"Category"` referencing a self-tree. Required: all 3. Risk: if admin renames a header, products pointing to old header are orphaned (unless type is changed). Add validation: header/category/subcategory must form a valid 3-level chain.
- `[P2] prod-2` `status:["active","inactive"]` — used as soft-delete. Phase 6 standardizes naming: keep `status` (existing) but document as soft-delete carrier.
- `[P2] prod-3` `variants[]` has no unique constraint on `sku` within the array — two variants of the same product can have the same SKU. Add sub-schema validation.
- `[P2] prod-4` `slug` and top-level `sku` are unique but unique across **active+inactive** products. Inactive product with sku X blocks new active product with sku X. Consider partial unique index `(sku, { partialFilterExpression: { status: "active" } })`.
- `[P3] prod-5` Reverse virtual `Product.virtual('reviews', { ref:'Review', localField:'_id', foreignField:'productId' })` missing — admin UIs likely fetch reviews separately.

## 3.12 Category (`category.js`)

**Issues:**
- `[P2] cat-1` `type:["header","category","subcategory"]` is a 3-level tree via `parentId` self-ref. Plus virtual `children`. Healthy, but no validator that a `subcategory.parentId` must point to a `category` (could point to anything). Phase 6 adds validator hook.
- `[P2] cat-2` `iconId:String` — opaque string; semantic constraints (allowed values?) not encoded. Document.
- `[P3] cat-3` Pre-save legacy-sync hook is intricate (~100 lines) — fine, but consider extracting to `categoryNormalizationService.js` and shimming.

## 3.13 Seller (`seller.js`)

**Issues:**
- `[P1] seller-1` `applicationStatus + isVerified + isActive` form an unwritten state machine. A seller can be `applicationStatus:"approved"` but `isActive:false`. Phase 6 adds invariant: `applicationStatus:"approved" ⇒ isVerified:true`.
- `[P2] seller-2` `accountHolder + accountNumber + ifsc` are stored at top-level for payouts; no `bankDetails` nesting. Phase 5 nests for cleanliness.
- `[P2] seller-3` `documents.{tradeLicense, gstCertificate, idProof, businessRegistration, fssaiLicense, other}` — strings (file URLs). No upload status. Consider denormalizing from `MediaMetadata`.
- `[P3] seller-4` `serviceRadius:Number, default 5` — kilometers? Add comment + units.

## 3.14 Delivery (`delivery.js`)

**Issues:**
- `[P1] del-1` Inline OTP fields duplicate `OtpSession` — see §2.8.
- `[P1] del-2` No `isActive` field — relies on `isVerified` + `isOnline`. A rider who quits cannot be soft-disabled. Phase 6 adds `isActive:Boolean default true`.
- `[P1] del-3` `lastLocationAt` exists but `location.coordinates` defaults to `[0,0]` — a rider who never sent GPS appears at lat=0,lng=0 on the 2dsphere index. Filter by `lastLocationAt != null` in nearby queries. Document.
- `[P2] del-4` `documents.{aadhar, pan, drivingLicense}` strings only — same as seller. Use `MediaMetadata`.

## 3.15 User (file `customer.js`)

**Issues:**
- `[P0] user-1` File name ↔ model name mismatch — see §2.1.
- `[P1] user-2` `walletBalance` field is a parallel balance to `Wallet` collection — see §2.7.
- `[P1] user-3` 8 inline OTP fields — see §2.8.
- `[P1] user-4` `role:["user","admin","delivery","seller"]` enum is **misleading** — Admin/Delivery/Seller all live in their own collections. Only `"user"` rows exist here. Document or remove enum (keep as `String`).
- `[P2] user-5` `addresses[addressSchema]` — embedded subdocs. Up to N addresses per user, but no max. Phase 6 adds `validate: arr.length <= 10`.
- `[P2] user-6` `email: { sparse: true, unique: true }` — phone-only signups have no email. Confirmed sparse handles this.

## 3.16 OrderOtp (`orderOtp.js`) — healthy

No issues. Phase 3 ensures `databaseIndexManager` compound `(orderId, type, expiresAt:-1)` doesn't conflict with schema-level `(orderId, consumedAt)`.

## 3.17 OtpVerification (`otpVerification.js`) — duplicate of OtpSession

`[P1] otpver-1` Designate dead in Phase 5. Migrate any remaining writers to `OtpSession`. Delete model in Phase 7.

## 3.18 OtpSession (`app/modules/otp/otp.model.js`) — canonical

**Issues:**
- `[P0] otpses-1` `userType:["Admin","Seller","Customer","Delivery"]` uses `Customer` — Phase 5 fix to `User`.
- `[P2] otpses-2` Unique on `(mobile, userType, purpose)` means a single mobile can't have concurrent OTP sessions across purposes — actually that's correct. Document.

## 3.19 Notification (`notification.js`)

**Issues:**
- `[P0] notif-1` `recipientModel:["Seller","Admin","Customer","Delivery","User"]` — has both `Customer` and `User`. Phase 5 drops `Customer`.
- `[P1] notif-2` Dual fields `recipient + recipientModel` (legacy, required) and `userId + role` (new). Both `required:true` — but copy hook (line 109-123) ensures one is set from the other. Fragile: external writers might bypass. Phase 5: make only one set canonical (`userId/role`) and shim the other read-only.
- `[P2] notif-3` `type` enum mixes notification events (from `NOTIFICATION_EVENTS`) with generic strings `"order"/"payment"/"alert"/"system"`. Drift unclear.
- `[P2] notif-4` `deliveryStats:{attempted,sent,failed,invalidTokens}` is incremented after worker sends; no transaction needed (best-effort) but document.
- `[P3] notif-5` `data:Mixed` — opaque.

## 3.20 PushToken (`token.model.js`) — healthy

Unique on `token`, plus compound `(userId, role, token)` unique. Solid.

## 3.21 NotificationPreference (`preference.model.js`) — healthy

Unique on `(userId, role)`. Solid.

## 3.22 Review (`review.js`) — healthy

`[P2] rev-1` `status` enum approved/rejected — admin moderation. Unique `(userId, productId)` prevents double-review. Good.
`[P3] rev-2` No `helpfulVotes` field — common review feature. Future.

## 3.23 Ticket (`ticket.js`)

**Issues:**
- `[P0] ticket-1` `userType:["Customer","Seller","Rider"]` — uses wrong discriminators. Phase 5 fix to `["User","Seller","Delivery"]`.
- `[P1] ticket-2` `messages[]` embedded subdocs grow unbounded. After 1k messages, document hits 16MB limit. Phase 6 introduces `TicketMessage` collection OR `messages` array cap with archival.
- `[P2] ticket-3` `messages[].senderType:["User","Admin"]` — what about seller-to-customer messages? Not modeled. Verify business case.

## 3.24 Coupon (`coupon.js`)

**Issues:**
- `[P1] coupon-1` `usedCount` is `$inc`-ed but there's no per-user usage tracking — `perUserLimit:1` cannot be enforced without scanning orders. Phase 6 introduces `CouponUsage` collection: `{coupon, customer, order, usedAt}`.
- `[P2] coupon-2` `validFrom`/`validTill` are required dates — should be indexed for "active coupons today" queries. Schema has `(isActive, validFrom, validTill)` compound — good.

## 3.25 Offer (`offer.js`), OfferSection (`offerSection.js`) — content/CMS, low-risk

`[P2] offer-1` `OfferSection.categoryId` (singular, legacy) + `categoryIds[]` (new) coexist. Phase 4 deprecate singular.

## 3.26 ExperienceSection (`experienceSection.js`), HeroConfig (`heroConfig.js`) — healthy

No issues.

## 3.27 FAQ (`faq.js`) — healthy

No issues. `category` enum `['Customer','Seller','Delivery','Orders']` is for audience, not for refs — OK to keep `"Customer"` here.

## 3.28 FinanceAuditLog (`financeAuditLog.js`)

`[P1] fin-audit-1` Under-utilized. Phase 2 adds audit-log entries for every refund/payout/wallet-adjustment.

## 3.29 FinanceReports (`financeReports.js`), SellerMetrics (`sellerMetrics.js`), DashboardStats (`dashboardStats.js`) — read-side caches

Healthy. No primary truth.

## 3.30 MediaMetadata (`mediaMetadata.js`)

**Issues:**
- `[P0] media-1` `uploadedByModel` enum uses `"Customer"` — Phase 5 fix.
- `[P2] media-2` Proper soft-delete + TTL on `expiresAt` for pending uploads. Healthy otherwise.

## 3.31 GeocodeCache (`geocodeCache.js`) — healthy

TTL on `expiresAt`. No issues.

## 3.32 StockHistory (`stockHistory.js`) — healthy

`[P2] stock-1` `note:String` — admin actions should also store `actor:Admin._id`. Currently lost.

## 3.33 SearchIndexFailure (`searchIndexFailure.js`) — healthy

No issues.

## 3.34 Setting (`setting.js`)

`[P2] setting-1` Effective singleton but no `tenantId` enforcement — multiple Setting docs could exist in the wild. Phase 4 adds `pre('save')` enforcer: only one document with `tenantId:null` allowed.

## 3.35 DeliveryAssignment (`deliveryAssignment.js`) — healthy

`[P3] da-1` `meta:Mixed` — document opaque.

## 3.36 Admin (`admin.js`) — healthy

`[P3] admin-1` No `permissions` field — all admins have full access. If RBAC is needed, Phase 6 introduces.

---

End of Part 1. **Part 2** continues with the API ↔ DB mapping per domain, the association graph, the orphan-field detail table, and the request-lifecycle traces for the highest-traffic endpoints.
