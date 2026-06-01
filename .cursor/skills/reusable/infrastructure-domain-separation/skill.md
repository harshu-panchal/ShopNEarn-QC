---
name: infrastructure-domain-separation
description: Separate pure infrastructure code (cache, email, firebase, maps, media, SMS, search, queue) from domain business logic by moving infra into a dedicated infrastructure/ directory, with re-export shims preserving every existing import. Use when controllers or domain services import Redis, Bull, Firebase, Cloudinary, or other infra SDKs directly, or when the user mentions "infra leakage", "split infra from domain", or "isolate side-effects".
---

# Infrastructure ↔ Domain Separation

## Purpose

Stop mixing infrastructure services (cache, queue, email, push, SMS, media, maps, search) with domain services (order, payment, delivery, customer) at the same folder level. Move all infrastructure under `infrastructure/`, keep `services/` for domain only, and use re-export shims so no caller breaks.

## When To Use

- `app/services/` (or equivalent) contains a mix of `cacheService.js`, `firebaseService.js`, `orderWorkflowService.js`, `paymentService.js` at the same level
- Controllers or domain services directly import `getRedisClient`, `Bull`, `firebase-admin`, or other SDK modules
- The user asks to "split infra", "isolate side effects", or "clean up service folder"
- Onboarding pain: new developers cannot tell which services are business logic versus plumbing

## The Two-Folder Rule

After this skill is applied, every `*.js` file under `app/services/` belongs to **exactly one** of these two categories:

| Folder | Contents | Examples |
|---|---|---|
| `app/services/` (or `app/domains/`) | **Domain** logic — entity rules, workflows, aggregates | `orderReturnService`, `orderWorkflowService`, `paymentService` |
| `app/infrastructure/` | **Infrastructure** — wrappers around external systems and cross-cutting plumbing | `cacheService`, `firebaseService`, `mediaService`, `smsService` |

If a file does not clearly belong to one, split it.

## Target Layout

```
app/
  domains/                   ← business logic, organized by domain
    order/
    payment/
    delivery/
    ...
  infrastructure/            ← plumbing, organized by capability
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
    queue/
      jobSchedulerPort.js
      bullJobScheduler.js
    observability/
      logger.js
      metrics.js
```

## Migration Workflow

Copy this checklist:

```
Infra Separation Progress:
- [ ] Step 1: Classify every file in services/ as Domain or Infra
- [ ] Step 2: Create infrastructure/ folder skeleton
- [ ] Step 3: Move infra files into infrastructure/<capability>/
- [ ] Step 4: Add re-export shims at old paths
- [ ] Step 5: Update new code to import from infrastructure/
- [ ] Step 6: Migrate existing imports incrementally (grep + replace)
- [ ] Step 7: Delete shims after grep confirms zero callers
- [ ] Step 8: Remove direct infra imports from controllers
```

### Step 1 — Classify Every File

Apply the **dependency direction test**: does this file know about a specific business domain (order, customer, seller)? If yes → Domain. If it only knows about external systems and primitives → Infrastructure.

| File | Decision | Reasoning |
|---|---|---|
| `cacheService.js` | Infra | Knows about Redis, not orders |
| `orderWorkflowService.js` | Domain | Encodes order state machine |
| `firebaseService.js` | Infra | Wraps Firebase SDK, no domain awareness |
| `notificationBuilder.js` | Domain | Knows about notification templates per business event |
| `pricingService.js` | Domain | Encodes business pricing rules |
| `mediaService.js` | Infra | Wraps Cloudinary |
| `logger.js` | Infra | Cross-cutting observability |

### Step 2 — Create The Folder Skeleton

Create `app/infrastructure/<capability>/` directories. One folder per external system or cross-cutting concern.

### Step 3 — Move The File

Move (not copy) the infra file to its new home. Update its internal relative imports.

### Step 4 — Add A Re-Export Shim

Leave a shim at the old path:

```js
// app/services/cacheService.js (SHIM — do not add logic here)
export * from '../infrastructure/cache/cacheService.js';
```

This guarantees zero import breaks.

### Step 5 — Update New Code

All new code imports from the new path:

```js
import { getOrSet } from '../infrastructure/cache/cacheService.js';
```

### Step 6 — Incrementally Migrate Imports

