# Appzeto Quick-Commerce — Production-Grade Database Audit & Implementation Plan
## Part 2 of 4: API ↔ DB Mapping · Association Graph · Orphan Fields · Request Lifecycles

> Continuation of Part 1. This part contains the **evidence base** for the phased plan in Part 3. Every claim is file:line-cited.

---

# 4. ASSOCIATION GRAPH

## 4.1 Outgoing refs (FK declarations) grouped by target model

Format: `<source>.<field> → <target> [index? · required? · refPath?]`

### → `User` (the customer collection, registered from `customer.js`)
- `order.customer` → `User` · indexed (compound) · required ✓
- `order.placement.idempotencyKey` partial-unique compound includes `customer:1` ✓
- `payment.customer` → `User` · indexed · required ✓
- `review.userId` → `User` · indexed (compound w/ productId) · required ✓
- `ticket.userId` → `User` · indexed · required ✓
- `cart.customerId` → **`Customer` ✗ BROKEN** (should be `User`)
- `wishlist.customerId` → **`Customer` ✗ BROKEN**
- `checkoutGroup.customer` → **`Customer` ✗ BROKEN**
- `notification.recipient` → polymorphic `refPath:recipientModel` (enum allows `User` ✓)
- `notification.userId` → no ref (silent polymorphic via `role` enum)
- `transaction.user` → polymorphic `refPath:userModel` (enum allows `User` ✓)
- `mediaMetadata.uploadedBy` → polymorphic `refPath:uploadedByModel` (enum allows `User`? **NO — enum is `["Customer","Seller","Admin","Delivery"]` ✗**)

### → `Seller`
- `product.sellerId` → `Seller` · indexed · required ✓
- `order.seller` → `Seller` · indexed (5 compound indexes) — NOT required (because order can be created before seller-assignment? Actually order is per-seller; let me verify)
- `checkoutGroup.sellerBreakdown[].seller` → `Seller` · required ✓
- `offerSection.sellerIds[]` → `Seller`
- `seller.reviewedBy` → `Admin` (not seller — different field)
- `stockHistory.seller` → `Seller` · indexed · required ✓
- `sellerMetrics.sellerId` → `Seller` · indexed · required ✓
- `transaction.user` (when `userModel:"Seller"`)
- `notification.recipient` (when `recipientModel:"Seller"`)
- `mediaMetadata.uploadedBy` (when `uploadedByModel:"Seller"`)

> **Note:** `Order.seller` is NOT declared `required:true` (line 22-25 of `order.js`). This is unsafe — an order without seller could exist. In practice `orderPlacementService.js:379` always sets it. Phase 4: add `required:true` after migration script confirms 0 orphaned orders.

### → `Delivery`
- `order.deliveryBoy` → `Delivery` · indexed (compound) · nullable
- `order.deliveryPartner` → `Delivery` · indexed · nullable · **DUPLICATE of `deliveryBoy`**
- `order.returnDeliveryBoy` → `Delivery` · indexed (compound `idx_returnStatus_deliveryBoy_created`)
- `order.returnDropVerifiedBy` → `Delivery`
- `order.skippedBy[]` → `Delivery`
- `deliveryAssignment.winnerDeliveryId` → `Delivery`
- `deliveryAssignment.candidateIds[]` → `Delivery`
- `transaction.user` (when `userModel:"Delivery"`)
- `notification.recipient` (when `recipientModel:"Delivery"`)
- `mediaMetadata.uploadedBy` (when `uploadedByModel:"Delivery"`)
- `payout.beneficiaryId` (when `payoutType:"DELIVERY_PARTNER"` — but no `refPath`, silent polymorphic)

### → `Admin`
- `seller.reviewedBy` → `Admin`
- `order.returnQcBy` → `Admin`
- `product.approvalReviewedBy` → `Admin`
- `searchIndexFailure.resolvedBy` → `Admin`
- `transaction.user` (when `userModel:"Admin"`)
- `notification.recipient` (when `recipientModel:"Admin"`)
- `mediaMetadata.uploadedBy` (when `uploadedByModel:"Admin"`)
- `payout.createdBy` → declared as ObjectId WITHOUT `ref:` — **silent**. Almost certainly `Admin`.

### → `Order`
- `payment.order` → `Order` · indexed · required ✓
- `payment.orderIds[]` → `Order` (for multi-order checkouts)
- `transaction.order` → `Order` · indexed · nullable
- `paymentWebhookEvent.payment` → `Payment` (indirect chain to Order)
- `ledgerEntry.orderId` → `Order` · indexed · nullable
- `financeAuditLog.orderId` → `Order` · indexed · nullable
- `checkoutGroup.orderIds[]` → `Order`
- `checkoutGroup.sellerBreakdown[].order` → `Order`
- `payout.relatedOrderIds[]` → `Order`
- `orderOtp.orderMongoId` → `Order` · indexed · required ✓
- `deliveryAssignment.orderMongoId` → `Order` · indexed · required ✓
- `stockHistory.order` → `Order` · indexed · nullable

### → `Product`
- `cart.items[].productId` → `Product` · required ✓
- `wishlist.products[]` → `Product`
- `order.items[].product` → `Product` · required ✓
- `order.returnItems[].product` → `Product` · required ✓
- `review.productId` → `Product` · indexed (compound) · required ✓
- `offer.productIds[]` → `Product`
- `offerSection.productIds[]` → `Product`
- `experienceSection.config.products.productIds[]` → `Product`
- `searchIndexFailure.productId` → `Product` · indexed · required ✓
- `stockHistory.product` → `Product` · indexed · required ✓

### → `Category` (3 roles: header / category / subcategory)
- `product.headerId, categoryId, subcategoryId` → all `ref:"Category"` · all required ✓ · all indexed
- `category.parentId` → `Category` (self-ref tree)
- `coupon.applicableCategories[]` → `Category`
- `offer.categoryIds[]` → `Category`
- `offerSection.categoryIds[]`, `offerSection.categoryId` (legacy) → `Category`
- `experienceSection.headerId` → `Category`
- `experienceSection.config.{categories,subcategories,products}.{categoryIds,subcategoryIds}[]` → `Category`
- `heroConfig.headerId` → `Category`
- `heroConfig.categoryIds[]` → `Category`

### → `Payment`
- `paymentWebhookEvent.payment` → `Payment` · indexed

