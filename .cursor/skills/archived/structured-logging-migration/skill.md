---
name: structured-logging-migration
description: Replace scattered console.log, console.warn, console.error, and ad-hoc JSON.stringify logging with a single project logger that emits structured JSON with correlationId, level, and contextual fields. Use when controllers and services use console.* directly, when log lines are not searchable in production, or when the user asks to "standardize logging", "add correlation IDs", or "fix observability gaps".
---

# Structured Logging Migration

## Purpose

Replace every `console.log` / `console.warn` / `console.error` call and every manual `console.log(JSON.stringify({...}))` pattern with calls to a single project logger that emits structured JSON. Every log line carries `level`, `timestamp`, `correlationId`, and a stable event field, so production logs are searchable, aggregatable, and pageable.

## When To Use

- Codebase mixes `console.*`, `logger.*`, and `console.log(JSON.stringify(...))` patterns
- Production log lines lack `correlationId` for request tracing
- The user mentions "observability", "log aggregation", "structured logs", "Pino", "Winston", or asks to "standardize logging"
- A logger file (`logger.js`) already exists but only some files use it

## The Single Logger Contract

One logger module. Every consumer imports from this path.

```js
// app/infrastructure/observability/logger.js
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'app' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.otp',
      '*.token',
      '*.cardNumber',
    ],
    censor: '[REDACTED]',
  },
});

export default logger;
```

Use Pino, Winston, or a similar structured logger. The choice matters less than the **single source rule**.

## Standard Log Call Shape

Every log call follows the same shape:

```js
logger.info({ correlationId, orderId, sellerId }, 'order.placement.completed');
logger.warn({ correlationId, deliveryId, lat, lng }, 'delivery.location.throttled');
logger.error({ correlationId, err, paymentId }, 'payment.callback.invalid_signature');
```

| Argument | Purpose |
|---|---|
| First arg (object) | Structured fields — searchable in log aggregator |
| Second arg (string) | Stable event name in `domain.subject.action` format |

**Event names are stable strings**, not interpolated. Aggregators rely on grouping by event name.

## Migration Workflow

Copy this checklist:

```
Logging Migration Progress:
- [ ] Step 1: Confirm the single logger module exists
- [ ] Step 2: Inventory console.* call sites
- [ ] Step 3: Replace per-file with logger.* calls
- [ ] Step 4: Add correlationId to error and warn calls
- [ ] Step 5: Migrate manual JSON.stringify patterns
- [ ] Step 6: Add ESLint rule banning console.* in app code
- [ ] Step 7: Verify production log aggregation
```

### Step 1 — Confirm The Logger

If no logger exists, create one first (see contract above). Place under `app/infrastructure/observability/logger.js`.

### Step 2 — Inventory Call Sites

```bash
rg --vimgrep "console\.(log|warn|error|info|debug)" app/ src/
```

Categorize:
- **Production code** → must migrate
- **Scripts / one-offs / migrations** → may keep `console.*`
- **Test files** → may keep `console.*`

### Step 3 — Replace Per File

Per PR, migrate one file. Imports added at the top:

```js
import logger from '../infrastructure/observability/logger.js';
```

Replacements:

| Before | After |
|---|---|
| `console.log('order created', id)` | `logger.info({ orderId: id }, 'order.created')` |
| `console.warn('slow query', ms)` | `logger.warn({ durationMs: ms }, 'db.query.slow')` |
| `console.error('payment failed', err)` | `logger.error({ err, correlationId }, 'payment.failed')` |
| `console.log(JSON.stringify({level:'info', event:'x', ...}))` | `logger.info({ ... }, 'x')` |

### Step 4 — Add correlationId Everywhere

If `correlationIdMiddleware` already attaches `req.correlationId`, propagate it through:

- **Controllers:** `logger.error({ err, correlationId: req.correlationId }, 'event')`
- **Services:** accept `correlationId` as a parameter or use a request-context module (AsyncLocalStorage)
- **Queue workers:** include the originating `correlationId` in the job payload; restore it in the worker

A request-context pattern using AsyncLocalStorage:

```js
// app/middleware/requestContext.js
import { AsyncLocalStorage } from 'async_hooks';
const store = new AsyncLocalStorage();

export function requestContextMiddleware(req, _res, next) {
  store.run({ correlationId: req.correlationId }, next);
}

export function getRequestContext() {
  return store.getStore() || {};
}
```

Then in services:

