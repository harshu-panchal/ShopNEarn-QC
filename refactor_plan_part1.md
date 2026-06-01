# Appzeto Quick-Commerce — Professional Refactor & Modernization Plan
## Part 1 of 3: Architecture Assessment + Coupling & Cohesion Analysis

> **Target:** 3–10 lakh users | **Strategy:** Modular Monolith | **Approach:** Wrap & Improve

---

# 1. CURRENT ARCHITECTURE ASSESSMENT

## Tech Stack (as found)
| Layer | Technology |
|---|---|
| Backend | Node.js 18+ / ES Modules / Express 5 |
| Database | MongoDB + Mongoose 8 |
| Cache | Redis (ioredis) with pub/sub invalidation |
| Queue | Bull (Redis-backed) |
| Real-time | Socket.IO 4 |
| Payments | PhonePe PG SDK (hardwired — no abstraction) |
| Push | Firebase Admin SDK |
| Media | Cloudinary |
| Maps | Google Maps Services JS |
| SMS | IndiaHub (custom service wrapper) |
| Frontend | Vite + React (JSX) + Tailwind CSS |
| Auth | JWT + localStorage (role-keyed per portal) |

---

## 1.1 Current Strengths

### Backend
- **Process-role separation is excellent.** `index.js` cleanly separates HTTP / Worker / Scheduler into isolated startup paths with graceful shutdown handlers.
- **Core infrastructure is solid.** `app/core/` has `startup.js`, `shutdown.js`, `processRole.js` — readiness probes and graceful shutdown are production-ready.
- **Finance module is the most mature.** `app/services/finance/` is properly isolated with `ledgerService`, `walletService`, `payoutService`, `pricingService`, `auditLogService` — clean separation inside the domain.
- **Notifications module is fully self-contained.** `app/modules/notifications/` has its own controller, service, queue, worker, builder, model, routes — this is the target pattern for all modules.
- **OTP module is self-contained.** `app/modules/otp/` follows the same co-location pattern.
- **Cache service is production-safe.** Uses SCAN (not KEYS), pub/sub invalidation, graceful fallbacks, and TTL configured per entity type via env vars.
- **Idempotency is implemented.** `idempotencyService.js` exists and is used in payment and delivery-accept flows.
- **Distributed scheduler.** `distributedScheduler.js` prevents job double-firing on multi-instance deployments.
- **Transaction safety.** Finance operations use `mongoose.startSession()` with proper abort/commit/finally patterns throughout `orderFinanceService.js`.

### Frontend
- **Module-based folder structure is started.** `src/modules/{admin,customer,seller,delivery}/` separates portal concerns.
- **Core layer is defined.** `src/core/` has api, context, guards, firebase, services — the right abstractions exist.
- **API deduplication exists.** `core/api/dedupe.js` prevents duplicate in-flight requests.
- **Error boundaries are implemented.** `RootErrorBoundary` and `ErrorBoundary` exist.
- **Role-based guards exist.** `ProtectedRoute` and `RoleGuard` are in core.

---

## 1.2 Current Weaknesses

### Backend — Critical Issues

**B1. Monolithic Controllers (God Objects)**
- `orderController.js` = **2,004 lines / 61 KB** — business logic, validation helpers, DB queries, socket emissions, cache ops, finance calls all in one file.
- `deliveryController.js` = **1,030 lines / 37 KB** — location throttling, COD finance logic, OTP coordination, earnings aggregation all mixed.
- `productController.js` = **37 KB** — product CRUD, image handling, search sync, moderation all mixed.
- `orderWorkflowService.js` = **1,082 lines / 30 KB** — state machine, queue scheduling, socket emissions, notifications, proximity checks all in one service.

**B2. Business Logic Duplicated Across Files**
- `computeReturnWindowForOrder()` defined in `orderController.js` AND `computeReturnWindowDates()` in `orderFinanceService.js` — same logic, different names, different files.
- `parsePositiveInt()` defined independently in both `orderController.js` and `orderFinanceService.js`.
- `getReturnEligibilityDelayMinutes()` / `getReturnWindowMinutes()` — duplicated in **both** files.
- `validateWithJoi()` — inline helper duplicated inside `orderController.js` instead of using shared validation.

**B3. Provider Leakage — PhonePe Hardwired**
- `paymentService.js` imports `StandardCheckoutClient, Env, StandardCheckoutPayRequest` from `@phonepe-pg/pg-sdk-node` at the top level with no abstraction layer.
- The stub `verifyClientPaymentCallback()` at the bottom of the file already shows future pain — it just re-routes to PhonePe.

**B4. Infrastructure Leakage Into Domain Layer**
- `deliveryController.js` calls `getRedisClient()` directly for location throttling.
- `orderWorkflowService.js` imports and calls Bull queues (`sellerTimeoutQueue`, `deliveryTimeoutQueue`) directly — queue infrastructure inside domain service.
- `orderWorkflowService.js` calls `getRedisClient()` directly for idempotency checks.

