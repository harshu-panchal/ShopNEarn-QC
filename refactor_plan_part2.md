# Appzeto Quick-Commerce — Professional Refactor & Modernization Plan
## Part 2 of 3: Safe Refactor Strategy + Phase-Wise Implementation Roadmap

---

# 3. SAFE REFACTOR STRATEGY

## 3.1 Core Migration Philosophy

> **"Wrap and progressively improve, not rewrite."**

Every change must satisfy three rules:
1. **Zero API breakage** — all existing HTTP endpoints and response shapes are preserved.
2. **Independently deployable** — each phase can be deployed alone without requiring other phases to be complete.
3. **Rollbackable in < 5 minutes** — every change is reversible by reverting a single file or toggling an environment variable.

---

## 3.2 Compatibility Strategy

| Principle | Implementation |
|---|---|
| Keep existing exports | New files re-export from old ones during transition |
| Wrap, don't rename | Old functions become thin wrappers calling new implementations |
| Feature flags for risky changes | `process.env.FEATURE_NEW_PAYMENT_ADAPTER` guards new paths |
| Dual-run pattern for critical flows | Run old + new in parallel, compare outputs, switch on confidence |
| Schema-backward-compatible changes | New fields are optional; never remove/rename existing fields first |

---

## 3.3 Rollout Strategy

```
Code Review → Staging Deploy → Smoke Test → 5% Canary → 
Monitor 24h → 50% Canary → Monitor 12h → 100% → Remove old code
```

For pure internal refactors (no API changes): skip canary, direct staging → production with monitoring.

---

## 3.4 Rollback Strategy (Per Phase)

- **Backend service extractions:** The old service file is kept intact alongside the new one. Revert by switching the import in the controller back to the old file. No DB migrations involved.
- **Frontend component decompositions:** Old page file is kept with a `.bak.jsx` rename or Git branch. Revert the route import.
- **Provider adapters (payment):** Feature flag in `.env` routes to old or new implementation. Flip the flag to roll back instantly.
- **Folder restructures:** Use re-export index files so all existing imports continue to work during migration.

---

# 4. PHASE-WISE IMPLEMENTATION ROADMAP

> **Total phases: 6** | **Estimated total calendar time: 14–20 weeks** | Each phase is independent

---

## PHASE 1 — Foundation Stabilization
### "Fix the inconsistencies that create daily pain, zero risk"

**Objective:** Remove duplication, fix logging, consolidate middleware, fix route anomalies. Pure cleanup with no behavior change.

**Estimated effort:** 1–2 weeks | **Risk Level:** 🟢 Low | **Deployment Safety:** 🟢 Safe to deploy any time

---

### P1.1 — Eliminate Duplicated Business Logic

**Affected files:**
- `app/controller/orderController.js`
- `app/services/finance/orderFinanceService.js`

**Implementation:**
```
app/utils/returnWindow.js   ← NEW
  getReturnEligibilityDelayMinutes()
  getReturnWindowMinutes()
  computeReturnWindow(deliveredAt)
  parsePositiveInt(value, fallback)
```
- Remove the 4 duplicated functions from both files.
- Both files import from `returnWindow.js`.

**Testing:** Run all existing order and finance tests. Verify return-eligible-at and return-window-expires-at timestamps remain identical in API responses.

**Rollback:** Git revert. Zero DB impact.

---

### P1.2 — Consolidate Duplicate Middleware

**Affected files:**
- `app/middleware/rateLimiter.js`
- `app/middleware/rateLimiters.js`

**Implementation:**
- Audit both files for unique configurations.
- Merge all limiters into `rateLimiters.js` (the more comprehensive one).
- Delete `rateLimiter.js` after updating all imports.

**Testing:** Smoke test all rate-limited endpoints. Verify 429 responses appear at correct thresholds.

---

### P1.3 — Standardize Logging

**Affected files:** `orderController.js`, `deliveryController.js`, `productController.js`, `paymentService.js`, `orderWorkflowService.js`

**Implementation:**
- Replace all `console.error(...)`, `console.warn(...)`, `console.log(...)` with `logger.error(...)`, `logger.warn(...)`, `logger.info(...)`.
- Import `logger` from `../services/logger.js` in each file.

**Note:** `paymentService.js` has a `console.log(JSON.stringify({level:'info'...}))` pattern — replace with `logger.info('event', {correlationId, ...fields})`.

**Testing:** Check structured logs appear correctly in dev. No functional behavior changes.

---

### P1.4 — Fix Route Mounting Anomalies