```js
import { getRequestContext } from '../middleware/requestContext.js';
const { correlationId } = getRequestContext();
logger.info({ correlationId, orderId }, 'order.return.created');
```

### Step 5 — Migrate Manual JSON Patterns

Hand-rolled patterns like:

```js
console.log(JSON.stringify({ level: 'info', event: 'payment.created', orderId, amountPaise }));
```

Become:

```js
logger.info({ orderId, amountPaise }, 'payment.created');
```

The logger handles JSON serialization, timestamps, and level normalization.

### Step 6 — Enforce With ESLint

```json
// .eslintrc
{
  "rules": {
    "no-console": ["error", { "allow": [] }]
  },
  "overrides": [
    { "files": ["scripts/**", "tests/**"], "rules": { "no-console": "off" } }
  ]
}
```

Stops regression. New PRs cannot add `console.*` to production code.

### Step 7 — Verify Production

Confirm in the log aggregator that:
- `correlationId` is present on every error / warn
- Event names group correctly
- Redaction (passwords, tokens) is active

## Implementation Rules

1. **One logger module. Every consumer imports from the same path.**
2. **Two-argument shape always.** `(fields, eventName)`. Never `logger.info('order created')` — that string is now an event, not a free-form message.
3. **Event names are stable identifiers.** `domain.subject.action`. Lowercase. Dots. No interpolation.
4. **Errors go in the fields object as `err`.** The logger serializes the stack.
5. **`correlationId` on every `warn` / `error`.** Recommended on every `info`.
6. **Never log secrets.** Configure `redact` paths for `authorization`, `password`, `otp`, `token`, card data.
7. **Log levels are meaningful:**
   - `error` — operator action required (paging condition possible)
   - `warn` — degraded behavior, no action needed but worth tracking
   - `info` — significant business events (order placed, payment captured)
   - `debug` — development-time detail; not enabled in production by default
8. **Scripts and tests may keep `console.*`.** The ESLint override allows them.
9. **Workers and schedulers use the same logger.** Same event name conventions.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| `console.log` in production code | Unsearchable, no aggregation, no level | Use logger |
| `console.log(JSON.stringify({...}))` | Manual structured logging reinvents the logger | Use the real logger |
| Different loggers per module | No single configuration source; redaction gaps | One module, one import |
| Logging the full request object | Leaks headers, body, secrets | Pick specific fields |
| Logging on every cache hit | Floods storage, hides real signals | Log misses, not hits |
| Interpolating the event name (`'order.' + id`) | Breaks aggregation | Event name is static; ID goes in fields |
| Logging errors without `err` object | Loses stack trace | Always pass `{ err }` |
| `console.error(err)` only | No context, no correlation | `logger.error({ err, correlationId, ...context }, 'event')` |
| Reading log strings in code (`if (msg.includes(...))`) | Coupling to log format | Code reads from real state, not from logs |

## Worked Example: paymentService Migration

**Before:**

```js
console.log(JSON.stringify({
  level: 'info',
  event: 'payment.callback.received',
  orderId: o.id,
  status: resp.status,
  ts: new Date().toISOString(),
}));

console.error('payment callback failed', err);
```

**After:**

```js
logger.info(
  { correlationId, orderId: o.id, status: resp.status },
  'payment.callback.received',
);

logger.error(
  { correlationId, err, orderId: o.id },
  'payment.callback.failed',
);
```

Lines shrink, correlation is preserved, redaction is automatic, and the log aggregator can group by event name.

## Log Event Naming Convention

Pattern: `<domain>.<subject>.<action>`

| Good | Bad |
|---|---|
| `order.placement.completed` | `Order placed successfully` |
| `payment.callback.invalid_signature` | `bad sig!!` |
| `delivery.location.throttled` | `throttle ${id}` |
| `cache.invalidation.pubsub_received` | `cache stuff` |

Action verbs (past tense) are preferred for state-changes; nouns are fine for events.

## Migration Sequence

1. The single logger module (or confirm it exists).
2. Highest-volume files first: controllers and core services.
3. Then queue workers and scheduled jobs.
4. Then infrastructure modules.
5. ESLint rule enabled after the last production file is migrated.

## Related Skills

- `infrastructure-domain-separation` — logger lives in `infrastructure/observability/`
- `db-performance-hardening` — uses `correlationId` to trace slow paths
- `safe-refactor-strategy` — migrate per file, no big-bang sweep