**B5. Flat File Layout — No Domain Boundaries**
- `app/controller/` = 28 flat files, no domain grouping.
- `app/services/` = 38 flat files mixing infrastructure services (`cacheService`, `emailService`, `firebaseService`, `logger`) with domain services (`orderWorkflowService`, `orderPlacementService`) at the same level.
- `app/models/` = 37 flat files, no grouping by domain.

**B6. Duplicate Middleware Files**
- `middleware/rateLimiter.js` AND `middleware/rateLimiters.js` both exist — overlapping responsibility.

**B7. Inconsistent Validation**
- Only 4 validation files exist for 28 controllers. Most controllers have no Joi schema — validation is ad-hoc inline.

**B8. Route Mounting Anomalies**
- `categoryRoute` mounted at **both** `/admin/categories` AND `/categories` (lines 37 and 41 of `routes/index.js`) — same handler registered twice, no clear ownership.
- `experienceRoute`, `offerRoute`, `couponRoute` all mounted at `/` root — pollutes the root namespace.

**B9. Inconsistent Logging**
- `orderController.js` uses `console.error`, `console.warn`, `console.log` directly.
- `paymentService.js` uses `console.log(JSON.stringify({level:'info'...}))` — manual structured logging instead of using the existing `logger.js`.
- `cacheService.js` uses the proper `logger.js`. The inconsistency is a maintainability risk.

### Frontend — Critical Issues

**F1. URL-Path-Based Auth (Fragile)**
- `AuthContext.jsx` derives the current role from `window.location.pathname` on every render via `getCurrentRoleFromUrl()`.
- `axios.js` independently also reads `window.location.pathname` to pick auth tokens — same logic duplicated in two places.
- Any route rename breaks auth silently.

**F2. Monolithic Page Files**
- `admin/pages/ProductManagement.jsx` = **80,952 bytes**
- `seller/pages/Orders.jsx` = **64,730 bytes**
- `delivery/pages/DeliveryAuth.jsx` = **56,670 bytes**
- `admin/pages/ContentManager.jsx` = **58,235 bytes**
- `customer/pages/CheckoutPage.jsx` = **43,995 bytes**
- These files have 0 component decomposition — impossible to review, test, or maintain.

**F3. No Reusable Hooks**
- Only **1 hook** in `core/hooks/` (`useInViewAnimation.js`).
- No `usePagination`, `useApiState`, `useDebounce`, `useForm`, `useConfirmDialog` — patterns are re-implemented inline across dozens of page files.

**F4. Thin Shared Component Layer**
- `shared/components/` has only 9 files.
- No shared `DataTable`, `FilterBar`, `Modal`, `ConfirmDialog`, `StatusBadge`, `Pagination`, `FormField` — each page re-implements these UI patterns from scratch.

**F5. Single API File Per Module**
- `admin/services/adminApi.js` = **9,603 bytes** covering ALL admin API calls in one file.
- No domain splitting (no `admin/services/orderApi.js`, `sellerApi.js`, etc.).

**F6. No Server State Management**
- No React Query / SWR / Zustand — all server state managed manually with `useState` + `useEffect` + raw axios in every page file.
- Loading, error, refetch, and pagination logic re-implemented per page file.

**F7. Orphaned Top-Level Pages**
- `src/pages/Login.jsx`, `Signup.jsx`, `Profile.jsx` exist at the root level but overlap with module-specific auth pages (`customer/pages/CustomerAuth.jsx`, `admin/pages/AdminAuth.jsx`).

---

## 1.3 Technical Debt Summary

| Area | Debt Level | Risk |
|---|---|---|
| orderController.js size | 🔴 Critical | Change blast radius covers entire order domain |
| paymentService provider lock | 🔴 Critical | Cannot add any payment provider |
| Return window logic duplication | 🟠 High | Financial calculation bugs from drift |
| Infrastructure in domain (Redis/Bull in controllers/services) | 🟠 High | Untestable, unswappable |
| Frontend monolithic pages | 🟠 High | Zero code reuse, slow feature development |
| Flat folder structure | 🟡 Medium | Discoverability pain as codebase grows |
| Inconsistent logging | 🟡 Medium | Observability gaps in production |
| No shared hooks/components | 🟡 Medium | Duplication compounds with every new feature |
| Missing validation schemas | 🟡 Medium | Input hygiene gaps per endpoint |

---

# 2. COUPLING & COHESION ANALYSIS

## 2.1 Tight Coupling Areas

