---
name: modular-monolith-layout
description: Organize a Node.js / Express backend as a modular monolith with domain-organized folders (domains/<entity>/<entity>.controller.js, .service.js, .validation.js, .routes.js) and a separate infrastructure/ tree. Optimized for 3 - 10 lakh users without microservice complexity. Use when the user asks for a folder restructure, backend architecture target, "modular monolith", "domain-driven layout", or wants to know where new files should live.
---

# Modular Monolith Layout

## Purpose

Provide a stable, scalable target folder layout for a Node.js backend serving up to ~10 lakh (1 million) users. Each business domain is a closed unit owning its controller, service, validation, routes, and (optionally) workers. Infrastructure is isolated. Process roles (HTTP, worker, scheduler) share core bootstrapping but run independently.

This skill defines **where files go**. It complements `domain-service-extraction` (what to extract) and `infrastructure-domain-separation` (how to split infra).

## When To Use

- Greenfield Node service that will grow beyond ~50 endpoints
- Existing flat `controller/` + `services/` layout becoming unnavigable
- Team needs a "where does this file go?" reference
- Migrating from layered (controller/service/model) to domain-organized layout
- Planning to add a new portal, role, or domain entity

Do **not** use for tiny services (< 10 endpoints) — flat layout is cheaper.

## Top-Level Structure

```
backend/
  index.js                          ← process role bootstrap
  app/
    core/                           ← startup, shutdown, processRole, readiness
    domains/                        ← business logic, one folder per domain
    infrastructure/                 ← cache, email, firebase, maps, media, sms, search, queue
    middleware/                     ← auth, error, rate limiters, validate, request context
    models/                         ← Mongoose / ORM models (kept flat is OK)
    constants/                      ← cross-domain enums and constants
    utils/                          ← leaf utilities (no domain knowledge)
    queues/                         ← queue definitions (consumed by infrastructure/queue port)
    jobs/                           ← scheduled job handlers
    config/                         ← DB, Redis, env config
    routes/
      index.js                      ← composes per-domain route files
    socket/                         ← Socket.IO manager (single instance)
```

## Per-Domain Folder Shape

Every domain follows the same internal layout:

```
app/domains/<domain>/
  <domain>.controller.js            ← thin HTTP adapter (< 400 lines)
  <domain>.service.js               ← orchestration entry point
  <domain>.validation.js            ← Joi schemas for all endpoints
  <domain>.routes.js                ← route definitions
  <domain>.model.js                 ← (optional) Mongoose model if domain-local
  index.js                          ← re-exports controller handlers + service class
  <sub-concept>/                    ← (optional) further decomposition
    <sub>.service.js
    <sub>.validation.js
```

### Example: Order Domain

```
app/domains/order/
  order.controller.js
  order.service.js                  ← placement + query orchestration
  order.validation.js
  order.routes.js
  return/
    return.service.js               ← OrderReturnService
    return.validation.js
  cancellation/
    cancellation.service.js
  query/
    query.service.js                ← read paths
```

### Example: Payment Domain

```
app/domains/payment/
  payment.controller.js
  payment.service.js                ← provider-agnostic orchestrator
  payment.validation.js
  payment.routes.js
  ports/
    paymentProviderPort.js
  providers/
    phonepe.adapter.js
    razorpay.adapter.js
  providerRegistry.js
```

## Domain Index File Pattern

Each domain exposes a clean public surface via `index.js`:

```js
// app/domains/order/index.js
export {
  placeOrder,
  getMyOrders,
  getOrderDetails,
  cancelOrder,
  requestReturn,
} from './order.controller.js';

export { OrderService }       from './order.service.js';
export { OrderReturnService } from './return/return.service.js';
export { OrderQueryService }  from './query/query.service.js';
```

Other domains import from this index, never from internal files. This keeps the public contract narrow and reorderable.

## Routes Composition

```js
// app/routes/index.js
import { Router } from 'express';
import orderRoutes        from '../domains/order/order.routes.js';
import paymentRoutes      from '../domains/payment/payment.routes.js';
import deliveryRoutes     from '../domains/delivery/delivery.routes.js';
import productRoutes      from '../domains/product/product.routes.js';
import sellerRoutes       from '../domains/seller/seller.routes.js';
import customerRoutes     from '../domains/customer/customer.routes.js';
import notificationRoutes from '../domains/notification/notification.routes.js';

const router = Router();

router.use('/orders',        orderRoutes);
router.use('/payments',      paymentRoutes);
router.use('/delivery',      deliveryRoutes);
router.use('/products',      productRoutes);
router.use('/sellers',       sellerRoutes);
router.use('/customers',     customerRoutes);
router.use('/notifications', notificationRoutes);

export default router;
```

One mount per domain. No router mounted at `/` root. No duplicate mounts (see `route-mounting-hygiene`).

## Process Role Separation

```js
// index.js
import { startHttp }      from './app/core/startup.js';
import { startWorker }    from './app/core/startup.js';
import { startScheduler } from './app/core/startup.js';

const role = process.env.PROCESS_ROLE || 'http';

if      (role === 'http')      await startHttp();
else if (role === 'worker')    await startWorker();
else if (role === 'scheduler') await startScheduler();
else throw new Error(`Unknown PROCESS_ROLE: ${role}`);
```