### → `Wallet`
- `ledgerEntry.walletId` → `Wallet` · indexed · nullable (sparsely populated by callers — see §3.3 issue)
- `payout.walletId` → `Wallet` · nullable

### → `Payout`
- `ledgerEntry.payoutId` → `Payout` · indexed · nullable
- `financeAuditLog.payoutId` → `Payout` · indexed · nullable

## 4.2 Reverse virtuals — what's missing

Of the 100+ ref relationships above, only **one** model declares a reverse virtual:

```237:241:backend/app/models/category.js
categorySchema.virtual("children", {
  ref: "Category",
  localField: "_id",
  foreignField: "parentId",
});
```

That's it. Every other reverse relationship requires an explicit `.find({fk: id})` instead of `populate('virtualName')`.

**Recommended reverse virtuals** (Phase 4, additive only, zero-risk):

| Source | Virtual name | Target | Foreign field |
|---|---|---|---|
| `User` | `orders` | `Order` | `customer` |
| `User` | `payments` | `Payment` | `customer` |
| `User` | `cart` | `Cart` | `customerId` (after Phase 1 ref fix) |
| `User` | `wishlist` | `Wishlist` | `customerId` |
| `User` | `wallet` | `Wallet` | `ownerId` (with extra match on `ownerType:"CUSTOMER"`) |
| `User` | `tickets` | `Ticket` | `userId` |
| `Seller` | `products` | `Product` | `sellerId` |
| `Seller` | `orders` | `Order` | `seller` |
| `Seller` | `payouts` | `Payout` | `beneficiaryId` (with match on `payoutType:"SELLER"`) |
| `Seller` | `wallet` | `Wallet` | `ownerId` (with match on `ownerType:"SELLER"`) |
| `Delivery` | `deliveryOrders` | `Order` | `deliveryBoy` |
| `Delivery` | `returnOrders` | `Order` | `returnDeliveryBoy` |
| `Delivery` | `wallet` | `Wallet` | `ownerId` (match `ownerType:"DELIVERY_PARTNER"`) |
| `Order` | `paymentRecords` | `Payment` | `order` |
| `Order` | `ledgerEntries` | `LedgerEntry` | `orderId` |
| `Order` | `transactions` | `Transaction` | `order` |
| `Order` | `assignments` | `DeliveryAssignment` | `orderMongoId` |
| `Order` | `otps` | `OrderOtp` | `orderMongoId` |
| `Order` | `stockMovements` | `StockHistory` | `order` |
| `Product` | `reviews` | `Review` | `productId` |
| `Product` | `stockMovements` | `StockHistory` | `product` |
| `Wallet` | `entries` | `LedgerEntry` | `walletId` |
| `Payout` | `entries` | `LedgerEntry` | `payoutId` |

Adding a virtual is a zero-cost schema change (no migration, no index, no field). Implementation in Phase 4. Adoption is voluntary by call sites that want to use `.populate('orders')` style.

## 4.3 Polymorphic refs — `refPath` audit

| Model | Field | `refPath` field | Enum on `refPath` field | Correct? |
|---|---|---|---|---|
| `transaction.user` | `userModel` | `["Seller","Delivery","Admin","User"]` | ✓ |
| `notification.recipient` | `recipientModel` | `["Seller","Admin","Customer","Delivery","User"]` | ✗ `"Customer"` not a model |
| `mediaMetadata.uploadedBy` | `uploadedByModel` | `["Customer","Seller","Admin","Delivery"]` | ✗ `"Customer"` not a model |
| `ticket.messages[].senderId` | `messages.senderType` | `["User","Admin"]` | ✓ (and ticket `userType` separately is `["Customer","Seller","Rider"]` ✗) |
| `payout.beneficiaryId` | **no refPath** | — | ✗ silent polymorphism — see §3.7 |
| `payout.createdBy` | **no ref or refPath** | — | ✗ silent |
| `notification.userId` | **no ref or refPath** | (companion: `role` enum from `NOTIFICATION_ROLES`) | semi-silent — fine because populate uses `recipient`+`recipientModel` |

## 4.4 Foreign-key field-name conventions (consistency audit)

Two conventions coexist:

**Convention A — bare entity name:**
- `order.customer`, `order.seller`, `order.deliveryBoy` (camelCase though), `payment.order`, `payment.customer`, `stockHistory.product`, `stockHistory.seller`, `stockHistory.order`, `transaction.user`, `transaction.order`, `financeAuditLog.orderId` (ironically the only `Id` suffix here), `ledgerEntry.orderId`, `ledgerEntry.payoutId`, `ledgerEntry.walletId`, `ledgerEntry.actorId`

**Convention B — `<entity>Id` suffix:**
- `cart.customerId`, `cart.items[].productId`, `wishlist.customerId`, `product.sellerId`, `product.headerId`, `product.categoryId`, `product.subcategoryId`, `product.approvalReviewedBy` (no Id), `category.parentId`, `coupon.applicableCategories[]` (plural, no Id), `review.userId`, `review.productId`, `ticket.userId`, `ticket.messages[].senderId`, `searchIndexFailure.productId`, `searchIndexFailure.resolvedBy`, `sellerMetrics.sellerId`, `mediaMetadata.entityId`, `mediaMetadata.uploadedBy`, `deliveryAssignment.orderMongoId`, `deliveryAssignment.orderId` (string), `deliveryAssignment.winnerDeliveryId`, `notification.userId`, `payout.beneficiaryId`

**Decision (Phase 5):** keep both — renaming costs more than it earns. Document the conventions and stop introducing new variants. Specifically:
- The `<entity>Id` form is used when the FK appears alongside the parent entity's own `_id` field (visual disambiguation: `_id` vs `customerId`).
- The bare form is used inside models where the FK is the principal relationship (e.g. `Order.customer`).

## 4.5 Polymorphic enum drift — the unified migration

Phase 5 produces a single shared constant file:

```js
// app/constants/refModels.js (NEW)
export const USER_MODEL_NAMES = Object.freeze({
  USER: "User",        // canonical customer model
  SELLER: "Seller",
  DELIVERY: "Delivery",
  ADMIN: "Admin",
});
export const ALL_USER_MODEL_NAMES = Object.freeze(Object.values(USER_MODEL_NAMES));
```

