---
name: db-performance-hardening
description: Apply safe performance improvements without changing functionality - audit and add missing MongoDB indexes via a central databaseIndexManager, extend cache coverage for hot read paths using cacheService.getOrSet with appropriate TTLs, propagate correlationId through structured logs, and add N+1 query guards through tight projections. Use when the user mentions slow queries, performance hardening, missing indexes, cache extension, observability, or "make it faster" without changing behavior.
---

# DB & Cache Performance Hardening

## Purpose

Apply **safe**, **zero-behavior-change** performance improvements that use infrastructure already present in the codebase:

1. Missing database indexes → add via the central index manager
2. Hot read paths without caching → wrap with `cacheService.getOrSet`
3. Slow paths without trace context → propagate `correlationId`
4. Implicit N+1 queries → tighten projections and verify populations

Every change in this skill is rollback-safe and observable.

## When To Use

- The user reports slow endpoints, P99 spikes, or DB CPU pressure
- A read endpoint hits the DB on every request despite being cacheable
- Production logs lack `correlationId` for tracing slow flows
- The codebase has a `databaseIndexManager` (or equivalent) but it is incomplete
- The user asks to "harden performance", "add indexes", "extend cache", "improve observability"

Do **not** use this skill for functional refactors — see `domain-service-extraction` instead.

## The Three-Lane Approach

| Lane | Risk | Tools |
|---|---|---|
| 1. Indexes | 🟢 Low | `databaseIndexManager.js` |
| 2. Caching | 🟢 Low (additive) | `cacheService.getOrSet()` |
| 3. Tracing | 🟢 Zero | `correlationIdMiddleware`, logger |

## Lane 1 — DB Indexes

### Workflow

```
Index Audit Progress:
- [ ] Step 1: Identify high-traffic queries via slow query log
- [ ] Step 2: Extract the query shape (filter fields + sort fields)
- [ ] Step 3: Check if a covering index exists
- [ ] Step 4: Add the missing index to databaseIndexManager
- [ ] Step 5: Deploy with index build in background mode
- [ ] Step 6: Verify query plan uses the new index
```

### Index Shape Rules

For a query like:

```js
Order.find({ customer: id, status: 'placed' }).sort({ createdAt: -1 })
```

The right index is **compound**, fields in this order:

1. **Equality fields first** (`customer`, `status`)
2. **Sort fields next** (`createdAt: -1`)
3. **Range fields last** (e.g., `createdAt: { $gte }` if range-filtered)

```js
{ customer: 1, status: 1, createdAt: -1 }
```

This is the **ESR** rule (Equality → Sort → Range).

### Typical Missing Indexes To Audit

| Collection | Index | Why |
|---|---|---|
| `orders` | `{ customer: 1, createdAt: -1 }` | Customer order history |
| `orders` | `{ seller: 1, workflowStatus: 1 }` | Seller dashboard |
| `orders` | `{ deliveryBoy: 1, status: 1 }` | Delivery agent active orders |
| `transactions` | `{ user: 1, userModel: 1, createdAt: -1 }` | Wallet history |
| `transactions` | `{ user: 1, type: 1, status: 1 }` | Filter by type / status |
| `ledgerEntries` | `{ orderId: 1, actorType: 1 }` | Order ledger reconstruction |

Map each finding to a real query in the codebase before adding.

### Adding To `databaseIndexManager`

```js
// Existing infrastructure file
export const INDEX_DEFINITIONS = [
  // ... existing ...
  { collection: 'orders',        keys: { customer: 1, createdAt: -1 },       opts: { background: true } },
  { collection: 'orders',        keys: { seller: 1, workflowStatus: 1 },     opts: { background: true } },
  { collection: 'transactions',  keys: { user: 1, userModel: 1, createdAt: -1 }, opts: { background: true } },
];
```

Always pass `{ background: true }` for new indexes in production to avoid blocking writes during the build.

### Verification

After deploy, run `.explain('executionStats')` on the target query and confirm:

```
"winningPlan": { "stage": "IXSCAN", "indexName": "customer_1_createdAt_-1" }
```

If the plan still shows `COLLSCAN`, the index does not match the query shape — re-derive using ESR.

## Lane 2 — Extend Cache Coverage

### When To Cache A Read Path

Cache a read endpoint when **all** are true:

- It is read-heavy compared to write frequency
- Stale data within the TTL window is acceptable to the product
- The response shape is stable (no per-request personalization mixed in)
- An invalidation hook exists for related writes

### TTL Guidelines

| Data Volatility | TTL |
|---|---|
| Real-time (e.g., live delivery earnings) | 15-30 s |
| Frequently changing (dashboard stats) | 60-120 s |
| Slowly changing (categories, settings) | 5-30 min |
| Rarely changing (static config) | 1-24 h |

### Pattern: `cacheService.getOrSet`

```js
// app/services/delivery/deliveryStatsService.js
import { getOrSet } from '../../infrastructure/cache/cacheService.js';

export async function getDeliveryStats(deliveryId) {
  return getOrSet(
    `delivery:stats:${deliveryId}`,
    60, // TTL seconds
    async () => {
      // expensive aggregation
      return await Order.aggregate([/* ... */]);
    },
  );
}
```

The miss path is **identical** to the original behavior — rollback = disable the cache via env flag or remove the wrapper.

### Invalidation Hook

Whenever the underlying data changes, invalidate the cache key in the same transaction-completion path:

