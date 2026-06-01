# Appzeto Quick-Commerce — Professional Refactor & Modernization Plan
## Part 3 of 3: Priority Order + Safe Decoupling + Final Target Architecture

---

# 5. RECOMMENDED REFACTOR ORDER

## 5.1 Priority Matrix

| Priority | Item | ROI | Risk | Effort | Do When |
|---|---|---|---|---|---|
| 🥇 1 | Eliminate duplicated return window logic (P1.1) | High | None | 2h | Now |
| 🥇 2 | Standardize logging in all controllers (P1.3) | High | None | 4h | Now |
| 🥇 3 | Consolidate rateLimiter files (P1.2) | Medium | None | 1h | Now |
| 🥇 4 | Shared `validate()` middleware (P1.5) | High | Low | 4h | Now |
| 🥈 5 | Extract `OrderReturnService` (P2.1) | High | Low | 1d | Week 2 |
| 🥈 6 | Extract `DeliveryEarningsService` (P2.4) | High | Low | 1d | Week 2 |
| 🥈 7 | Extract `LocationThrottleService` (P2.3) | Medium | Low | 4h | Week 2 |
| 🥈 8 | Fix frontend auth role detection (P4.1) | High | Medium | 1d | Week 3 |
| 🥈 9 | Build `useApiState` hook (P4.2) | Very High | None | 4h | Week 3 |
| 🥉 10 | Payment provider abstraction (P3.x) | High | Medium | 1w | Week 4 |
| 🥉 11 | Build shared UI components (P4.3) | High | None | 2w | Week 4-5 |
| 🥉 12 | Decompose ProductManagement.jsx (P4.4) | High | Low | 3d | Week 5 |
| 🥉 13 | Infrastructure folder separation (P2.5) | Medium | Low | 1d | Week 5 |
| ⬜ 14 | Add missing validation schemas (P5.2) | High | Low | 1w | Week 6-7 |
| ⬜ 15 | Domain folder restructure (P5.1) | Medium | Medium | 2w | Week 7-9 |
| ⬜ 16 | Add missing DB indexes (P6.1) | High | Low | 4h | Week 9 |
| ⬜ 17 | Extend cache coverage (P6.2) | Medium | None | 4h | Week 9 |
| ⬜ 18 | Decompose remaining large pages (P4.5-4.7) | High | Low | 3w | Week 10-12 |

---

## 5.2 Architecture Stabilization First Rule

Before adding **any** new features after reading this plan, complete these 4 items from Phase 1:
1. **P1.1** — Eliminate duplicated return window functions (prevents financial calculation drift)
2. **P1.3** — Standardize logging (critical for production observability)
3. **P1.5** — Shared validate() middleware (prevents new controllers from adding more inline validation)
4. **P4.1** — Fix frontend auth role detection (prevents brittle auth breakage on route changes)

These 4 items together take less than 2 days and have near-zero risk. They prevent the existing technical debt from compounding with every new feature.

---

# 6. SAFE DECOUPLING STRATEGY

## 6.1 The Wrapper Pattern (Default for All Extractions)

When extracting a function from a large file into a new service, always follow this 3-step pattern:

**Step 1 — Create the new service (no changes to existing file)**
```js
// app/services/order/orderReturnService.js (NEW)
export async function createReturnRequest(customerId, orderId, payload) {
  // paste logic here
}
```

**Step 2 — Replace inline logic with a call to the new service**
```js
// app/controller/orderController.js (UPDATED)
import { createReturnRequest } from '../services/order/orderReturnService.js';

export const requestReturn = async (req, res) => {
  try {
    const result = await createReturnRequest(req.user.id, req.params.orderId, req.body);
    return handleResponse(res, 200, "Return request submitted", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
```

**Step 3 — Verify with tests, then delete the old inline logic**

The old function stays in place until Step 3. Zero breakage risk during Step 1 and 2.

---

## 6.2 The Re-Export Pattern (For Folder Reorganization)