All 5 affected schemas import and use `ALL_USER_MODEL_NAMES` for their enums. Migration script rewrites:
- `Transaction.userModel: "Customer"` → `"User"` (likely 0 rows — schema rejected it; included as safety)
- `Notification.recipientModel: "Customer"` → `"User"` (could be many rows)
- `MediaMetadata.uploadedByModel: "Customer"` → `"User"`
- `Ticket.userType: "Customer"` → `"User"`, `"Rider"` → `"Delivery"`
- `OtpSession.userType: "Customer"` → `"User"`

Details in Part 4 §M1.

---

# 5. API ↔ DATABASE MAPPING — DOMAIN BY DOMAIN

Each domain section lists every endpoint, the controller function, models touched (R=read, W=write, T=transaction), validation status, and orphan-field risk.

> **Auth column legend:** `verifyToken` = generic JWT, `allowRoles(...)` = role gate, `requireApprovedSeller` = approval gate, `optionalVerifyToken` = soft auth.
> **Tx column:** `Y` if wrapped in `withTransaction`, `partial` if some writes are in a session but others bypass, `N` otherwise.

## 5.1 Customer / User domain

Routes from `app/routes/customerAuth.js` + `app/routes/wishlistRoutes.js` + `app/routes/cartRoutes.js` + auth/otp module.

| Method · Path | Controller fn | Auth | Models R | Models W | Tx | Validation | Risk |
|---|---|---|---|---|---|---|---|
| POST `/api/auth/otp/send` | `otpController.sendOtp` | none | OtpSession (R) | OtpSession (W) | N | inline | OK (TTL handles cleanup) |
| POST `/api/auth/otp/verify` | `otpController.verifyOtp` | none | OtpSession (R), User/Seller/Delivery/Admin (R) | OtpSession (W), respective user model (W) | N (multi-collection on signup path) | inline | Phase 2: wrap signup-on-otp path |
| POST `/api/customer/register` | `customerAuthController.register` | none | User (R) | User (W) | N | `customerAuthValidation` ✓ | OK |
| POST `/api/customer/login` | `customerAuthController.login` | none | User (R) | User (W: lastLogin) | N | ✓ | OK |
| POST `/api/customer/otp-login` | `customerAuthController.otpLogin` | none | OtpVerification (R/W) or inline `User.otp*` | User (W) | N | partial | **Triple OTP storage** — see §2.8 |
| GET `/api/customer/profile` | `customerAuthController.getProfile` | verifyToken | User (R) | — | — | — | OK |
| PUT `/api/customer/profile` | `customerAuthController.updateProfile` | verifyToken | User (R) | User (W) | N | partial inline | Phase 1: add `customerValidation.js` |
| POST `/api/customer/addresses` | `customerAuthController.addAddress` | verifyToken | User (R) | User (W: $push) | N | partial | Phase 6: validate `addresses.length <= 10` |
| PUT `/api/customer/addresses/:addressId` | `customerAuthController.updateAddress` | verifyToken | User (R) | User (W: arrayFilters) | N | partial | OK |
| DELETE `/api/customer/addresses/:addressId` | `customerAuthController.deleteAddress` | verifyToken | User (W: $pull) | User (W) | N | partial | OK |
| GET `/api/cart` | `cartController.getCart` | verifyToken | Cart (R), Product (R via populate) | Cart (W: auto-create empty) | N | — | **Broken `ref:"Customer"` dormant** |
| POST `/api/cart` | `cartController.addToCart` | verifyToken | Product (R) | Cart (W: upsert items) | N | partial inline (no Joi for body) | Phase 1: add `cartValidation` (file exists, needs wiring) |
| PUT `/api/cart` | `cartController.updateQuantity` | verifyToken | Cart (R) | Cart (W) | N | partial inline | Same |
| DELETE `/api/cart/:productId` | `cartController.removeFromCart` | verifyToken | Cart (R/W) | Cart (W) | N | inline | OK |
| DELETE `/api/cart` | `cartController.clearCart` | verifyToken | Cart (W) | Cart (W) | N | — | OK |
| GET `/api/wishlist` | `wishlistController.*` | verifyToken | Wishlist (R), Product (R) | — | — | — | broken ref dormant |
| POST `/api/wishlist` | add | verifyToken | Product (R) | Wishlist (W) | N | partial | OK |
| DELETE `/api/wishlist/:productId` | remove | verifyToken | Wishlist (W) | Wishlist (W) | N | — | OK |

**Orphan-field hotspots:** none in this domain (cart write-payload field names match schema).

## 5.2 Order domain

Routes from `app/routes/orderRoutes.js`.

| Method · Path | Controller fn | Auth | Models R | Models W | Tx | Validation | Risk |
|---|---|---|---|---|---|---|---|
| POST `/api/orders` | `orderController.placeOrder` → `orderPlacementService.placeOrderAtomic` | verifyToken | User, Cart, Product, Category, Setting | CheckoutGroup, Order×N, Cart, Product (stock), User (walletBalance), Transaction×N | **Y** | `orderValidation` ✓ | **C-2 hits if walletAmount > 0** |
| GET `/api/orders` (customer) | `orderQueryService.getCustomerOrders` | verifyToken | Order, populate(customer/seller/items.product) | — | — | — | populate("customer", "name phone") ✓ |
| GET `/api/orders/:orderId` | `orderController.getOrderDetails` | verifyToken+rolecheck | Order (full), Payment, OrderOtp | — | — | — | OK |
| PUT `/api/orders/:orderId/status` | `orderController.updateOrderStatus` | verifyToken | Order, Product (stock), Transaction | Order, Product (stock), Transaction, StockHistory | **N** | partial inline | Phase 2: wrap in session |
| POST `/api/orders/:orderId/cancel` | (delegates to `orderController.updateOrderStatus("cancelled")` or workflow) | verifyToken | as above | as above | **N** | partial | Phase 2 |
| POST `/api/orders/:orderId/return` | `orderController.requestReturn` → `OrderReturnService.createReturnRequest` | verifyToken | Order, OrderOtp | Order, OrderOtp | N | partial | Phase 2 |
| GET `/api/orders/:orderId/return` | `OrderReturnService.getReturnDetails` | verifyToken | Order, OrderOtp | — | — | — | OK |
| POST `/api/orders/:orderId/return/approve` | `orderController.approveReturnRequest` → `OrderReturnService.approveReturn` | verifyToken role=seller/admin | Order | Order, OrderOtp (create pickup OTP) | N | — | Phase 2 |
| POST `/api/orders/:orderId/return/reject` | reject | seller/admin | Order | Order | N | — | OK |
| POST `/api/orders/:orderId/return/qc` | `orderController.updateReturnQcStatus` | admin | Order | Order, (downstream `refund flow` if `qc_passed`) | **N** | partial | **P0-C4 — non-transactional refund** |
| POST `/api/orders/:orderId/return/pickup-otp/send` | (delegates) | seller/delivery | OrderOtp | OrderOtp (W) | N | — | OK |
| POST `/api/orders/:orderId/return/pickup-otp/verify` | (delegates) | delivery | Order, OrderOtp | Order, OrderOtp, Wallet (DELIVERY_PARTNER), LedgerEntry? — check | partial | — | Phase 2: confirm session + ledger |
| Workflow endpoints (`/api/orders/workflow/...`) | `orderWorkflowController.*` | verifyToken | Order, DeliveryAssignment, Transaction | Order, DeliveryAssignment, Transaction, Wallet (via creditWallet) | partial | partial | Phase 2 |

