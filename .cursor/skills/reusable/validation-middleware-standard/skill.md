---
name: validation-middleware-standard
description: Standardize Express request validation using a single validate(schema) middleware factory with Joi schemas co-located under each domain. Replaces inline validateWithJoi helpers and ad-hoc string checks scattered across controllers. Use when the user mentions Joi, request validation, schema enforcement, "validate middleware", or when controllers have inline validation duplicated across handlers.
---

# Validation Middleware Standard

## Purpose

Provide one canonical way to validate Express request inputs (body, query, params, headers) using Joi schemas applied via a shared `validate()` middleware factory. Eliminates inline `validateWithJoi()` helpers, ad-hoc string checks, and inconsistent 400 response shapes across controllers.

## When To Use

- Controllers contain inline Joi validation helpers (e.g., `validateWithJoi`)
- Endpoints have ad-hoc `if (!req.body.x) return res.status(400)...` checks
- The validation-schema-to-controller ratio is below 1:1
- Multiple controllers return 400 responses with subtly different shapes
- User asks to "standardize validation", "add Joi middleware", or "centralize input checks"

## The Middleware Factory

One file. One default export. Used by every route definition.

```js
// app/middleware/validate.js
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    if (!schema || typeof schema.validate !== 'function') {
      return next(new Error('validate() requires a Joi schema'));
    }
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: true,
        message: error.details.map((d) => d.message).join('; '),
        details: error.details.map((d) => ({
          path: d.path.join('.'),
          message: d.message,
        })),
      });
    }
    req[source] = value;
    next();
  };
}
```

**Why these Joi options:**

| Option | Reason |
|---|---|
| `abortEarly: false` | Surface all errors at once, not just the first |
| `stripUnknown: true` | Drop unknown fields silently to prevent mass-assignment |
| `convert: true` | Coerce string `"42"` to number `42` for query params |

## Schema Co-Location

Schemas live with the domain they validate.

```
app/domains/order/
  order.controller.js
  order.service.js
  order.validation.js          ← Joi schemas for ALL order endpoints
  order.routes.js
```

Each schema file exports named schemas (one per endpoint):

```js
// app/domains/order/order.validation.js
import Joi from 'joi';

export const placeOrderSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().required(),
      quantity:  Joi.number().integer().min(1).required(),
    }),
  ).min(1).required(),
  addressId:      Joi.string().required(),
  paymentMethod:  Joi.string().valid('cod', 'online').required(),
  couponCode:     Joi.string().optional(),
});

export const cancelOrderSchema = Joi.object({
  reason: Joi.string().max(500).required(),
});

export const returnRequestSchema = Joi.object({
  reason: Joi.string().max(500).required(),
  items:  Joi.array().items(Joi.string()).optional(),
});

export const orderListQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1).default(1),
  limit:  Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().optional(),
});
```

## Route Wiring

Apply schemas at the route definition. Controllers receive validated input via `req.body` / `req.query`.

```js
// app/domains/order/order.routes.js
import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
  placeOrder, cancelOrder, requestReturn, getMyOrders,
} from './order.controller.js';
import {
  placeOrderSchema, cancelOrderSchema, returnRequestSchema, orderListQuerySchema,
} from './order.validation.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = Router();

router.post  ('/',                 authMiddleware, validate(placeOrderSchema),                placeOrder);
router.post  ('/:id/cancel',       authMiddleware, validate(cancelOrderSchema),               cancelOrder);
router.post  ('/:id/return',       authMiddleware, validate(returnRequestSchema),             requestReturn);
router.get   ('/',                 authMiddleware, validate(orderListQuerySchema, 'query'),   getMyOrders);

export default router;
```

## Implementation Rules