When moving a file to a new location, never break existing imports:

```js
// Old location: app/services/cacheService.js (KEEP THIS FILE)
// New location: app/infrastructure/cache/cacheService.js

// Old file becomes a re-export shim:
export * from '../infrastructure/cache/cacheService.js';
```

All old imports continue working. New code imports from the new path. Remove the shim only after 100% of old imports are migrated.

---

## 6.3 The Feature Flag Pattern (For Provider Swaps)

For high-risk changes like the payment provider abstraction:

```js
// app/services/payment/providerRegistry.js
import { PhonePeAdapter } from './providers/phonepe.adapter.js';

export function getActivePaymentProvider() {
  const providerName = process.env.PAYMENT_PROVIDER || 'phonepe';
  if (providerName === 'phonepe') return new PhonePeAdapter();
  // future: if (providerName === 'razorpay') return new RazorpayAdapter();
  throw new Error(`Unknown payment provider: ${providerName}`);
}
```

Rollback = set `PAYMENT_PROVIDER=phonepe` in env. No code change needed.

---

## 6.4 How to Isolate Providers Safely

**Payment Provider:**
- All SDK imports live inside `providers/phonepe.adapter.js` only.
- `paymentService.js` never imports the SDK.
- Tests mock `PaymentProviderPort`, never the SDK.

**Firebase Provider:**
- Already wrapped in `firebaseService.js` — good. Move to `infrastructure/firebase/`.
- Notification module calls `firebaseService.send()`, never `firebase-admin` directly.

**SMS Provider:**
- `smsIndiaHubService.js` is already a wrapper — move to `infrastructure/sms/`.
- If switching SMS provider, only the adapter file changes.

**Maps Provider:**
- `mapsGeocodeService.js` and `mapsRouteService.js` wrap Google Maps SDK — already correct pattern.
- Move both to `infrastructure/maps/` in Phase 5.

**Cloudinary Media:**
- `mediaService.js` wraps Cloudinary — already correct pattern.
- Move to `infrastructure/media/` in Phase 5.

---

## 6.5 How to Migrate Old Logic Gradually

**For `orderController.js` (2004 lines):**

Do NOT extract everything at once. Use the "strangler fig" pattern:
1. Extract `OrderReturnService` (return-related handlers) → ~300 lines removed
2. Extract query handlers to `OrderQueryService` → ~200 lines removed
3. Extract `OrderCancellationService` → ~150 lines removed
4. Remaining controller handles placement + workflow delegation

After all extractions, `orderController.js` should be < 400 lines — pure HTTP adapters.

**Timeline:** One extraction per sprint (1–2 weeks each). Never extract two unrelated handlers in the same PR to keep rollback scope narrow.

---

## 6.6 Frontend Progressive Migration

**For monolithic page files (80KB+):**

1. **Do NOT create a new page and delete the old one.** Decompose in place.
2. Extract the most reusable component first (usually the table or form).
3. Import it back into the page file immediately — the page still works.
4. Repeat for the next component.
5. When the page file is < 200 lines, the extraction is complete.

**Example sequence for `ProductManagement.jsx`:**
- Week 1: Extract `ProductListTable.jsx` → import back
- Week 2: Extract `ProductFormModal.jsx` → import back
- Week 3: Extract `ProductFilters.jsx` → import back
- Week 4: Page shell is now ~150 lines. Extraction complete.

---

# 7. FINAL TARGET ARCHITECTURE

## 7.1 Backend — Target Folder Structure