Per sprint, run a search-and-replace for the old path. Update one consumer per PR. Never bundle the migration with unrelated changes.

### Step 7 — Remove The Shim

When `rg "services/cacheService"` returns zero matches, delete the shim. Do not delete earlier — silent breakage risk.

### Step 8 — Remove Direct Infra Imports From Controllers

Controllers must not import infrastructure directly. If `deliveryController.js` imports `getRedisClient`, extract a domain service that wraps it (see `domain-service-extraction`). The new domain service imports from `infrastructure/`; the controller imports the domain service.

## Allowed Import Directions

```
controllers          →  domain services  →  infrastructure
                                         →  utils
                                         →  other domain services
                                         →  ports (for swappable providers)

routes               →  controllers
                     →  middleware

domain services      →  infrastructure (via direct import or port)
                     →  utils
                     →  other domain services
                     →  models

infrastructure       →  SDK / external system only
                     →  utils
                     →  observability (logger, metrics)

infrastructure  →  domain services  ❌  forbidden
controllers     →  infrastructure   ❌  forbidden (extract a domain service)
utils           →  any of the above ❌  utils stay leaf
```

## Implementation Rules

1. **Controllers never import infrastructure.** If they need cache or queue, route through a domain service.
2. **Infrastructure never imports domain.** A cache helper does not know about `Order`.
3. **One capability per infrastructure folder.** Don't merge `cache` and `queue` — they have separate lifecycles.
4. **Re-export shims are read-only.** No logic, no transformation, no conditional imports.
5. **Each infrastructure module exposes its own initialization and shutdown hooks** consumed by `core/startup.js` and `core/shutdown.js`.
6. **Tests for domain services mock the infrastructure module path.** Easy because the infra interface is small.
7. **Cross-cutting concerns (logger, metrics, correlationId) live in `infrastructure/observability/`.**

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| `services/firebaseOrderService.js` mixes Firebase + order logic | One file owns infra and domain — both move together, both break together | Split: `infrastructure/firebase/firebaseService.js` + `domains/order/orderNotificationService.js` |
| Controller imports `infrastructure/cache/` directly | Re-couples HTTP layer to infra | Extract domain service that owns the cached read |
| `infrastructure/cache/cacheService.js` imports `models/Order.js` | Domain leaks into infra | Cache helper takes a key prefix or builder function; caller passes shape |
| `utils/` folder accumulates infra wrappers | Violates leaf-only utils rule | Promote to `infrastructure/<capability>/` |
| Shim file with logic ("just one transform") | Shim becomes a hidden indirection layer | Push logic into the new home; shim stays a pure re-export |
| Two folders for the same capability (`infra/cache/` and `services/cacheService`) | Confusion about source of truth | One folder, one shim during migration, delete shim when migration completes |

## Worked Example: Move Cache

**Before:**

```
app/services/
  cacheService.js                   ← infra
  orderWorkflowService.js           ← domain
  orderQueryService.js              ← domain
  emailService.js                   ← infra
```

**After:**

```
app/services/
  orderWorkflowService.js
  orderQueryService.js
  cacheService.js                   ← SHIM: re-exports infrastructure path
  emailService.js                   ← SHIM: re-exports infrastructure path

app/infrastructure/
  cache/cacheService.js             ← actual file
  email/emailService.js             ← actual file
```

Old imports (`from '../services/cacheService.js'`) keep working. New code imports `from '../infrastructure/cache/cacheService.js'`. Shims disappear in a later sprint once the grep is clean.

## Boundary Test (Run On Every PR)

A quick sanity script:

```bash
# Domain services must not directly import infrastructure SDKs.
rg --files-with-matches \
   -e "from 'ioredis'" -e "from 'bull'" -e "from 'firebase-admin'" \
   app/controller/ app/domains/ \
&& echo "Boundary violation: infra SDK imported in domain/controller layer"
```

If the command produces output, the PR has reintroduced infra leakage.

## Related Skills

- `safe-refactor-strategy` — re-export pattern used during migration
- `domain-service-extraction` — extract domain wrappers before adding infra here
- `provider-adapter-pattern` — for swappable infra (payments, SMS, push)
- `modular-monolith-layout` — target folder structure that hosts both `domains/` and `infrastructure/`
