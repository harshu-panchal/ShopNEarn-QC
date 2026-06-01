---
name: route-mounting-hygiene
description: Keep the top-level Express route registration clean - one canonical mount per domain, no router mounted at / root, no silent duplicate mounts, explicit prefixes, and documented backward-compat aliases when needed. Use when routes/index.js has the same router mounted at multiple paths, when domain routes pollute the root namespace, or when the user asks to "clean up routes", "fix route mounting", or "audit route registration".
---

# Route Mounting Hygiene

## Purpose

Make the top-level route registration file (`routes/index.js`) readable, unambiguous, and auditable. One canonical mount per domain. No duplicate registrations. No root-namespace pollution. Backward-compatible aliases documented explicitly.

## When To Use

- `routes/index.js` mounts the same router at multiple paths without comments
- Domain routers are mounted at `/` root (polluting the global namespace)
- A URL accidentally hits two handlers depending on registration order
- The user asks to "clean routes", "audit route mounting", "fix duplicate routes"

## The Canonical Shape

```js
// app/routes/index.js
import { Router } from 'express';

import orderRoutes        from '../domains/order/order.routes.js';
import paymentRoutes      from '../domains/payment/payment.routes.js';
import deliveryRoutes     from '../domains/delivery/delivery.routes.js';
import productRoutes      from '../domains/product/product.routes.js';
import categoryRoutes     from '../domains/category/category.routes.js';
import sellerRoutes       from '../domains/seller/seller.routes.js';
import customerRoutes     from '../domains/customer/customer.routes.js';
import adminRoutes        from '../domains/admin/admin.routes.js';
import notificationRoutes from '../domains/notification/notification.routes.js';
import offerRoutes        from '../domains/offer/offer.routes.js';
import couponRoutes       from '../domains/coupon/coupon.routes.js';
import experienceRoutes   from '../domains/experience/experience.routes.js';

const router = Router();

// === Public + customer-facing ===
router.use('/orders',        orderRoutes);
router.use('/payments',      paymentRoutes);
router.use('/products',      productRoutes);
router.use('/categories',    categoryRoutes);
router.use('/offers',        offerRoutes);
router.use('/coupons',       couponRoutes);
router.use('/experience',    experienceRoutes);
router.use('/customers',     customerRoutes);

// === Role-scoped ===
router.use('/delivery',      deliveryRoutes);
router.use('/sellers',       sellerRoutes);
router.use('/admin',         adminRoutes);

// === Cross-cutting ===
router.use('/notifications', notificationRoutes);

export default router;
```

## The Five Rules

1. **One mount per domain.** Each domain router appears exactly once.
2. **No router mounted at `/` root.** Every mount has an explicit prefix.
3. **No duplicate mounts of the same router under different paths** (unless explicitly documented as an alias — see below).
4. **Group mounts by access pattern** (public, role-scoped, cross-cutting) with section comments.
5. **Mount order doesn't matter for correctness.** If reordering changes routing, there is a conflict that must be resolved.

## Backward-Compatible Aliases

When a URL must be reachable from two paths (e.g., legacy frontend still calls `/category/list` while new code uses `/categories/list`), document the alias explicitly:

```js
// Legacy alias kept for the mobile app v < 4.2 (remove after 2026-09-30)
router.use('/category',   categoryRoutes); // alias of /categories

// Canonical mount
router.use('/categories', categoryRoutes);
```

Both mounts route to the same handlers. The comment names the reason and the planned removal date.

## Anti-Pattern: Silent Dual Mount

```js
// ❌ BAD — same router, two paths, no explanation
router.use('/admin/categories', categoryRoute);
router.use('/categories',       categoryRoute);
```

The reader cannot tell whether:
- This is intentional (one mount for admin, one for public, auth differentiated inside)
- One was forgotten when the other was added
- Removing one breaks production

Fix by **documenting intent**:

```js
// /categories         → public category browsing (auth optional)
// /admin/categories   → admin category management (auth enforced inside router)
// Same router; the handlers branch on req.user role.
router.use('/categories',       categoryRoutes);
router.use('/admin/categories', categoryRoutes);
```