```
backend/
  index.js                          ← process role bootstrap (already good)
  app/
    core/                           ← startup, shutdown, processRole (already good)
    domains/                        ← NEW: domain-organized business logic
      order/
        order.controller.js         ← thin HTTP adapter (~300 lines max)
        order.service.js            ← placement, query orchestration
        order.validation.js         ← Joi schemas for all order endpoints
        order.routes.js             ← route definitions
        return/
          return.service.js
          return.validation.js
      delivery/
        delivery.controller.js
        delivery.routes.js
        delivery.validation.js
        earnings/
          earnings.service.js
        location/
          locationThrottle.service.js
      payment/
        payment.controller.js
        payment.service.js          ← provider-agnostic orchestrator
        payment.validation.js
        ports/
          paymentProviderPort.js
        providers/
          phonepe.adapter.js
          razorpay.adapter.js       ← future, not yet implemented
        providerRegistry.js
      finance/
        (move from services/finance/ — already well-structured)
        ledger.service.js
        wallet.service.js
        payout.service.js
        pricing.service.js
        audit.service.js
        financeSettings.service.js
      product/
        product.controller.js
        product.service.js
        product.validation.js
        product.routes.js
      seller/
        seller.controller.js
        seller.service.js
        seller.validation.js
        seller.routes.js
      customer/
        customer.controller.js
        customer.service.js
        customer.validation.js
      admin/
        admin.controller.js
        finance/
          adminFinance.controller.js
      notification/
        (move from modules/notifications/)
        notification.controller.js
        notification.service.js
        notification.queue.js
        notification.worker.js
        notification.builder.js
        notification.model.js
        notification.routes.js
      otp/
        (move from modules/otp/)
    infrastructure/                 ← NEW: pure infra services
      cache/
        cacheService.js
      email/
        emailService.js
      firebase/
        firebaseService.js
      maps/
        geocodeService.js
        routeService.js
      media/
        mediaService.js
      sms/
        smsService.js
      search/
        searchService.js
        searchSyncService.js
    middleware/                     ← (keep, consolidate rateLimiters)
      authMiddleware.js
      errorMiddleware.js
      rateLimiters.js               ← merged from rateLimiter.js + rateLimiters.js
      requestLogger.js
      metricsMiddleware.js
      securityMiddlewares.js
      uploadMiddleware.js
      validate.js                   ← NEW: shared Joi validation middleware
      requestContext.js
    models/                         ← (keep flat for now — Mongoose models)
    constants/                      ← (keep — already clean)
    utils/                          ← (keep + add)
      returnWindow.js               ← NEW: single source of return window logic
      money.js
      geoUtils.js
      pagination.js
      orderLookup.js
      helper.js
      slugify.js
      phone.js
      otp.js
      smsHelpers.js
    queues/                         ← (keep — Bull queue definitions)
    jobs/                           ← (keep — scheduled job handlers)
    config/                         ← (keep — DB, Redis config)
    routes/
      index.js                      ← top-level router (keep, simplified)
    socket/                         ← (keep — Socket.IO manager)
```

---

## 7.2 Frontend — Target Folder Structure