**Cross-cut:** every `populate("customer", ...)` and `populate("items.product", ...)` works because `Order.customer→User` and `Order.items[].product→Product` refs are correct.

## 5.3 Payment domain

Routes from `app/routes/paymentRoutes.js`.

| Method · Path | Controller fn | Auth | Models R | Models W | Tx | Validation | Risk |
|---|---|---|---|---|---|---|---|
| POST `/api/payments/initiate` | `paymentController.initiatePayment` → `paymentService` | verifyToken | Order (or CheckoutGroup), Payment | Payment (W) | **Y** (multi-write for multi-seller) | `paymentValidation` ✓ | OK |
| POST `/api/payments/callback` | `paymentController.handleCallback` → `paymentService.handleCallback` | webhook (signature verify) | PaymentWebhookEvent (R), Payment, Order, CheckoutGroup | PaymentWebhookEvent (W), Payment (W), Order (W: paymentStatus), CheckoutGroup (W), LedgerEntry, Wallet | **Y** | webhook signature | OK; ledger integrity depends on `handleOnlineOrderFinance` (orderFinanceService) |
| GET `/api/payments/:gatewayOrderId/status` | `paymentController.getPaymentStatus` | verifyToken | Payment, Order | — | — | inline | OK |
| POST `/api/payments/verify` | `paymentController.verifyPayment` | verifyToken | Payment, Order | Payment (W), Order (W) | partial | partial | Phase 2: wrap |

## 5.4 Seller domain

Routes from `app/routes/sellerAuth.js`.

| Method · Path | Controller fn | Auth | Models R | Models W | Tx | Validation | Risk |
|---|---|---|---|---|---|---|---|
| POST `/api/seller/register` | `sellerAuthController.register` | none | Seller | Seller | N | `sellerValidation` ✓ | OK |
| POST `/api/seller/login` | `sellerAuthController.login` | none | Seller (incl. password) | Seller (lastLogin) | N | ✓ | OK |
| GET `/api/seller/dashboard/stats` | `sellerStatsController.getStats` → `sellerStatsService.getDashboardStats` | seller | Order, Product, Review, SellerMetrics | — | — | — | OK |
| POST `/api/seller/products` | `productController.createProduct` | seller (approved) | Category, Product (slug check) | Product, MediaMetadata (link) | N | `productValidation` ✓ | OK |
| PUT `/api/seller/products/:id` | `productController.updateProduct` | seller (approved) | Product | Product | N | partial | OK |
| DELETE `/api/seller/products/:id` | `productController.deleteProduct` | seller (approved) | Product | Product (W: `status:"inactive"`) | N | — | **Soft-delete via `status` only — cart/wishlist not cleaned** (Phase 6) |
| GET `/api/seller/orders` | `orderQueryService.getSellerOrders` | seller | Order (populate customer name/phone) | — | — | — | OK |
| POST `/api/seller/orders/:orderId/accept` | `orderWorkflowController.acceptOrderAsSeller` | seller | Order | Order (W), Notification (W) | partial | inline | Phase 2 |
| POST `/api/seller/orders/:orderId/reject` | reject | seller | Order | Order, stockService.releaseReservedStock | partial | inline | Phase 2 |
| POST `/api/seller/withdrawals` | `sellerController.requestWithdrawal` (line 111: `Transaction.create({type:"Withdrawal"})`) | seller (approved) | Seller, Wallet (SELLER) | Transaction (legacy), Wallet (?), Notification | **N** | partial | Phase 2: wrap + write LedgerEntry |
| GET `/api/seller/withdrawals` | history | seller | Transaction | — | — | — | hits unindexed `(userModel,type)` filter — Phase 3 adds compound |
| GET `/api/seller/wallet` | wallet balance | seller | Wallet | — | — | — | Phase 4 single source |

**Orphan-field check on `Seller`:** none in the controllers I inspected. `sellerAuthController.register` writes the schema-declared fields only.

## 5.5 Delivery domain

Routes from `app/routes/deliveryAuth.js`.