Or split the routers if auth logic differs significantly — the public router exposes only `GET`, the admin router exposes the full CRUD.

## Anti-Pattern: Root-Mounted Domain Routers

```js
// ❌ BAD
router.use('/', experienceRoute);  // pollutes / with all experience endpoints
router.use('/', offerRoute);       // pollutes / with all offer endpoints
router.use('/', couponRoute);      // ambiguity: which router owns /apply?
```

Fix:

```js
router.use('/experience', experienceRoutes);
router.use('/offers',     offerRoutes);
router.use('/coupons',    couponRoutes);
```

If frontend clients depended on the old root paths, add documented aliases during a deprecation window (see `safe-refactor-strategy`).

## Migration Workflow

```
Route Hygiene Migration Progress:
- [ ] Step 1: Inventory all router.use() calls in routes/index.js
- [ ] Step 2: Identify duplicate / root-mounted entries
- [ ] Step 3: For each, decide: rename, alias, or split
- [ ] Step 4: Audit frontend for call sites using the old URLs
- [ ] Step 5: Update frontend to use canonical URLs
- [ ] Step 6: Add aliases with deprecation comments during transition
- [ ] Step 7: Remove aliases after the deprecation window
```

### Step 4 — Frontend Audit

For each old URL pattern, grep the frontend:

```bash
rg "api\.(get|post|put|patch|delete)\(['\"]/offers" frontend/src
```

Update call sites to use the canonical URL in the **same PR** as the alias is added, so the alias has a known consumer count from day one.

## Implementation Rules

1. **`routes/index.js` is the single composition file.** Sub-routers may import other sub-routers, but the top-level shape lives in one file.
2. **Every mount has a prefix.** No `router.use(handler)` without a path.
3. **Section comments group mounts** (public / role-scoped / cross-cutting).
4. **Aliases include a removal date in a comment.**
5. **Two routers never claim the same URL prefix.** If `/admin` is `adminRoutes`, nothing else mounts under `/admin` at the top level — sub-paths are owned inside `adminRoutes`.
6. **Auth is enforced at the router, not at `routes/index.js`.** Each domain router applies its own auth middleware.
7. **404 fallback is the last middleware.** Defined after `router.use('*', notFoundHandler)` in the app setup, not in `routes/index.js`.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Two undocumented mounts of the same router | Reader cannot infer intent | Add comment or split routers |
| Domain router mounted at `/` | Pollutes namespace; future routes shadow | Mount under an explicit prefix |
| Mount order matters for correctness | Hidden coupling; refactor risk | Resolve the conflict (rename or split) |
| Auth middleware applied at `routes/index.js` per domain | Scattered enforcement | Apply inside each domain's router |
| Three different files registering routes | No single map of the API surface | One composition file |
| Renaming an endpoint without an alias window | Breaks existing clients | Add alias, deprecate, then remove |
| Wildcard catch-all routers (`router.use('*', somethingDomain)`) | Owns far too much, hides real routing | Specific paths only |
| Routes file growing past ~80 lines | A symptom: domains aren't grouped | Group section comments and split into sub-files if needed |

## Verifying Hygiene

Quick checks to run before merge:

```bash
# Find any router mounted at '/' root
rg "router\.use\(['\"]\/['\"]," app/routes/

# Find duplicate router imports mounted under different paths
rg "router\.use\(['\"]" app/routes/index.js | sort -k2 -t'(' | uniq -d
```

Either command producing output is a finding to address before merging.

## When Multiple Mounts Are Legitimate

There are valid cases for the same router under two paths:

1. **Public vs. admin view of the same resource**, where the same handlers respond differently based on `req.user.role`. Document this in a comment.
2. **Legacy alias during a deprecation window**, with a removal date in the comment.
3. **Versioned API** (`/v1/orders`, `/v2/orders`), where the router differs per version — different routers, similar prefixes.

If none of these apply, the duplicate mount is a bug.

## Related Skills

- `modular-monolith-layout` — defines domain routers and composition
- `validation-middleware-standard` — schemas applied inside each domain router
- `safe-refactor-strategy` — alias + deprecation window pattern when renaming URLs