```
frontend/src/
  core/                             ← cross-cutting concerns
    api/
      axios.js                      ← cleaned up, reads from activeRoleStore
      dedupe.js                     ← (keep)
      resolveApiBaseUrl.js          ← (keep)
    auth/
      activeRoleStore.js            ← NEW: role store singleton
    context/
      AuthContext.jsx               ← cleaned up, reads from activeRoleStore
      SettingsContext.jsx
      SupportUnreadContext.jsx
    guards/
      ProtectedRoute.jsx
      RoleGuard.jsx
    hooks/                          ← EXPANDED
      useApiState.js                ← NEW
      usePagination.js              ← NEW
      useDebounce.js                ← NEW
      useConfirmDialog.js           ← NEW
      useFilters.js                 ← NEW
      useToast.js                   ← NEW
      useInViewAnimation.js         ← (keep)
    firebase/
      pushClient.js                 ← (keep)
    services/
      orderSocket.js
      socket.js
      trackingClient.js
      googleMapsLoader.js
    routes/                         ← (keep)
    constants/                      ← (keep)
    utils/                          ← (keep)

  shared/                           ← truly cross-module reusables
    components/
      ui/                           ← EXPANDED
        DataTable.jsx               ← NEW
        FilterBar.jsx               ← NEW
        Modal.jsx                   ← NEW
        ConfirmDialog.jsx           ← NEW
        StatusBadge.jsx             ← NEW
        Pagination.jsx              ← NEW
        FormField.jsx               ← NEW
        LoadingSpinner.jsx          ← NEW
        EmptyState.jsx              ← (keep)
        LazyImage.jsx               ← (keep)
        MapPicker.jsx               ← (keep)
        ErrorBoundary.jsx           ← (keep)
        RootErrorBoundary.jsx       ← (keep)
        IconSelector.jsx            ← (keep)
    layout/                         ← (keep)
    constants/                      ← (keep)
    utils/                          ← (keep)

  modules/
    admin/
      pages/                        ← DECOMPOSED (< 300 lines each)
        ProductManagement.jsx
        OrdersList.jsx
        ...
      components/                   ← NEW: admin-scoped components
        products/
          ProductListTable.jsx
          ProductFormModal.jsx
          ProductFilters.jsx
          ProductImageUpload.jsx
        orders/
          AdminOrdersTable.jsx
          AdminOrderFilters.jsx
        sellers/
          SellerTable.jsx
          SellerVerificationCard.jsx
        finance/
          WithdrawalCard.jsx
          WalletSummary.jsx
      services/                     ← SPLIT
        orders.api.js
        sellers.api.js
        products.api.js
        finance.api.js
        delivery.api.js
        settings.api.js
        index.js                    ← re-exports all for backward compat
      routes/
    customer/
      pages/                        ← DECOMPOSED
      components/                   ← (keep, expand)
        checkout/                   ← extract from CheckoutPage.jsx (43KB)
          AddressStep.jsx
          PaymentStep.jsx
          OrderSummary.jsx
          CouponInput.jsx
      services/
      context/
      hooks/                        ← NEW: customer-specific hooks
        useCart.js
        useCheckout.js
        useOrders.js
      routes/
    seller/
      pages/                        ← DECOMPOSED
      components/                   ← NEW (currently missing)
        orders/
          SellerOrdersTable.jsx
          OrderStatusTimeline.jsx
          ReturnRequestModal.jsx
        products/
          SellerProductList.jsx
      services/
      context/
      routes/
    delivery/
      pages/                        ← DECOMPOSED (merge Earnings.jsx + EarningsPage.jsx)
      components/                   ← NEW
        orders/
          DeliveryOrderCard.jsx
          OtpVerifyModal.jsx
        earnings/
          EarningsChart.jsx
          EarningsSummary.jsx
        cod/
          CodCashSummary.jsx
      layout/                       ← (keep)
      services/
      utils/                        ← (keep)
      routes/

  pages/                            ← CLARIFY OWNERSHIP
    NotFound.jsx                    ← (keep as global fallback)
    Login.jsx                       ← deprecate in favor of module auth pages
    Signup.jsx                      ← deprecate in favor of CustomerAuth.jsx
```

---

## 7.3 Shared Systems — Target Contracts

### Backend Domain Contracts

Every domain service exposes a clean contract:

```js
// Domain service pattern
class OrderReturnService {
  static async createReturnRequest(customerId, orderId, payload) { ... }
  static async getReturnDetails(orderId, userId, role) { ... }
  static async approveReturn(orderId, actorId) { ... }
  static async rejectReturn(orderId, actorId, reason) { ... }
}
```

Every controller is a pure HTTP adapter:
```js
export const requestReturn = async (req, res) => {
  try {
    const result = await OrderReturnService.createReturnRequest(...);
    return handleResponse(res, 200, "...", result);
  } catch (e) {
    return handleResponse(res, e.statusCode || 500, e.message);
  }
};
```

### Frontend API Layer Contract

Every API module follows the same shape:
```js
// modules/admin/services/orders.api.js
export const getAdminOrders = (params) => axiosInstance.get('/admin/orders', { params });
export const updateOrderStatus = (orderId, status) => axiosInstance.patch(`/admin/orders/${orderId}/status`, { status });
```