**Affected file:** `app/routes/index.js`

**Implementation:**
```js
// BEFORE (lines 37 and 41 - same handler mounted twice):
router.use("/admin/categories", categoryRoute);
router.use("/categories", categoryRoute);

// AFTER - keep both mounts but document the intent:
// /categories    → public category browsing
// /admin/categories → admin category management (same router, auth enforced inside)
// Add a comment to make intent explicit. No functional change needed.
```
- Mount `experienceRoute`, `offerRoute`, `couponRoute` under explicit prefixes instead of `/`:
```js
router.use("/experience", experienceRoute);
router.use("/offers", offerRoute);
router.use("/coupons", couponRoute);
```
**Risk:** Frontend API URLs calling `/offers`, `/experience`, `/coupons` must be updated. Audit `frontend/src` for these call patterns first. Add backward-compat aliases during transition.

---

### P1.5 — Shared Validation Helper

**New file:** `app/middleware/validate.js`
```js
export function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, stripUnknown: true
    });
    if (error) {
      return res.status(400).json({
        success: false, error: true,
        message: error.details.map(d => d.message).join('; ')
      });
    }
    req.body = value;
    next();
  };
}
```
- Remove the inline `validateWithJoi()` from `orderController.js`.
- Use `validate(schema)` as route middleware going forward.

**Testing:** Unit test the middleware. Verify 400 responses still return the same structure.

---

**Phase 1 Coupling Improvement:** Removes 4 duplicated functions. Standardizes 5 cross-cutting concerns.
**Phase 1 Cohesion Improvement:** Each utility now has a single home.

---

## PHASE 2 — Backend Domain Service Extractions
### "Shrink the God Controllers by extracting domain services"

**Objective:** Break `orderController.js` and `deliveryController.js` into focused domain services. Controllers become thin HTTP adapters.

**Estimated effort:** 3–4 weeks | **Risk Level:** 🟡 Medium | **Deployment Safety:** 🟡 Deploy with smoke tests

---

### P2.1 — Extract OrderReturnService

**New file:** `app/services/order/orderReturnService.js`

**Move from `orderController.js`:**
- `requestReturn()` handler logic → `OrderReturnService.createReturnRequest(customerId, orderId, payload)`
- `getReturnDetails()` handler logic → `OrderReturnService.getReturnDetails(orderId, userId, role)`
- `approveReturn()` logic → `OrderReturnService.approveReturn(orderId, adminId)`
- `rejectReturn()` logic → `OrderReturnService.rejectReturn(orderId, adminId, reason)`

**Controller after extraction:**
```js
export const requestReturn = async (req, res) => {
  try {
    const result = await OrderReturnService.createReturnRequest(
      req.user.id, req.params.orderId, req.body
    );
    return handleResponse(res, 200, "Return request submitted", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
```

**Rollback:** Revert the controller to call the old inline logic. Service extraction does not change the DB schema.

---

### P2.2 — Extract OrderQueryService Additions

**Existing file:** `app/services/orderQueryService.js` (already exists — 9KB, good foundation)

**Move from `orderController.js`:**
- `getMyOrders()` DB query logic → `OrderQueryService.getCustomerOrders(customerId, pagination)`
- `getOrderDetails()` DB query + ACL check → `OrderQueryService.getOrderWithAccess(orderId, userId, role)`
- `getSellerReturns()` → `OrderQueryService.getSellerReturns(sellerId, filters, pagination)`

**Why:** `orderQueryService.js` already exists and has `fetchAvailableOrdersForDelivery` and `fetchSellerOrdersPage`. Extend it consistently rather than leaving query logic in the controller.

---

### P2.3 — Extract LocationThrottleService

**New file:** `app/services/delivery/locationThrottleService.js`

**Move from `deliveryController.js`:**
```js
// deliveryController.js currently:
import { getRedisClient } from "../config/redis.js"; // infra in controller!
async function throttleLocationUpdate(deliveryId, lat, lng) { ... }

// After:
// app/services/delivery/locationThrottleService.js
export async function shouldThrottle(deliveryId, lat, lng) { ... }

// deliveryController.js:
import { shouldThrottle } from '../services/delivery/locationThrottleService.js';
// No more Redis import in controller
```

---

### P2.4 — Extract DeliveryEarningsService

**New file:** `app/services/delivery/deliveryEarningsService.js`

**Move from `deliveryController.js`:**
- `getDeliveryStats()` aggregation logic
- `getDeliveryEarnings()` transaction aggregation + chart data
- `getDeliveryCodCashSummary()` logic

