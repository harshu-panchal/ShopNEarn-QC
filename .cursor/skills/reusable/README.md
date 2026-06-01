# Reusable Engineering Skills

Long-lived patterns and methodologies. Consult these on every relevant PR;
they are evergreen and apply to all future work, not just one migration.

## Architecture & refactor discipline

| Skill | Use when |
| --- | --- |
| `safe-refactor-strategy/` | Any non-trivial refactor — the master playbook (wrap & improve, < 5 min rollback). |
| `coupling-cohesion-audit/` | Periodic architecture review or "where should I start?" questions. |
| `modular-monolith-layout/` | Deciding where a new backend file goes — `domains/<entity>/` for business logic, `infrastructure/<kind>/` for plumbing. |
| `infrastructure-domain-separation/` | A domain service is about to import a vendor SDK or `getRedisClient()` directly — stop and wrap it in `infrastructure/`. |
| `provider-adapter-pattern/` | Adding a second payment / SMS / push provider, or wrapping a new SDK behind a port. |
| `domain-service-extraction/` | A controller or service grows past ~500 lines or 15 imports. Several controllers in this repo (`orderController.js` ~1300 lines, `deliveryController.js` ~770 lines) are still candidates. |

## Database & data integrity

| Skill | Use when |
| --- | --- |
| `mongoose-ref-integrity/` | A `populate()` returns `null`, a `ref:` string doesn't match a registered model, or before any model rename. Owns the boot-time `assertAllModelsRegistered` guard. |
| `mongoose-transaction-wrap/` | Converting any multi-document write into a `withTransaction()` block. Phase 2 of the database audit plan lives here. |
| `wallet-ledger-atomicity/` | Any wallet movement. Enforces "no Wallet change without a matching LedgerEntry in the same session". |
| `polymorphic-discriminator-discipline/` | Adding or auditing a `refPath`-backed field (`userModel`, `recipientModel`, `actorType`, etc.). Owns the shared `refModels.js` enum. |
| `legacy-field-deprecation/` | Retiring a duplicated field (`Order.payment.*`, `User.walletBalance`, the `Transaction` collection). Strict sync-hook + soak + drop sequence. |
| `soft-delete-cascade-pattern/` | Adding `deletedAt`/`deletedBy`/`updatedBy` and a `pre('find')` filter to a model, or defining a cascade on user/product soft-delete. |
| `idempotent-data-migration/` | Writing any data migration script — discriminator backfills, Wallet/LedgerEntry backfills, index drops. Owns the dry-run + verify + resume template. |
| `db-performance-hardening/` | Adding indexes (via `databaseIndexManager.js`), wrapping reads in `cacheService.getOrSet`, or propagating `correlationId`. |

## HTTP boundary

| Skill | Use when |
| --- | --- |
| `validation-middleware-standard/` | Any new HTTP endpoint or any controller still using inline `validateWithJoi(...)`. Schemas live under `app/validation/`. |

## Realtime & production reliability

| Skill | Use when |
| --- | --- |
| `realtime-architecture-audit/` | Auditing sockets, Firebase RTDB, Redis/Bull queues, notifications, delivery tracking, OTP workflows, polling fallbacks, or multi-node scaling. Produces a prioritized findings report with root cause / impact / exact fix / phased plan / refactor guidance and a production-readiness score. |

## Frontend

| Skill | Use when |
| --- | --- |
| `frontend-page-decomposition/` | A page JSX file exceeds ~300 lines / 15 KB. Many oversized pages remain (`ProductManagement.jsx` 80 KB, `Orders.jsx` 64 KB, `CheckoutPage.jsx` 43 KB, …). |
| `shared-hooks-library/` | Adding a new reusable hook (`useApiState`, `usePagination`, …). New hooks land under `frontend/src/shared/hooks/`. |
| `shared-ui-component-extraction/` | Promoting an inline UI primitive to `frontend/src/shared/components/ui/` — only after a second consumer exists. |

## Reading order for new contributors

1. `safe-refactor-strategy/` — the philosophy.
2. `modular-monolith-layout/` — where files go.
3. `coupling-cohesion-audit/` — how to spot problems.
4. For database-touching work: read `mongoose-ref-integrity/`, `mongoose-transaction-wrap/`, `wallet-ledger-atomicity/` in order before opening a PR.
5. Then dive into the specific skill that matches the task at hand.

## Pairing with the audit plan

The seven database skills above are the reusable engineering methodologies behind the multi-PR migration in `database_audit_plan_part1.md` … `part4.md`. The top-level `.cursor/skills/db-audit-execution-playbook/` skill orchestrates that migration phase-by-phase and points back at the skill that owns each phase's pattern.