| Method · Path | Controller fn | Auth | Models R | Models W | Tx | Validation | Risk |
|---|---|---|---|---|---|---|---|
| POST `/api/delivery/register` | `deliveryAuthController.register` | none | Delivery | Delivery | N | `deliveryValidation` ✓ | OK |
| POST `/api/delivery/login` | `deliveryAuthController.login` | none | Delivery | Delivery | N | ✓ | OK |
| POST `/api/delivery/location` | `deliveryController.updateLocation` → `locationThrottleService` | delivery | Delivery (R via cache) | Delivery (W: location, lastLocationAt) | N | inline | OK; uses Redis throttle |
| GET `/api/delivery/orders/available` | `deliveryController.fetchAvailableOrders` | delivery | Delivery (location), Order (2dsphere + status filters), DeliveryAssignment | — | — | — | OK; uses idx_returnStatus_deliveryBoy_created |
| POST `/api/delivery/orders/:orderId/accept` | `deliveryController.acceptOrder` | delivery | Order, DeliveryAssignment, idempotencyService | Order (W: deliveryBoy, workflowStatus), DeliveryAssignment (W) | partial | inline | Phase 2: wrap |
| POST `/api/delivery/orders/:orderId/pickup-otp/verify` | `deliveryController.verifyPickupOtp` | delivery | OrderOtp, Order | OrderOtp (W: consumedAt), Order (W: pickup state), Wallet (rider commission?) | partial | — | Phase 2 |
| POST `/api/delivery/orders/:orderId/delivery-otp/verify` | `deliveryController.verifyDeliveryOtp` | delivery | OrderOtp, Order | OrderOtp, Order, Transaction (cash collection), Wallet (rider) | **N** | — | Phase 2 + ledger |
| POST `/api/delivery/orders/:orderId/return-pickup-otp/verify` | `deliveryController.verifyReturnPickupOtp` | delivery | OrderOtp, Order | OrderOtp, Order, Wallet (commission), Transaction (Delivery Earning) | **N** | — | Phase 2 + ledger |
| GET `/api/delivery/earnings` | `deliveryEarningsService.getDeliveryEarnings` | delivery | Transaction | — | — | — | OK; uses idx_user_userModel_status_created |
| GET `/api/delivery/cash-summary` | `deliveryController.getCashSummary` | delivery | Order (paymentMode=COD aggregations), Wallet | — | — | — | OK; uses idx_deliveryBoy_paymentMode_created |
| POST `/api/delivery/withdrawals` | `deliveryController.requestWithdrawal` (line 313) | delivery | Delivery, Wallet | Transaction (type:"Withdrawal"), Wallet, Notification | **N** | partial | Phase 2 + ledger |

## 5.6 Admin domain

Routes from `app/routes/adminAuth.js`. Many sub-controllers in `app/controller/admin/`.

| Method · Path | Controller | Auth | Models R | Models W | Tx | Validation | Risk |
|---|---|---|---|---|---|---|---|
| POST `/api/admin/login` | `adminAuthController.login` | none | Admin | Admin (lastLogin) | N | `adminAuthValidation` ✓ | OK |
| GET `/api/admin/dashboard` | `admin/dashboardController` → `dashboardService` | admin | DashboardStats, Order, Product, Seller, User, Delivery | — | — | — | OK |
| GET `/api/admin/sellers/applications` | `admin/sellerApplicationsController` | admin | Seller (applicationStatus:pending) | — | — | — | OK |
| POST `/api/admin/sellers/applications/:id/approve` | `sellerApplicationService.approveSeller` | admin | Seller | Seller (W: isVerified, isActive, applicationStatus, reviewedAt, reviewedBy) | N | inline | OK (single doc) |
| POST `/api/admin/sellers/applications/:id/reject` | reject | admin | Seller | Seller (W) | N | inline | OK |
| GET `/api/admin/sellers` | `admin/sellerDirectoryController` → `sellerDirectoryService` | admin | Seller, Order, Product, Transaction | — | — | — | OK |
| GET `/api/admin/users` | `admin/userController` | admin | User | — | — | — | OK |
| GET `/api/admin/delivery` | `admin/deliveryController` | admin | Delivery (populate via $lookup?), Order | — | — | — | check populate("customer", "name phone") at line 108 |
| GET `/api/admin/finance/wallet` | `adminFinanceController.getWalletOverview` → `walletAdminService.getAdminWalletOverview` | admin | Wallet (ADMIN), LedgerEntry, Order (aggregations) | — | — | — | OK |
| GET `/api/admin/finance/transactions` | `walletAdminService.getDeliveryTransactionsData` etc. | admin | Transaction | — | — | — | filters by `{userModel:"Delivery"}` (no `type`) — partly indexed |
| POST `/api/admin/finance/cash-settlement` | `admin/cashController` → `cashService` | admin | Wallet, Delivery, Transaction | Wallet (DELIVERY_PARTNER), Transaction (Cash Settlement), LedgerEntry? | partial | inline | Phase 2 |
| POST `/api/admin/finance/payouts/:payoutId/process` | (adminFinance) → `payoutService.processPayout` | admin | Payout, Wallet, LedgerEntry | Payout (W), Wallet (W), LedgerEntry (W) | **Y** | inline | OK — already proper |
| GET `/api/admin/orders` | `orderQueryService.getAdminOrders` | admin | Order (paginated, populate) | — | — | — | OK |
| PUT `/api/admin/orders/:orderId/status` | `orderController.updateOrderStatus` (admin role) | admin | as above | as above | N | partial | Phase 2 |
| Refund admin endpoints | `orderController.updateReturnQcStatus`, `applyReturnRefund` | admin | as §5.2 | as §5.2 | **N** | partial | **P0-C4** |
| POST `/api/admin/walletadjustments` | `admin/walletController` | admin | Wallet | Wallet, LedgerEntry, FinanceAuditLog | partial | inline | Phase 2 |

## 5.7 Product domain (public + admin)

Routes from `app/routes/productRoutes.js`.

| Method · Path | Controller | Auth | Models R | Models W | Tx | Validation | Risk |
|---|---|---|---|---|---|---|---|
| GET `/api/products` | `productController.listPublic` | optional | Product (status active + approved/legacy), Category | — | — | — | OK; uses regex search — see §4.6 |
| GET `/api/products/:slug` | `productController.getProductDetails` | optional | Product, Review | — | — | — | OK |
| GET `/api/products/search` | `productController.searchProducts` → `searchService` | optional | Product (Mongo + Algolia fallback?) | — | — | — | regex falls back to text index if exists |
| POST `/api/seller/products` (admin mirror) | createProduct | admin | Category, Product | Product, MediaMetadata, searchSyncService | N | ✓ | enqueues search sync — failures persisted to `SearchIndexFailure` |
| PUT `/api/products/:id/approve` | `productModerationService.approve` | admin | Product | Product (approvalStatus, approvalReviewedBy, approvalReviewedAt) | N | inline | OK |

## 5.8 Category domain

Routes from `app/routes/categoryRoutes.js` — mounted twice intentionally.

| Method · Path | Controller | Auth | Models R | Models W | Risk |
|---|---|---|---|---|---|
| GET `/api/categories` | `categoryController.list` | optional | Category (tree) | — | OK; virtual `children` works |
| POST `/api/admin/categories` | createCategory | admin | Category | Category | OK; legacy-sync hook handles commission/handling fields |
| PUT `/api/admin/categories/:id` | updateCategory | admin | Category | Category | OK; pre('findOneAndUpdate') keeps fields synced |
| DELETE `/api/admin/categories/:id` | deleteCategory | admin | Category, Product (refs?) | Category | **Phase 6: cascade check on Products** |