Every page uses hooks, never raw axios:
```js
// In the page component:
const { data, loading, error, refetch } = useApiState(
  () => getAdminOrders(filters),
  [filters]
);
```

---

## 7.4 Key Architecture Principles for Final State

| Principle | Backend Implementation | Frontend Implementation |
|---|---|---|
| **Low Coupling** | Controllers import only domain services. Domain services import only ports/interfaces. Infra is isolated in `infrastructure/`. | Pages import only hooks. Hooks import only API services. API services import only axiosInstance. |
| **High Cohesion** | Each domain folder owns its controller, service, validation, and routes. | Each module folder owns its pages, components, services, and hooks. |
| **Provider Replacement** | Payment, SMS, Maps, Firebase all behind adapter classes. Swap by changing `providerRegistry` only. | Auth token storage behind `activeRoleStore`. API base URL behind `resolveApiBaseUrl`. |
| **Testability** | Services can be unit-tested by mocking ports. Controllers tested via supertest. | Hooks tested with `renderHook`. Components tested with mocked API responses. |
| **Backward Compatibility** | Re-export shims at old paths during migration. Old API endpoints never removed. | Old component imports kept via index.js re-exports during migration. |

---

## 7.5 What This Architecture Supports

| Capability | Supported After Refactor |
|---|---|
| Add a new payment provider | Create new adapter in `providers/`, register in `providerRegistry.js` |
| Add a new delivery provider | Create adapter in `infrastructure/delivery/`, implement port |
| Add a new portal (e.g. warehouse manager) | Add `modules/warehouse/` on frontend, new domain in backend |
| Scale order processing horizontally | Worker role already separated — add more worker instances |
| Replace SMS provider | Swap `infrastructure/sms/smsService.js` implementation only |
| Add new notification channel | Add handler in `notification.builder.js` — no other files change |
| Add new scheduled job | Add to `app/jobs/`, register in `startScheduler()` in `index.js` |
| Onboard a new developer | Domain folder structure is self-documenting. Each domain is a closed unit. |
| Write unit tests for order logic | `OrderReturnService` has no HTTP dependencies — pure testable JS |
| Feature-flag a new workflow | `process.env.FEATURE_*` guard in the service layer |

---

## 7.6 Summary: Metrics Before vs After

| Metric | Current | Target After All Phases |
|---|---|---|
| Largest controller file | 2,004 lines | < 400 lines |
| Largest frontend page file | 80,952 bytes | < 20 KB |
| Shared hooks | 1 | 8+ |
| Shared UI components | 9 | 20+ |
| Payment providers supported | 1 (hardwired) | N (adapter pattern) |
| Validation schemas | 4/28 controllers | 28/28 controllers |
| Duplicated business logic instances | 4+ known | 0 |
| Infrastructure imports in controllers | 2 (Redis direct) | 0 |
| Domain-isolated service count | 8 (partial) | 20+ (full) |
| Admin API surface | 1 file (9KB) | 6 domain-split files |

---

## 7.7 Final Principles Reminder

**This refactor is done when:**

1. ✅ No controller imports Redis, Bull, or any provider SDK directly
2. ✅ No business rule exists in two places
3. ✅ Every payment provider is behind an adapter
4. ✅ Every controller is < 400 lines and only delegates to services
5. ✅ Every frontend page is < 300 lines and only composes components
6. ✅ Every repeated UI pattern has a shared component
7. ✅ All server-state fetching goes through typed hooks, not raw useEffect
8. ✅ New developers can find any feature by looking in the domain folder

**This refactor is NOT done when it becomes:**
- Microservices (it shouldn't — stay monolith)
- Over-abstracted (don't add ports where there is only one possible implementation)
- A rewrite (every step preserves existing behavior)

---

*End of Plan — 3 Parts Total*
*Part 1: Architecture Assessment + Coupling/Cohesion Analysis*
*Part 2: Safe Refactor Strategy + Phase-Wise Implementation Roadmap*
*Part 3: Priority Order + Safe Decoupling + Final Target Architecture*