### TC-01: orderController ↔ 20+ Dependencies
**File:** `app/controller/orderController.js`
**Fan-out:** Order, Cart, Product, Transaction, StockHistory, Seller, Delivery, Setting, Customer, CheckoutGroup, Payout, OrderOtp models + orderWorkflowService + orderSettlement + orderFinanceService + pricingService + geoUtils + orderQueryService + orderLookup + financeValidation + orderPlacementService + notificationEmitter + orderSocketEmitter + walletService + payoutService + cacheService.

**Why risky:** Any change to any of these 20+ modules can require touching the controller. Impossible to unit test without mocking half the application.

**Safe decoupling strategy:**
1. Extract `OrderReturnService` — owns all return window logic, return request validation, and return status transitions.
2. Extract `OrderQueryService` additions — move `getMyOrders` / `getOrderDetails` query logic out of controller.
3. The controller becomes a thin HTTP adapter: validate request → call domain service → return response.

---

### TC-02: paymentService ↔ PhonePe SDK (Provider Lock-in)
**File:** `app/services/paymentService.js`
**Coupling:** PhonePe SDK imported at module top-level. No abstraction layer.

**Why risky:** Adding any new payment provider requires modifying this file. The stub `verifyClientPaymentCallback` already shows the pain — it's a no-op alias to PhonePe.

**Safe decoupling strategy:**
```
app/services/payment/
  paymentService.js          ← orchestrator (provider-agnostic)
  providers/
    phonepe.adapter.js       ← PhonePe SDK wrapped here only
    razorpay.adapter.js      ← future
  ports/
    paymentProviderPort.js   ← interface: initiate(), verify(), handleWebhook()
```
Wrap PhonePe calls inside `PhonePeAdapter`. `paymentService.js` calls only the port.

---

### TC-03: orderWorkflowService ↔ Bull Queue Infrastructure
**File:** `app/services/orderWorkflowService.js`
**Coupling:** Direct imports of `sellerTimeoutQueue`, `deliveryTimeoutQueue`, `JOB_NAMES`.

**Safe decoupling strategy:**
```
app/services/
  jobScheduler/
    jobSchedulerPort.js      ← interface: schedule(name, payload, delayMs), cancel(jobId)
    bullJobScheduler.js      ← Bull implementation
```
`orderWorkflowService` calls `jobSchedulerPort`, never Bull directly.

---

### TC-04: deliveryController ↔ Redis
**File:** `app/controller/deliveryController.js` line 11
**Coupling:** `getRedisClient()` used directly for throttling logic inside a controller.

**Safe decoupling strategy:** Extract `LocationThrottleService` that wraps Redis internally. Controller calls `locationThrottleService.shouldThrottle(deliveryId, lat, lng)`.

---

### TC-05: Frontend axios ↔ window.location (Auth Logic Duplication)
**Files:** `core/api/axios.js` and `core/context/AuthContext.jsx`
**Coupling:** Both independently derive the current role from `window.location.pathname`.

**Safe decoupling strategy:**
```js
// core/auth/activeRoleStore.js
let _activeRole = 'customer';
export const setActiveRole = (role) => { _activeRole = role; };
export const getActiveRole = () => _activeRole;
```
The router sets the role on mount. Axios reads from `getActiveRole()`. AuthContext reads from the same store. No more `window.location` in either.

---

## 2.2 Weak Cohesion Areas

### WC-01: Return Window Logic Scattered
`computeReturnWindowForOrder()` in `orderController.js` (lines 119–136) and `computeReturnWindowDates()` in `orderFinanceService.js` (lines 117–128) — same business rule in two files with different implementations.

**Fix:** Create `app/domain/return/returnWindowPolicy.js` as single source of truth.

---

### WC-02: services/ Mixes Domain + Infrastructure
At the same directory level: `orderWorkflowService` (domain), `cacheService` (infra), `emailService` (infra), `firebaseService` (infra), `logger` (infra), `metrics` (infra).

**Fix:** Create `app/infrastructure/` for pure infra. Keep `app/services/` for domain services only. Migrate incrementally.

---

### WC-03: Validation Is Mostly Missing
28 controllers, 4 validation files. Most request validation is ad-hoc inline string checks.

**Fix:** Create `app/validation/{domain}/` folders. Build a `validate(schema)` Express middleware factory. Start with highest-risk endpoints (order placement, payment, withdrawal).

---

### WC-04: Frontend Admin Pages Have Zero Component Decomposition
`admin/pages/` has 38 files, all monolithic. No `admin/components/` directory. All sub-components (tables, forms, modals, filters) defined inline inside page files.

**Fix:** Add `admin/components/` and extract incrementally per page refactor sprint.

---

### WC-05: Frontend Delivery Has Duplicate Earnings Files
`delivery/pages/Earnings.jsx` AND `delivery/pages/EarningsPage.jsx` — overlapping earnings display logic in two separate files.

**Fix:** Consolidate into one file and remove the duplicate.

---

*→ Continue to Part 2: Safe Refactor Strategy + Phase-Wise Implementation Roadmap*