## 5.9 Coupon · Offer · Experience · Hero domain (content)

Mostly admin CRUD + public read. Routes from `couponRoutes.js`, `offerRoutes.js`, `experienceRoutes.js`. No orphan-field risks observed.

`[P1] coupon-apply` in `checkoutPricingService.js` reads `Coupon`, computes discount, but DOES NOT increment `Coupon.usedCount` atomically. Concurrent checkouts can over-redeem a `usageLimit:1` coupon. Phase 2: atomic `findOneAndUpdate({_id, usedCount: {$lt: usageLimit}}, {$inc:{usedCount:1}}, {session})` with the result-count check.

## 5.10 Ticket · Review domain — mostly straightforward CRUD. Already covered.

## 5.11 Notification · Push domain

| Method · Path | Controller | Auth | Models R | Models W | Risk |
|---|---|---|---|---|---|
| GET `/api/notifications` | `notification.controller.listForUser` | verifyToken | Notification | — | OK |
| POST `/api/notifications/:id/read` | mark read | verifyToken | Notification | Notification (W: isRead) | OK |
| POST `/api/push/register-token` | register FCM token | verifyToken | PushToken | PushToken (upsert) | OK |
| (internal) | `notification.builder` → `notification.service.create` | — | NotificationPreference | Notification (W), Bull queue | OK |

`[P2] notif-event` Notification creation happens **after** the originating action (e.g. `emitNotificationEvent(NOTIFICATION_EVENTS.ORDER_CONFIRMED)` in `orderController.js:548`). The event handler enqueues a Bull job; the job creates the Notification row and sends FCM. If the order action commits but the queue is down, no notification fires. Acceptable (best-effort).

## 5.12 Media domain

Routes from `app/routes/mediaRoutes.js`. Uses `MediaMetadata` for asset tracking. `uploadedByModel` enum issue (§2.9).

---

# 6. ORPHAN FIELDS — write sites that touch fields not declared in schema

Methodology: for each model, grep `<Model>.{create,save,updateOne,findOneAndUpdate,updateMany,insertMany,new <Model>(`, extract written field names, cross-reference with schema.

## 6.1 Order — write-site catalog (most touched)

Schema fields are listed in Part 1 §3.1. Write sites:

| File:line | Operation | Fields written | Orphan? |
|---|---|---|---|
| `orderPlacementService.js:376-421` | `new Order(...)` then `order.save({session})` | All canonical fields; `pricing` is spread from `entry.breakdown` (which carries `productSubtotal, sellerPayoutTotal, …` — those are NOT order.pricing schema fields, they belong to `paymentBreakdown.*`). Comment on line 392 hints: "This might overwrite fields, be careful". | **Subtle**: `entry.breakdown` keys overlap with `paymentBreakdown` schema but are spread into `pricing`. Mongoose discards keys that don't match `pricing` sub-schema, but the data loss is silent. Phase 4: explicit mapping. |
| `orderPlacementService.js:423` | `freezeFinancialSnapshot(order, entry.breakdown)` | Mutates order in place; sets `paymentBreakdown.*`, `pricingSnapshot.*`. Open `orderFinanceService.js:freezeFinancialSnapshot` to verify it writes only declared fields. | Need to verify in Phase 0 audit. |
| `orderController.js:462-464` | `order.status = status; order.orderStatus = status; order.deliveryBoy = deliveryBoyId` | Schema fields ✓ | OK |
| `orderController.js:497-500` | `Transaction.findOneAndUpdate({reference}, {status:"Failed"})` | Transaction field `status` ✓ | OK |
| `orderController.js:512` | `order.deliveredAt = new Date()` | Schema field ✓ | OK |
| `orderController.js:1004-1007` | `Order.findByIdAndUpdate(order._id, {"settlementStatus.sellerPayout":"CANCELLED", "financeFlags.sellerPayoutHeld":false})` | `settlementStatus.sellerPayout` ✓ (enum includes "CANCELLED"). **`financeFlags.sellerPayoutHeld` is NOT declared in schema** — `financeFlags` declares only `{onlinePaymentCaptured, codMarkedCollected, deliveredSettlementApplied, sellerPayoutQueued, riderPayoutQueued, adminEarningCredited}`. → **ORPHAN FIELD**. Mongoose with `strict:true` (default) will silently drop this write. Update is a no-op. |
| `orderController.js:1079-1082` | `order.returnStatus = "refund_completed"; order.payment.status = "refunded"` | Both schema fields ✓ | OK |
| `orderWorkflowService.js` | various Order updates to `workflowStatus`, `sellerPendingExpiresAt`, etc. | Schema fields ✓ | OK |

**Action (Phase 1):** add `sellerPayoutHeld:Boolean default false` to `Order.financeFlags` schema. This is the only orphan write found on Order.

## 6.2 Transaction — write-site catalog

| File:line | Operation | `type` value | Orphan? |
|---|---|---|---|
| `orderPlacementService.js:448` | create | `"Wallet Payment"` | **ORPHAN — not in enum (§2.2)** |
| `orderPlacementService.js:463` | create | `"Order Payment"` | ✓ |
| `orderController.js:497` | findOneAndUpdate | `status:"Failed"` (no `type`) | ✓ |
| `orderController.js:975` | create | `"Refund"` | ✓ |
| `orderController.js:1037` | create | `"Refund"` | ✓ |
| `orderController.js:1068` | create | `"Delivery Earning"` | ✓ |
| `orderWorkflowController.js:335` | create | `"Delivery Earning"` (or similar — confirm) | Need verify |
| `deliveryController.js:162` | create | `"Cash Collection"` | ✓ |
| `deliveryController.js:313` | create | `"Withdrawal"` | ✓ |
| `sellerController.js:111` | create | `"Withdrawal"` | ✓ |
| `cashService.js:189` | create | `"Cash Settlement"` | ✓ |
| `orderCompensation.js:19` | findOneAndUpdate | n/a | ✓ |
| `orderSettlement.js:22,35,55` | findOneAndUpdate | n/a | ✓ |

Only one orphan — confirmed.

## 6.3 Payment — write-site catalog

All writes from `paymentService.js`. Fields written match schema. No orphans found.

## 6.4 Cart, Wishlist, CheckoutGroup — no orphans

Confirmed by reading respective controllers/services.

## 6.5 Notification — write-site catalog

