---
name: domain-service-extraction
description: Break apart god controllers and oversized domain services using the strangler-fig pattern. Extracts handlers into focused domain services while controllers become thin HTTP adapters, with zero API breakage. Use when refactoring a controller or service over 800 lines, when a single file imports 15+ modules, or when the user asks to "shrink", "decompose", or "extract" a god object.
---

# Domain Service Extraction

## Purpose

Reduce god controllers (2,000+ line files with 20+ imports) and bloated domain services into focused, testable units. Controllers become thin HTTP adapters; business logic moves into cohesive domain services.

This skill applies the **strangler fig** pattern: extract one handler per PR, never rewrite.

## When To Use

- A controller exceeds 500 lines or imports 15+ modules
- A service file mixes state-machine logic, queue scheduling, socket emissions, and DB calls
- The user asks to "extract", "decompose", "split", or "shrink" a file
- Unit-testing a handler requires mocking half the application

## The Target Shape

**Controller after extraction (always this shape):**

```js
export const requestReturn = async (req, res) => {
  try {
    const result = await OrderReturnService.createReturnRequest(
      req.user.id,
      req.params.orderId,
      req.body
    );
    return handleResponse(res, 200, 'Return request submitted', result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
```

The controller does only three things:
1. Read inputs from `req`
2. Call exactly one domain service method
3. Format the response with the shared `handleResponse` helper

**Service shape:**

```js
export class OrderReturnService {
  static async createReturnRequest(customerId, orderId, payload) { /* ... */ }
  static async getReturnDetails(orderId, userId, role)            { /* ... */ }
  static async approveReturn(orderId, actorId)                    { /* ... */ }
  static async rejectReturn(orderId, actorId, reason)             { /* ... */ }
}
```

Services are framework-agnostic. They accept primitives or DTOs, never `req`/`res`.

## Extraction Workflow

Copy this checklist:

```
Extraction Progress:
- [ ] Step 1: Identify the cohesive handler group to extract
- [ ] Step 2: Create the new service file with empty methods
- [ ] Step 3: Move logic verbatim, replace `req`/`res` access with params
- [ ] Step 4: Replace inline logic in controller with service call
- [ ] Step 5: Run integration tests against unchanged HTTP contract
- [ ] Step 6: Add unit tests directly against the service
- [ ] Step 7: Delete dead helpers from the original file
```

### Step 1 — Identify A Cohesive Group

Look for handlers that share:
- The same domain noun (return, payment, earnings, location)
- The same set of dependencies
- The same business rules

Bad grouping: "extract everything order-related". Good grouping: "extract everything **return-related** in the order controller".

Always extract one cohesive group per PR. Never bundle multiple groups.

### Step 2 — Create The New Service File

Place under a domain folder:

```
app/services/order/orderReturnService.js
app/services/delivery/locationThrottleService.js
app/services/delivery/deliveryEarningsService.js
```

Or under a domain folder once `modular-monolith-layout` is applied:

```
app/domains/order/return/return.service.js
```

Start with method signatures and empty bodies. Confirm the controller compiles before pasting logic.

### Step 3 — Move Logic Verbatim

Paste the handler body into the service method. Replace:

| Controller Access | Service Parameter |
|---|---|
| `req.user.id` | `userId` |
| `req.params.orderId` | `orderId` |
| `req.body` | `payload` (typed/validated) |
| `req.query` | `filters`, `pagination` |
| `res.status(...).json(...)` | `return value` or `throw error` |

Throw errors with `statusCode` attached; the controller's catch block maps them to HTTP.

```js
const err = new Error('Order not found');
err.statusCode = 404;
throw err;
```

### Step 4 — Replace Inline Logic In Controller

Use the wrapper pattern (see `safe-refactor-strategy`). The old code stays in place behind a feature check only if the extraction is high-risk. For most pure refactors, the controller now imports and calls the service directly.

### Step 5 — Test Against Unchanged HTTP Contract

Existing integration tests must pass without modification. If they don't, the extraction changed behavior — revert.

### Step 6 — Add Unit Tests Against The Service

The new service has no HTTP dependencies. Write tests that:
- Mock the database / external dependencies
- Call the static method directly
- Assert return value or thrown error shape