**Why:** Earnings computation involves DB aggregations that belong in a service, not a controller. This also enables the admin cash-collection page to reuse the same service.

---

### P2.5 — Introduce Infrastructure Separation

**New directory:** `app/infrastructure/`

**Migrate (rename/move, keep re-exports):**
```
app/infrastructure/
  cache/      ← from app/services/cacheService.js
  email/      ← from app/services/emailService.js
  firebase/   ← from app/services/firebaseService.js
  maps/       ← from app/services/mapsGeocodeService.js + mapsRouteService.js
  media/      ← from app/services/mediaService.js
  sms/        ← from app/services/smsIndiaHubService.js
  search/     ← from app/services/search/ (already a directory)
```

**Migration pattern:** Move file → create re-export at old path → update imports progressively:
```js
// app/services/cacheService.js (kept as shim):
export * from '../infrastructure/cache/cacheService.js';
```
Old imports keep working. New code imports from `infrastructure/`. Remove shims after full migration in Phase 5.

**Coupling improvement:** Domain services no longer live at the same level as infrastructure.

---

### P2.6 — Extract WorkflowJobScheduler Port

**New file:** `app/services/workflow/jobSchedulerPort.js`
```js
export async function scheduleJob(name, payload, delayMs, jobId) { ... }
export async function cancelJob(jobId) { ... }
```

**New file:** `app/services/workflow/bullJobScheduler.js` — wraps Bull queue calls.

**Update:** `orderWorkflowService.js` removes direct Bull imports and calls `jobSchedulerPort` instead.

**Testing:** Integration test seller-accept and delivery-timeout flows. Verify jobs still fire with correct delays.

---

**Phase 2 Coupling Improvements:** Removes Redis/Bull imports from controllers and domain services. orderController fan-out reduced from 20+ to ~10 dependencies.
**Phase 2 Cohesion Improvements:** Return logic, query logic, earnings logic, and location logic each have a dedicated home.

---

## PHASE 3 — Payment Provider Abstraction
### "Make the payment layer provider-agnostic"

**Objective:** Wrap PhonePe behind an adapter so any future payment provider can be added without touching domain logic.

**Estimated effort:** 1–2 weeks | **Risk Level:** 🟡 Medium | **Deployment Safety:** 🟡 Feature-flagged

---

### P3.1 — Define Payment Provider Port

**New file:** `app/services/payment/ports/paymentProviderPort.js`
```js
/**
 * Payment Provider Contract
 * All payment adapters must implement these methods.
 */
export class PaymentProviderPort {
  async initiatePayment({ merchantOrderId, amountPaise, redirectUrl }) {}
  async getPaymentStatus({ merchantOrderId }) {}
  async validateWebhook({ rawBody, authorization }) {}
  async decodeWebhookPayload({ rawBody }) {}
}
```

---

### P3.2 — Create PhonePe Adapter

**New file:** `app/services/payment/providers/phonepe.adapter.js`

Move all PhonePe-specific code here:
- `getPhonePeClient()` singleton
- `client.pay(request)` call
- `client.getOrderStatus()` call
- `client.validateCallback()` call
- `mapPhonePeStatusToInternal()` mapping
- Base64 decode logic

---

### P3.3 — Refactor paymentService as Orchestrator

**Updated file:** `app/services/payment/paymentService.js`

```js
import { getActivePaymentProvider } from './providerRegistry.js';

export async function createPaymentOrderForOrderRef({ orderRef, userId, ... }) {
  const provider = getActivePaymentProvider();
  const { redirectUrl } = await provider.initiatePayment({ ... });
  // rest of logic is provider-agnostic
}
```

**New file:** `app/services/payment/providerRegistry.js`
```js
import { PhonePeAdapter } from './providers/phonepe.adapter.js';
let _provider = null;
export function getActivePaymentProvider() {
  if (!_provider) _provider = new PhonePeAdapter();
  return _provider;
}
```

**Feature flag:** `process.env.PAYMENT_PROVIDER=phonepe` (default). Future: `razorpay`, `stripe`.

**Rollback:** Set `PAYMENT_PROVIDER` to previous value. No DB changes.

**Testing:**
- Mock `PaymentProviderPort` in unit tests — test orchestration logic independently.
- Integration test: real PhonePe sandbox flow, verify payment creation and webhook processing still work end-to-end.

---

## PHASE 4 — Frontend Architecture Improvement
### "Decompose monolithic pages, build shared component library"