Notifications written by `notification.service.create()` (in `app/modules/notifications/`). The builder pattern emits `(recipient, recipientModel, title, message, type, data)`. Some places also pass `userId, role, body`. Pre-validate hook syncs.

**Risk:** the hook fails if **both** sides are unset (because `recipient:required` AND `recipientModel:required`). For pure-`userId`-style writers, `recipient` is filled by the hook ✓.

## 6.6 Wallet — write-site catalog

Always via `walletService` functions. Fields written: `availableBalance`, `pendingBalance`, `cashInHand`, `totalCredited`, `totalDebited`. All schema-declared.

`[P0 P0]` — **Implicit invariant violation:** `totalCredited - totalDebited != sum of buckets` after wallet creation (initial balances are zero), but after movements, this should hold. No check in code. Phase 2 adds a verifier.

## 6.7 LedgerEntry — no orphan field writes, but TWO MISSING FIELDS we expect:

1. `idempotencyKey:String` (for dedup retries) — Phase 2 adds.
2. `correlationId:String` — Phase 2 adds (matches `Payment.correlationId`).

## 6.8 Product, Category, Seller, Delivery, User, OtpSession, OrderOtp — clean (write sites match schema)

## 6.9 Filter-key orphans (read-side)

| File:line | Query filter | Filter keys not in schema |
|---|---|---|
| `walletAdminService.js:48` | `Transaction.find({userModel:"Delivery"})` | ✓ |
| `walletAdminService.js:67-68` | `Transaction.find({userModel:"Seller", type:"Withdrawal"})` | ✓ but unindexed |
| `orderQueryService.js` various | `Order.find({customer, status, …})` | ✓ |
| `orderController.js cancel branch` | `Transaction.findOneAndUpdate({reference: canonicalOrderId})` | ✓ |
| `cartController.js` | `Cart.findOne({customerId})` | ✓ |

No filter-key orphans found.

---

# 7. REQUEST LIFECYCLE TRACES (highest-traffic endpoints)

## 7.1 `POST /api/orders` (order placement)

```
Express router
  ↓ auth: verifyToken
  ↓ validation: orderValidation (Joi schema)
orderController.placeOrder
  ↓ extract idempotencyKey from headers
orderPlacementService.placeOrderAtomic
  ↓ idempotencyService.checkIdempotency(key, payload)        [Redis + Order.placement.idempotencyKey index]
  ↓ idempotencyService.acquireIdempotencyLock(key)            [Redis SETNX]
  ↓ findExistingCheckoutByIdempotency(customerId, key)        [CheckoutGroup + Order index]
  ↓ mongoose.startSession()
  ↓ session.startTransaction({readConcern:'snapshot', writeConcern:'majority'})
  ↓ User.findById(customerId).session()                        [for walletBalance]
  ↓ resolveOrderItemsInput(payload, customerId, session)       [Cart.findOne if cart-mode]
  ↓ buildCheckoutPricingSnapshot({orderItems, address, …})    [Setting + Category aggregation]
  ↓ generateUniqueCheckoutGroupId(session)
  ↓ new CheckoutGroup(...).save({session})
  ↓ for each seller:
  │   ↓ generateUniquePublicOrderId(session)
  │   ↓ reserveStockForItems(items, sellerId, orderId, session)   [Product.findOneAndUpdate with $gte stock guard]
  │   ↓ new Order(...).save({session})
  ↓ checkoutGroup.orderIds = [orderIds]; checkoutGroup.save({session})
  ↓ if walletAmount > 0:
  │   ↓ user.walletBalance -= walletAmount; user.save({session})
  │   ↓ Transaction.create({type:"Wallet Payment"}, {session})         ← **P0-C2 ENUM VIOLATION**
  ↓ Transaction.create(transactionRows, {session, ordered:true})        [one tx per seller, type:"Order Payment", status:"Pending"]
  ↓ consumeCartItems(...)                                    [removes ordered lines from cart]
  ↓ commitTransaction()
  ↓ if paymentMode === "ONLINE":
       returns checkoutGroup payload to client → client initiates payment
       Bull queue: sellerTimeoutQueue scheduled for SELLER_PENDING expiry
  ↓ if paymentMode === "COD":
       afterPlaceOrderV2(orders, …)                          [emit notification events]
  ↓ storeIdempotencyResult(key, result)                       [Redis + DB]
  ↓ releaseIdempotencyLock(key)
```

**Models touched (R):** User, Cart, Setting, Category, Product (stock), CheckoutGroup, Order
**Models touched (W):** CheckoutGroup, Order (×N), Product (stock decrement), Cart, User (walletBalance), Transaction (×N+1 if wallet redeemed)
**Transactional:** Yes.
**Idempotent:** Yes.
**Issues:** §2.2 (Wallet Payment enum), §2.7 (walletBalance dual write).

## 7.2 `POST /api/payments/callback` (PhonePe webhook)

```
Express router (no /api prefix may be applied; depends on webhook config)
  ↓ raw body parser
  ↓ signature verification (in paymentService.verifyClientPaymentCallback)
paymentController.handleCallback
  ↓ extract eventId, gatewayOrderId, status
  ↓ PaymentWebhookEvent.findOneAndUpdate({eventId}, {…}, {upsert:true})   [idempotency gate]
  ↓ if duplicate event: 200 OK, no work
  ↓ resolvePaymentTarget(orderRef)                            [single order OR CheckoutGroup]
  ↓ mongoose.startSession()
  ↓ session.startTransaction()
  ↓ Payment.findOneAndUpdate({gatewayOrderId}, {status, ...}, {session})
  ↓ if status === 'SUCCESS':
  │   ↓ Order.updateMany({_id: {$in: targetOrderIds}}, {paymentStatus:"PAID", "payment.status":"completed"}, {session})  ← sync legacy
  │   ↓ handleOnlineOrderFinance(orders, payment, {session})
  │       ↓ for each order: createLedgerEntry({type:ORDER_ONLINE_PAYMENT_CAPTURED, direction:CREDIT, actorType:CUSTOMER}, {session})
  │       ↓ for each order: createLedgerEntry({type:SELLER_PAYOUT_PENDING, direction:CREDIT, actorType:SELLER, status:PENDING}, {session})
  │       ↓ for each order: creditWallet({ownerType:SELLER, ownerId:order.seller, bucket:'pending'}, {session})
  │       ↓ afterPlaceOrderV2(orders) → starts seller-pending workflow (post-tx)
  │   ↓ CheckoutGroup.findByIdAndUpdate({paymentStatus:"PAID", status:"PAID"}, {session})
  ↓ commitTransaction()
  ↓ emitNotificationEvent(PAYMENT_CAPTURED)
```