```js
await cacheService.invalidate(`delivery:stats:${deliveryId}`);
```

If pub/sub invalidation is available (`cacheService` already supports it in many projects), the invalidation propagates across all app instances.

### What To Cache First (highest ROI)

Pick read paths that currently hit the DB on every request:

- Dashboard stats (`getDeliveryStats`, `getSellerStats`, admin counters)
- Earnings summaries (`getDeliveryEarnings`)
- Category trees, location dropdowns, configuration reads
- Anything called from a homepage / cold-start screen

### What NOT To Cache

- Per-user inboxes / unread counts (high write rate)
- Real-time chat or socket state
- Anything personalized with auth-sensitive data and a TTL longer than a few seconds (privacy risk if cache key isn't scoped to the user)

## Lane 3 — Structured Request Tracing

### Goal

Every `logger.error()` and `logger.warn()` includes `correlationId` so that a slow / failed request can be reconstructed end-to-end.

### Pattern

`correlationIdMiddleware` attaches `req.correlationId`. Controllers pass it forward:

```js
logger.error({ correlationId: req.correlationId, err, orderId }, 'order.placement.failed');
```

Services that don't receive `req` use AsyncLocalStorage via `getRequestContext()` (see `structured-logging-migration`).

### Queue & Worker Tracing

When enqueueing a job, include the originating `correlationId` in the payload:

```js
await queue.add('settle-order', { orderId, correlationId });
```

The worker restores it into the request context before processing:

```js
queue.process(async (job) => {
  runWithContext({ correlationId: job.data.correlationId }, () => {
    return handleSettlement(job.data.orderId);
  });
});
```

End-to-end traces now span HTTP → queue → worker → next HTTP callback.

## N+1 Guard

### Symptom

Endpoint fetches a list, then for each item triggers an additional query because a Mongoose `populate` lacks a projection or because lazy access fires inside a loop.

### Example

```js
const txs = await Transaction.find({ user: id }).limit(200).populate('order'); // pulls FULL order docs
for (const t of txs) {
  const total = t.order.pricing.total; // populated, but the doc was huge — wasted bandwidth
}
```

### Fix

```js
const txs = await Transaction.find({ user: id })
  .limit(200)
  .populate('order', 'orderId pricing paymentBreakdown') // narrow projection
  .lean(); // no Mongoose hydration overhead for read-only paths
```

### Rules

1. **Always specify a projection on `populate`.** Never pull the whole referenced document.
2. **Use `.lean()` on read-only aggregation paths.** Saves CPU and memory.
3. **For list pages, use server-side pagination.** Never `find({}).limit(huge)`.
4. **Audit any loop that calls `await` inside.** Sign of N+1.
5. **Prefer `$lookup` aggregation for cross-collection joins when the result set is bounded.**

## Implementation Rules

1. **No functional change.** Every change in this skill must preserve response shapes and behavior.
2. **Index builds run in background mode in production.** `{ background: true }`.
3. **Cache TTLs are explicit and documented.** No magic numbers in service code — pull from `constants/cache.js` or env.
4. **Every cache key has a defined invalidation path.** Document the writes that should bust it.
5. **Every error / warn log includes `correlationId`.** Enforced in code review.
6. **Mongoose `populate` always has a projection.** Reviewer checks PRs explicitly.
7. **Rollback is documented per change.** Index → drop with `dropIndex` (rare). Cache → wrap removed. Logging → revert.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Adding an index in foreground mode in production | Blocks writes during the build | `{ background: true }` |
| Caching personalized data with a long TTL | Cross-user leakage | Short TTL + per-user key scoping |
| Caching without an invalidation path | Stale data forever | Define and implement invalidation hooks |
| `cacheService.set` with no TTL | Memory leak in Redis | Always pass TTL |
| `populate('order')` without projection | Pulls entire document | Narrow projection always |
| Reading + caching mid-write | Stale write-through | Cache reads; invalidate after writes |
| Single index containing 6+ fields | Storage cost, slow writes | Follow ESR, keep indexes narrow |
| Index on a field that never appears in queries | Wasted storage + write cost | Verify against real query patterns |
| Logging slow query bodies including secrets | Compliance risk | Log query shape, not values |
| Bumping connection pool size as a "fix" | Treats symptom, not cause | Identify the slow query, add the index |

## Observability Checklist

When this skill's work is complete:

- [ ] Slow query log shows < 1% of queries above the threshold
- [ ] Hot read endpoints show cache-hit ratios > 80% in their TTL window
- [ ] Every production error log line has `correlationId`
- [ ] Worker job logs reference the originating request's `correlationId`
- [ ] No production query uses `find({}).populate('x')` without a projection
- [ ] `databaseIndexManager` definitions are version-controlled and reviewed

## Rollback Recipes

| Change | Rollback |
|---|---|
| Added index | Drop it (`db.collection.dropIndex(name)`) — query reverts to scan; no behavior change |
| Added cache wrapper | Remove the wrapper or set TTL = 0 via env |
| Added correlationId propagation | Logs lose context; functional behavior unchanged |
| Narrowed `populate` projection | Re-add fields if a downstream consumer depended on one (audit first) |

## Related Skills

- `structured-logging-migration` — required precondition for trace propagation
- `infrastructure-domain-separation` — `cacheService` and `databaseIndexManager` live in `infrastructure/`
- `safe-refactor-strategy` — incremental rollout discipline applies
