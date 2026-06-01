# `app/domains/`

Target home for the **modular monolith** layout described in refactor Phase 5
of the plan and in the `modular-monolith-layout` skill.

Each subdirectory represents one domain (order, delivery, product, seller,
...) and bundles the four cross-cutting concerns for that domain:

```
app/domains/<entity>/
├── <entity>.controller.js   # HTTP adapter (thin)
├── <entity>.service.js      # domain logic (the workhorse)
├── <entity>.validation.js   # Joi schemas + validate(...) middleware
├── <entity>.routes.js       # Express Router that wires the above
└── index.js                 # barrel export for the domain
```

## Current state — namespace scaffold

This directory was scaffolded in refactor P5.1 / P5.3 to establish the
namespace **without moving any files yet**. Each domain file is a re-export
shim that points at the canonical location under `app/controller/`,
`app/services/`, `app/validation/`, and `app/routes/`.

Two import paths therefore both work today:

```js
// legacy (unchanged):
import orderController from '../controller/orderController.js';

// new (preferred for new code):
import { orderController } from '@/domains/order';
```

When the codebase is ready, individual files can be flipped: implementation
moves into `domains/<entity>/`, and the file under `controller/` becomes the
shim. The reverse direction is also valid. This bidirectional shim is the
core of the "Wrap & Improve" safety net.

## Domains scaffolded so far

| Domain        | Status |
| ------------- | ------ |
| order         | shim scaffold complete (P5.1) |
| delivery      | shim scaffold complete (P5.1) |
| product       | shim scaffold complete (P5.1 Part 3) |
| seller        | shim scaffold complete (P5.1 Part 3) |
| customer      | shim scaffold complete (P5.1 Part 3) |
| payment       | shim + provider port/registry (P3.1–P3.3 / P5.1 Part 3) |
| finance       | shim scaffold complete (P5.1 Part 3) |
| notification  | shim scaffold complete (P5.1 Part 3) |
| otp           | shim scaffold complete (P5.1 Part 3) |
| workflow      | Already domain-scoped under `services/workflow/` |

## When adding a NEW domain

Prefer building the new domain directly under `app/domains/<entity>/`.
No shim needed. Existing code can reach into the new domain via the barrel.

## How to import from a domain

All domains expose a single `index.js` barrel. New code SHOULD prefer
importing from the barrel:

```js
import { orderController, OrderReturnService } from "@/domains/order";
import { productController } from "@/domains/product";
import { paymentController, getActivePaymentProvider } from "@/domains/payment";
import { financeController, processPayout, creditWallet } from "@/domains/finance";
```

Legacy import paths (`controller/orderController.js`, `services/finance/...`,
`modules/notifications/...`) continue to work unchanged. Migration is
incremental — flip individual files as you touch them.