**Critical correctness note:** `creditWallet` writes to Wallet but **does not** create the matching `LedgerEntry`. So even though `handleOnlineOrderFinance` explicitly creates the `SELLER_PAYOUT_PENDING` ledger entry, the **wallet movement is duplicated in spirit** (one ledger entry says "credit pending bucket" + the wallet doc itself shows pendingBalance increased). This is OK for online payments today because the ledger entry exists. **But** the moment someone calls `creditWallet` for an event without an accompanying explicit `createLedgerEntry` — see refund flow §2.4 — the audit trail is gone.

## 7.3 `POST /api/orders/:orderId/return/qc` → return-refund

Detailed in §2.4. **Non-transactional, multiple bookkeepers, missing ledger entries.** Top fix priority in Phase 2.

## 7.4 `POST /api/delivery/orders/:orderId/delivery-otp/verify` (COD delivery)

```
deliveryController.verifyDeliveryOtp
  ↓ OrderOtp.findOne({orderMongoId, type:"delivery", consumedAt:null, expiresAt:{$gt:now}})
  ↓ compare hash
  ↓ OrderOtp.updateOne({_id}, {consumedAt: now})
  ↓ Order.findByIdAndUpdate({_id}, {
       status:"delivered", deliveredAt, workflowStatus:"DELIVERED",
       "financeFlags.codMarkedCollected": true,
       "paymentBreakdown.codCollectedAmount": grandTotal,
       "payment.status": "completed"
     })
  ↓ applyDeliveredSettlement(order)
       ↓ orderFinanceService.handleCODSettlement(order)
            ↓ if not yet settled: createLedgerEntry({ORDER_COD_COLLECTED, DEBIT, CUSTOMER}, …)
            ↓ creditWallet({ownerType:DELIVERY_PARTNER, bucket:'cashInHand', amount:grandTotal})  ← **NO LEDGER ENTRY because walletService doesn't write one**
            ↓ createLedgerEntry({SELLER_PAYOUT_PENDING, CREDIT, SELLER}, …)
            ↓ creditWallet({ownerType:SELLER, bucket:'pending', amount:sellerPayoutTotal})         ← same
            ↓ createLedgerEntry({ADMIN_EARNING_CREDITED, CREDIT, ADMIN}, …)
            ↓ creditWallet({ownerType:ADMIN, bucket:'available', amount:adminEarning})             ← same
            ↓ FinanceAuditLog.create({ORDER_DELIVERED_SETTLED, …})
```

The settlement path explicitly creates ledger entries — so this flow is **audit-complete** for the ledger side. But the cashInHand credit for the rider has only the ledger entry (`ORDER_COD_COLLECTED`) — there's no `RIDER_CASH_RECEIVED` event in the ledger type enum. Phase 2 audits whether existing ledger types cover all wallet movements.

---

# 8. CACHE ↔ DB CONSISTENCY

`app/services/cacheService.js` is the central cache layer. Invalidation patterns:

| Cache prefix | Backing model | Invalidated where? |
|---|---|---|
| `orders:customer:<id>:*` | Order | `orderController.updateOrderStatus`, `orderPlacementService` (no — confirm), `orderQueryService` (read-only) |
| `categories:tree` | Category | `categoryController` mutations (verify) |
| `settings:current` | Setting | `settingsController.updateSettings` |
| `products:list:*` | Product | `productController` mutations (verify) |
| `dashboard:*` | DashboardStats | async worker writes |

**[P2] cache-1** — verify every write site invalidates the matching prefix. Phase 3 adds a wrapper helper `withCacheInvalidation(model, key)` to enforce.

---

# 9. QUEUE ↔ DB CONSISTENCY

Bull queues in `app/queues/`:

| Queue | Job processor | DB writes |
|---|---|---|
| `sellerTimeoutQueue` | `orderWorkflowService.processSellerTimeout` | Order (W: workflowStatus=SELLER_TIMEOUT_REJECTED), stockService.releaseReservedStock |
| `deliveryTimeoutQueue` | `orderWorkflowService.processDeliveryTimeout` | Order, DeliveryAssignment |
| `notificationQueue` (`app/modules/notifications/notification.queue.js`) | `notification.worker` | Notification (W: status/sentAt), pushFcm |
| `searchSyncQueue` | `searchSyncService` worker | Algolia (external), SearchIndexFailure on retry-exhaust |

**[P2] queue-1** — Job idempotency: most jobs use `Order._id` and check `workflowStatus` before acting. Verify each. Phase 3 audit.

**[P2] queue-2** — Failed jobs persisted: only `SearchIndexFailure` is logged to DB. Notification queue failures stay in Bull / `Notification.status:"failed"`. Workflow timeout failures only log to console. Phase 6 introduces a `JobFailureLog` collection (defer unless on-call demands it).

---

# 10. CRON / SCHEDULER ↔ DB

`app/services/distributedScheduler.js` registers crons via Redis lock. Jobs:

| Job | Schedule | DB writes |
|---|---|---|
| Index re-verification | startup + daily | none (uses `databaseIndexManager.verifyIndexes()`) |
| Low-stock alert | hourly | Notification (alerts) |
| Dashboard stats refresh | every 10 min | DashboardStats (upsert) |
| Finance daily report | midnight | FinanceReports (upsert by date), SellerMetrics |
| Cart abandonment (if any) | (verify) | Notification |

`[P2] cron-1` — Verify every financial cron writes a `FinanceAuditLog`. Phase 2.

---

# 11. SOCKET ↔ DB

`app/services/orderSocketEmitter.js`, `ticketSocketEmitter.js`. Sockets EMIT only — they do not write to the DB. Reads happen via standard query services. **No socket-driven write race conditions.**

`[P3] socket-1` Some socket emits happen between DB write and transaction commit (e.g. `emitNotificationEvent` calls inside controller functions). Best-effort design; acceptable.

---

End of Part 2. **Part 3** delivers the phased implementation roadmap (Phase 0 → 7) with explicit step-by-step instructions, dependencies, backward-compat strategy, and acceptance criteria per phase.