### Step 7 — Delete Dead Helpers

Once the controller no longer calls the extracted inline code, delete the dead helpers. Run `rg "<old function name>"` to confirm zero callers.

## Implementation Rules

1. **One extraction per PR.** Never bundle unrelated handlers.
2. **Services never import `req`/`res`/`next`.** If they need request context, accept it as a parameter (e.g., `correlationId`).
3. **Services throw errors; controllers map errors to HTTP.** Use `error.statusCode` convention.
4. **Services are stateless.** No module-level mutable state. All state lives in the DB, cache, or queue.
5. **Services call other services through their public interface.** Never reach into another service's private helpers.
6. **Controllers stay under 400 lines.** If they exceed this after extractions, more groups need to come out.
7. **Services stay under 600 lines.** A service growing past this needs further decomposition (e.g., split `OrderReturnService` into `ReturnRequestService` and `ReturnApprovalService`).
8. **All return-window / pricing / financial logic lives in a single utility.** Never compute the same business rule in two services.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Service that imports `express` | Couples domain to HTTP framework | Pass needed values as parameters |
| Service that calls `res.json()` | Cannot be reused by workers, jobs, or tests | Return value, let controller send |
| Controller with business logic in the catch block | Error handling diverges per handler | Throw from service with `statusCode` |
| Extracting a single function "just because it's long" | Creates ceremony without cohesion benefit | Extract by domain concept, not by line count |
| Service that imports another service's internal helper | Reproduces tight coupling at a deeper layer | Expose the helper via the service's public interface or share a utility |
| "Util" file becoming a god utility | Same god-object problem, new location | Group utilities by concept, not by alphabetical name |
| Extracting and renaming public functions in the same PR | Two changes at once, doubles rollback blast | Extract first, rename in a later PR |

## Strangler Fig Sequencing Example

`orderController.js` at 2,004 lines becomes:

| PR | Extraction | Lines Out | New File |
|---|---|---|---|
| 1 | Return handlers | ~300 | `services/order/orderReturnService.js` |
| 2 | Query handlers | ~200 | extend existing `services/orderQueryService.js` |
| 3 | Cancellation handlers | ~150 | `services/order/orderCancellationService.js` |
| 4 | Placement refinement | ~250 | extend `services/orderPlacementService.js` |
| 5 | Settlement triggers | ~100 | extend `services/finance/orderSettlement.js` |

After PR 5: controller is under 400 lines, all handlers are thin adapters.

## Worked Example: Extract Location Throttling

**Before — `deliveryController.js`:**

```js
import { getRedisClient } from '../config/redis.js'; // infra in controller!

async function throttleLocationUpdate(deliveryId, lat, lng) {
  const redis = getRedisClient();
  const key = `loc:throttle:${deliveryId}`;
  const last = await redis.get(key);
  // ... 30 lines of throttle logic ...
}

export const updateLocation = async (req, res) => {
  const should = await throttleLocationUpdate(req.user.id, req.body.lat, req.body.lng);
  if (should) return res.status(429).json({ error: 'Too frequent' });
  // ... rest ...
};
```

**After — `app/services/delivery/locationThrottleService.js`:**

```js
import { getRedisClient } from '../../config/redis.js';

export async function shouldThrottle(deliveryId, lat, lng) {
  const redis = getRedisClient();
  // ... 30 lines moved here verbatim ...
}
```

**After — `deliveryController.js`:**

```js
import { shouldThrottle } from '../services/delivery/locationThrottleService.js';
// No more Redis import in the controller.

export const updateLocation = async (req, res) => {
  if (await shouldThrottle(req.user.id, req.body.lat, req.body.lng)) {
    return res.status(429).json({ error: 'Too frequent' });
  }
  // ... rest ...
};
```

Controller no longer touches infrastructure. Service is independently testable. Rollback = revert the import.

## Related Skills

- `safe-refactor-strategy` — the wrapper pattern this skill applies
- `infrastructure-domain-separation` — for when extracted services still touch infra
- `provider-adapter-pattern` — when extracted services depend on a swappable provider
- `modular-monolith-layout` — where extracted services finally live
- `validation-middleware-standard` — extracted services should expect validated input