**Objective:** Break monolithic page files into composable components, build shared hooks, and introduce consistent API layer.

**Estimated effort:** 4–5 weeks | **Risk Level:** 🟡 Medium | **Deployment Safety:** 🟢 Safe (pure UI refactor)

---

### P4.1 — Fix Auth Role Detection

**Affected files:** `core/api/axios.js`, `core/context/AuthContext.jsx`

**New file:** `core/auth/activeRoleStore.js`
```js
let _activeRole = 'customer';
export const setActiveRole = (role) => { _activeRole = role; };
export const getActiveRole = () => _activeRole;
```

**Router integration:** Each module's top-level route component calls `setActiveRole('admin')` etc. on mount.

**Update `axios.js`:** Replace `window.location.pathname` checks with `getActiveRole()`.
**Update `AuthContext.jsx`:** Replace `getCurrentRoleFromUrl()` with `getActiveRole()`.

**Testing:** Login as each role, verify correct token is attached to API calls. Verify logout clears correct token.

---

### P4.2 — Build Shared Hook Library

**New directory:** `core/hooks/`

**Priority hooks to create:**
```
useApiState(fetchFn, deps)     ← replaces useState+useEffect+axios in every page
usePagination(defaultLimit)    ← shared pagination state
useDebounce(value, delay)      ← search input debouncing
useConfirmDialog()             ← delete/action confirmation
useFilters(defaultFilters)     ← filter state + reset
useToast()                     ← consistent toast notifications
```

**`useApiState` example (highest ROI):**
```js
export function useApiState(fetchFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refetch = useCallback(async () => {
    setLoading(true);
    try { setData(await fetchFn()); setError(null); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, deps);
  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}
```

**Impact:** Eliminates ~80% of boilerplate in every page file.

---

### P4.3 — Build Shared UI Component Library

**Target directory:** `shared/components/ui/`

**Components to create (priority order):**
| Component | Replaces |
|---|---|
| `DataTable` | Inline table markup in 15+ page files |
| `FilterBar` | Inline filter state in every list page |
| `Modal` | Inline modal state in 20+ page files |
| `ConfirmDialog` | Inline delete confirmation patterns |
| `StatusBadge` | Inline status chip with color logic |
| `Pagination` | Inline page/limit controls |
| `FormField` | Inline label+input+error patterns |
| `EmptyState` | Already exists — standardize props |
| `LoadingSpinner` | Inline spinner in every page |

**Approach:** Extract from the largest page files first. `ProductManagement.jsx` alone will yield 5+ reusable components.

---

### P4.4 — Decompose Admin ProductManagement Page

**Target file:** `admin/pages/ProductManagement.jsx` (80 KB → target < 15 KB for the page shell)

**Extract to `admin/components/products/`:**
```
ProductListTable.jsx      ← product grid/table
ProductFilters.jsx        ← category, search, status filters
ProductFormModal.jsx      ← add/edit product form
ProductImageUpload.jsx    ← image upload component
ProductBulkActions.jsx    ← bulk approve/reject
ProductModerationCard.jsx ← moderation review UI
```

**Page shell becomes:**
```jsx
export default function ProductManagement() {
  const { data, loading, refetch } = useApiState(fetchProducts, [filters]);
  return (
    <>
      <ProductFilters filters={filters} onChange={setFilters} />
      <ProductListTable data={data} onEdit={...} onDelete={...} />
    </>
  );
}
```

---

### P4.5 — Split Admin API Service

**Current:** `admin/services/adminApi.js` (9 KB, everything in one file)

**Split into:**
```
admin/services/
  orders.api.js       ← order list, detail, status update
  sellers.api.js      ← seller management, verification
  products.api.js     ← product CRUD, moderation
  finance.api.js      ← wallet, withdrawals, payouts
  delivery.api.js     ← fleet, assignments, cash collection
  settings.api.js     ← platform settings, fees
```

**Migration:** Export all from an `admin/services/index.js` to keep existing imports working:
```js
export * from './orders.api.js';
export * from './sellers.api.js';
// etc.
```

---

### P4.6 — Decompose Seller Orders Page

**Target:** `seller/pages/Orders.jsx` (64 KB → target < 20 KB)

**Extract to `seller/components/orders/`:**
```
OrdersTable.jsx
OrderFilters.jsx
OrderStatusTimeline.jsx
ReturnRequestModal.jsx
OrderActionButtons.jsx
```

---

### P4.7 — Add seller/components Directory

**Current state:** Seller module has NO `components/` directory.
**Add:** `seller/components/` with shared seller-scoped components extracted from page files.