1. **One `validate()` factory for the whole codebase.** No per-controller variants.
2. **One schema file per domain**, named `<domain>.validation.js`.
3. **Schema names match controller export names + `Schema` suffix.** `placeOrder` → `placeOrderSchema`.
4. **Validate all four sources where applicable:** `body`, `query`, `params`, `headers`. Pass `source` to the factory.
5. **Controllers never re-validate.** They trust `req.body` after middleware runs.
6. **400 responses share one shape across all endpoints.** Defined inside `validate()`. Never overridden.
7. **Always `stripUnknown: true`.** Defense against mass-assignment / parameter pollution.
8. **Always `abortEarly: false`.** Better UX, all errors at once.
9. **`convert: true` for query and params**, optional for body (numeric query strings need coercion).
10. **Document every required field with `.description()` or `.label()`.** Improves error messages.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Inline `validateWithJoi()` helper inside a controller | Duplicates across controllers, drifts in error shape | Use shared `validate()` middleware |
| `if (!req.body.x) return res.status(400)...` ad-hoc checks | No type coercion, no comprehensive error reporting, mass-assignment risk | Replace with schema + middleware |
| Joi schemas in `models/` folder | Mixes ORM models with HTTP validation | Schemas live under `domains/<domain>/<domain>.validation.js` |
| One mega `validation/` folder at the top level | Hard to keep aligned with controller changes | Co-locate with the domain |
| Validating inside the service layer | Duplicates work; services should trust their input | Validate at the HTTP boundary only |
| `abortEarly: true` | Forces multi-round-trip UX | Use `false` |
| `stripUnknown: false` | Mass-assignment vulnerability | Use `true` |
| Different 400 shapes per controller | Frontend cannot rely on a single error format | Single shape enforced by middleware |
| Schemas without `.required()` on critical fields | Silent acceptance of missing inputs | Explicit required fields |
| Validating partially (only some endpoints have schemas) | Inconsistent input hygiene | 1:1 schema-to-endpoint ratio |

## Priority Order For Adding Schemas

When backfilling validation, prioritize by blast radius:

1. **Money / financial endpoints** — place order, payment initiation, withdrawal, refund
2. **State-changing endpoints** — cancel order, accept delivery, approve return
3. **Auth endpoints** — login, signup, OTP verify, password change
4. **Write endpoints** — create / update product, category, address
5. **Read endpoints with query params** — list endpoints with pagination and filters

Validation gaps on read-only endpoints with no parameters are low priority.

## Adoption Sequence

1. Add `app/middleware/validate.js` (alone). No behavior change yet.
2. Create `<domain>.validation.js` for the highest-risk domain (usually `order`).
3. Wire schemas into `<domain>.routes.js`.
4. Remove the inline `validateWithJoi()` from the matching controller.
5. Test endpoints — 400 responses should now have the standard shape.
6. Repeat per domain, one per PR.
7. After the last domain is migrated, delete every inline validation helper.

## Worked Example: Cancel Order

**Before — controller has inline validation:**

```js
export const cancelOrder = async (req, res) => {
  if (!req.body.reason || typeof req.body.reason !== 'string') {
    return res.status(400).json({ message: 'reason required' });
  }
  if (req.body.reason.length > 500) {
    return res.status(400).json({ message: 'reason too long' });
  }
  // ... business logic ...
};
```

**After — schema + middleware:**

```js
// order.validation.js
export const cancelOrderSchema = Joi.object({
  reason: Joi.string().max(500).required(),
});

// order.routes.js
router.post('/:id/cancel', authMiddleware, validate(cancelOrderSchema), cancelOrder);

// order.controller.js
export const cancelOrder = async (req, res) => {
  const { reason } = req.body; // already validated + stripped
  // ... business logic ...
};
```

The controller shrinks. The schema is testable. The 400 response shape is uniform.

## Testing Schemas Directly

Schemas are pure objects. Unit-test them without spinning up Express:

```js
import { placeOrderSchema } from '../app/domains/order/order.validation.js';

test('rejects empty items', () => {
  const { error } = placeOrderSchema.validate({ items: [], addressId: 'a', paymentMethod: 'cod' });
  expect(error).toBeTruthy();
});
```

Treat schemas as the source of truth for the API contract — they can drive OpenAPI generation later.

## Related Skills

- `modular-monolith-layout` — defines where `<domain>.validation.js` lives
- `domain-service-extraction` — extracted services should expect validated input
- `route-mounting-hygiene` — schemas are applied at the route definition