- **HTTP** loads routes, starts Express, attaches Socket.IO
- **Worker** loads queue consumers, no Express
- **Scheduler** loads cron jobs via `distributedScheduler` (locks across instances)

Each role shares `core/startup.js` for DB / Redis / logger bootstrapping but mounts only what it needs.

## File-Placement Decision Tree

When adding a new file, answer in order:

1. **Is it framework-agnostic plumbing?** (cache, email, SDK wrapper) → `infrastructure/<capability>/`
2. **Is it a cross-cutting middleware?** (auth, rate limit, validate) → `middleware/`
3. **Does it encode business rules for a specific domain?** → `domains/<domain>/`
4. **Is it a leaf utility with no domain knowledge?** (string helpers, date math) → `utils/`
5. **Is it a constant or enum used across domains?** → `constants/`
6. **Is it a Mongoose model?** → `models/` (or `domains/<domain>/<domain>.model.js` if strictly local)
7. **Is it a queue worker?** → `queues/` for definitions, worker is started under `domains/<domain>/` or `app/jobs/`
8. **Is it a scheduled job?** → `jobs/`

If multiple answers fit, choose the **deepest domain owner**. If no answer fits, the file likely needs to be split.

## Implementation Rules

1. **One mount per domain in `routes/index.js`.** No duplicate paths. No root-level mounts.
2. **Controllers are < 400 lines.** Pure HTTP adapters. (See `domain-service-extraction`.)
3. **Services are < 600 lines.** Beyond that, split into sub-domain folders.
4. **Validation lives next to the domain it validates.** Not in a shared `validation/` folder at the top.
5. **Every endpoint has a Joi schema applied via `validate()` middleware.** (See `validation-middleware-standard`.)
6. **A domain never imports from another domain's internal folders** — only from that domain's `index.js`.
7. **Infrastructure is never imported by controllers** — always through a domain service.
8. **Workers and the HTTP server share the same domain code** — never duplicate logic into a worker file.
9. **Tests mirror the production tree:** `tests/domains/order/return.service.test.js`.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Flat `controller/` + `services/` for 50+ endpoints | Cannot find anything; merges create conflicts | Domain-organize |
| Domain A reaches into `domains/B/internals/foo.js` | Reproduces tight coupling at a deeper layer | Import only from `domains/B/index.js` |
| One mega `validation/` folder at top level | Hard to keep aligned with handler changes | Co-locate `<domain>.validation.js` |
| Adding a `helpers/` folder per domain | Becomes a junk drawer | Promote real concepts to services, push leaf helpers to `utils/` |
| Mixing infra and domain at the same level | Hides which files have side effects | Move infra under `infrastructure/` |
| Router mounted at multiple paths without comments | Silent ambiguity on ownership | One canonical mount + alias if needed, with comment |
| Domain `index.js` re-exporting everything | Defeats encapsulation, returns to god module | Re-export only the public surface |
| Sharing one `models/` folder across distant domains with circular references | Mongoose ref cycles, slow startup | Keep cross-domain refs in `models/`, scope domain-local models inside the domain |

## Migration Path From Flat Layout

Apply incrementally with re-export shims (see `safe-refactor-strategy`):

1. Create `app/domains/` and `app/infrastructure/` skeletons
2. Pick one domain (start with the smallest, e.g., `otp` or `notification`)
3. Move its files into `domains/<domain>/` using the per-domain shape
4. Leave re-export shims at every old path
5. Update the routes mount to point at the new `<domain>.routes.js`
6. Verify endpoints via smoke tests; ship
7. Repeat per domain, one per sprint
8. Delete shims after every internal caller has migrated

## Scaling Notes (3 - 10 Lakh Users)

This layout supports the target user range without microservices:

- **Horizontal scaling:** worker role can scale independently of HTTP
- **Cache pressure:** infrastructure/cache owns SCAN-based invalidation (never KEYS)
- **DB hotspots:** owned by each domain's service; indexes live in `databaseIndexManager`
- **Real-time:** single Socket.IO manager, but emission helpers live per-domain
- **Background jobs:** `distributedScheduler` prevents double-firing on multi-instance deploys

If you outgrow this layout (~50+ engineers, 20+ domains, > 10M users), the `domains/` folder is already a microservice extraction map. Each domain folder becomes a candidate service. Until then, stay monolithic.

## Worked Example: Add A New "Warehouse" Domain

1. Create `app/domains/warehouse/`
2. Add `warehouse.controller.js`, `warehouse.service.js`, `warehouse.validation.js`, `warehouse.routes.js`, `index.js`
3. Mount in `routes/index.js`: `router.use('/warehouse', warehouseRoutes);`
4. If warehouse needs Redis, import from `infrastructure/cache/`
5. If warehouse needs to emit notifications, call `domains/notification/index.js`'s service
6. Add tests under `tests/domains/warehouse/`

No other files change. The new domain is a closed unit.

## Related Skills

- `safe-refactor-strategy` — re-export pattern for incremental migration
- `domain-service-extraction` — extract handlers into the per-domain shape
- `infrastructure-domain-separation` — populate the `infrastructure/` tree
- `provider-adapter-pattern` — for domains with swappable external providers
- `validation-middleware-standard` — every endpoint gets a `<domain>.validation.js`
- `route-mounting-hygiene` — single-mount rule for `routes/index.js`