---

## PHASE 5 — Backend Domain Modularization
### "Reorganize by domain, not by layer"

**Objective:** Progressive migration toward domain-organized folders. Each domain gets its own controller, service, model, validation, and routes co-located.

**Estimated effort:** 3–4 weeks | **Risk Level:** 🟡 Medium (use re-exports to avoid breaking changes)

---

### P5.1 — Create Domain Folder Structure (with re-exports)

**Target structure:**
```
app/domains/
  order/
    order.controller.js       ← thin HTTP adapter
    order.service.js          ← placement, query orchestration
    order.validation.js       ← Joi schemas
    order.routes.js           ← route definitions
    return/
      return.service.js       ← from Phase 2
      return.validation.js
  delivery/
    delivery.controller.js
    earnings.service.js       ← from Phase 2
    locationThrottle.service.js ← from Phase 2
    delivery.validation.js
  payment/
    payment.service.js        ← provider-agnostic orchestrator
    providers/                ← from Phase 3
  finance/
    (already well-structured — move from services/finance/)
  product/
    product.controller.js
    product.service.js
    product.validation.js
  seller/
    seller.controller.js
    seller.service.js
  customer/
    customer.controller.js
    customer.service.js
  notification/
    (already in modules/ — move to domains/)
  otp/
    (already in modules/ — move to domains/)
```

**Migration pattern:** Move file → add re-export at old path → update new code to use domain path → remove old shim after full migration.

---

### P5.2 — Add Missing Validation Schemas

**Priority order (highest-risk endpoints first):**
1. `order/order.validation.js` — place order, cancel order, return request
2. `delivery/delivery.validation.js` — accept order, location update, OTP generation
3. `payment/payment.validation.js` — initiate payment, verify payment (already has some in `paymentValidation.js`)
4. `product/product.validation.js` — create product, update product
5. `seller/seller.validation.js` — auth, profile update, withdrawal

---

### P5.3 — Add Domain Index Files for Clean Imports

```js
// app/domains/order/index.js
export { placeOrder, getMyOrders, getOrderDetails, cancelOrder } from './order.controller.js';
export { OrderQueryService } from './order.service.js';
```

---

## PHASE 6 — Performance & Observability Hardening
### "Safe performance improvements using already-available infrastructure"

**Objective:** Add indexing, improve caching, add DB query guards, and improve observability. Zero functional changes.

**Estimated effort:** 1–2 weeks | **Risk Level:** 🟢 Low

---

### P6.1 — Audit and Add Missing DB Indexes

**`databaseIndexManager.js` already exists** — extend it with:

| Collection | Missing Index |
|---|---|
| `orders` | `{ customer: 1, createdAt: -1 }` composite |
| `orders` | `{ seller: 1, workflowStatus: 1 }` |
| `orders` | `{ deliveryBoy: 1, status: 1 }` |
| `transactions` | `{ user: 1, userModel: 1, createdAt: -1 }` composite |
| `transactions` | `{ user: 1, type: 1, status: 1 }` |
| `ledgerEntries` | `{ orderId: 1, actorType: 1 }` |

**Note:** `databaseIndexManager.js` already has infrastructure for this — just add the missing definitions.

---

### P6.2 — Extend Cache Coverage

**Currently cached:** orders, categories, settings, delivery rules, product lists, homepage, dashboard.

**Add caching to:**
- `getDeliveryStats()` — TTL 60s (currently hits DB every request)
- `getSellerStats()` — TTL 120s
- `getDeliveryEarnings()` — TTL 30s (short, real-time feel)

Use the existing `cacheService.getOrSet()` pattern — no new infrastructure needed.

---

### P6.3 — Add Structured Request Tracing to orderController

`correlationIdMiddleware` already exists and adds `req.correlationId`. Ensure all `logger.error()` calls in `orderController` and `paymentService` include `correlationId` in the log context.

---

### P6.4 — Add N+1 Query Guards

**Risk area:** `deliveryController.getDeliveryEarnings()` fetches up to 200 transactions and then for each, accesses `t?.order?.pricing` — this is a populated field, so it may cause N+1 if not checked.

**Fix:** Verify `.populate("order", "orderId pricing paymentBreakdown")` is using a projection to avoid pulling full order documents. Confirm this is already in place (line 106 of `deliveryController.js` — it is, but validate the projection is narrow enough).

---

*→ Continue to Part 3: Refactor Priority Order + Safe Decoupling Guide + Final Target Architecture*
