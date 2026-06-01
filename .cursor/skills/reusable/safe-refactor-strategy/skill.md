---
name: safe-refactor-strategy
description: Refactor production codebases using the wrap-and-improve philosophy with zero API breakage, independently deployable phases, and sub-5-minute rollback. Use when the user mentions refactoring, modernization, technical debt cleanup, migrating legacy code, breaking apart god objects, or asks for a safe refactor plan for a production system.
---

# Safe Refactor Strategy

## Purpose

Apply the **"wrap and progressively improve, not rewrite"** philosophy to evolve production codebases. Every change preserves runtime behavior, ships independently, and can be rolled back in under 5 minutes.

This skill is the master playbook for any non-trivial refactor. Other refactor skills (`domain-service-extraction`, `provider-adapter-pattern`, `infrastructure-domain-separation`, etc.) sit on top of these foundations.

## When To Use

Apply this skill whenever any of the following is true:

- The user asks for a "refactor plan", "modernization", "cleanup", or "decoupling"
- A file is over ~800 lines or a class has fan-out into 15+ modules
- The user wants to extract a service, swap a provider, or restructure folders
- A production system cannot tolerate downtime, regressions, or data loss
- The codebase has duplicate business logic, leaked infrastructure, or monolithic controllers/pages

Do **not** invoke this skill for greenfield prototypes, throwaway scripts, or single-developer experiments where rewrite is cheaper than wrap.

## The Three Non-Negotiable Rules

Every refactor change must satisfy all three rules. If any rule is violated, the change is rejected.

1. **Zero API breakage** — all existing HTTP endpoints, response shapes, event payloads, DB columns, and public function signatures are preserved.
2. **Independently deployable** — the change ships alone. It does not require a coordinated rollout with other refactors.
3. **Rollbackable in < 5 minutes** — reversible by reverting one file, flipping one env var, or switching one import. No DB migration on the rollback path.

## Compatibility Strategy

| Principle | Implementation |
|---|---|
| Keep existing exports | New files re-export from old paths during transition |
| Wrap, don't rename | Old functions become thin wrappers calling new implementations |
| Feature flags for risky changes | `process.env.FEATURE_*` guards new code paths |
| Dual-run pattern for critical flows | Run old + new in parallel, compare outputs, switch on confidence |
| Schema-backward-compatible changes | New fields are optional; never remove/rename existing fields first |

## The Three Core Patterns

### 1. The Wrapper Pattern (default for all extractions)

Use when extracting logic from a large file into a new service.

**Step 1 — Create the new service. Do not touch the old file.**

```js
// app/services/order/orderReturnService.js (NEW)
export async function createReturnRequest(customerId, orderId, payload) {
  // paste the extracted logic here verbatim
}
```

**Step 2 — Replace inline logic with a call to the new service.**

```js
// app/controller/orderController.js (UPDATED)
import { createReturnRequest } from '../services/order/orderReturnService.js';

export const requestReturn = async (req, res) => {
  try {
    const result = await createReturnRequest(req.user.id, req.params.orderId, req.body);
    return handleResponse(res, 200, 'Return request submitted', result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
```

**Step 3 — Verify with tests, then delete the dead inline copy.**

Zero breakage risk during Step 1 and Step 2. Rollback is a single-file revert.

### 2. The Re-Export Pattern (for folder reorganization)

Never break existing imports during a move.

```js
// Old location: app/services/cacheService.js   (KEEP THIS FILE)
// New location: app/infrastructure/cache/cacheService.js

// Old file becomes a shim:
export * from '../infrastructure/cache/cacheService.js';
```

All historical imports continue resolving. New code imports from the new path. The shim is deleted only after 100% of old imports are migrated and confirmed via grep.

### 3. The Feature Flag Pattern (for high-risk swaps)

Use for provider swaps, algorithm rewrites, or workflow changes.

```js
export function getActivePaymentProvider() {
  const providerName = process.env.PAYMENT_PROVIDER || 'phonepe';
  if (providerName === 'phonepe') return new PhonePeAdapter();
  if (providerName === 'razorpay') return new RazorpayAdapter();
  throw new Error(`Unknown payment provider: ${providerName}`);
}
```

Rollback = set env var back to previous value. Zero code change. Zero deploy.

## Rollout Strategy

```
Code Review → Staging Deploy → Smoke Test → 5% Canary →
Monitor 24h → 50% Canary → Monitor 12h → 100% → Remove old code
```

For **pure internal refactors** (no API/contract changes, no behavior change): skip canary, go staging → production with active monitoring.

For **provider swaps or behavior changes**: always canary, always feature-flag, always keep the old path warm for at least one full rollback window.

## Per-Phase Rollback Recipes

| Change Type | Rollback Mechanism |
|---|---|
| Backend service extraction | Keep old service file intact alongside new. Revert the controller's import. |
| Frontend component decomposition | Keep old page file as `.bak.jsx` or in branch. Revert route import. |
| Provider adapter swap | `.env` feature flag routes to old or new implementation. Flip and restart. |
| Folder restructure | Re-export shims at old paths keep imports working. Revert by re-adding shim. |
| Validation middleware add | Remove the middleware from the route definition. |
| Cache layer addition | Cache-miss path is identical to original behavior. Disable via env var. |

## Implementation Rules

1. **One refactor per pull request.** Never bundle unrelated extractions in the same PR — rollback scope explodes.
2. **Old code stays warm until new code is proven.** Delete the old path only after one full monitoring window (24h+ for risky changes).
3. **Tests before extraction.** If the extracted unit has no test, write one against the *old* code first. The new code must pass the same test.
4. **No DB migrations on the rollback path.** If a change requires a schema migration, design it as additive (new columns/fields are optional, old code ignores them).
5. **Feature flags default to the old behavior.** New code is opt-in via env var until proven.
6. **Re-exports stay until grep is clean.** A shim is only removed after `rg "old/path"` returns zero results across the repo.
7. **Never extract two unrelated handlers in the same PR.** Keep blast radius narrow.
8. **Document the rollback step in the PR description.** If the reviewer can't articulate the rollback, the PR is not mergeable.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Do This Instead |
|---|---|---|
| "Big bang rewrite" of a 2000-line controller in one PR | Untestable, unreviewable, unrollback-able | Strangler fig: one handler per PR |
| Renaming a public function during a move | Breaks every caller silently | Re-export shim under the old name |
| Removing an old endpoint as part of the new endpoint's PR | Couples two unrelated changes | New endpoint ships first, old removed in a later PR after callers migrate |
| Coupled deploy ("must deploy backend before frontend") | Fragile, partial outage on failure | Backend ships forward-compatible, frontend follows in next deploy |
| Deleting the old service file in the same PR that introduces the new one | No rollback path | Old file stays until next sprint, after monitoring confirms |
| Feature flag that defaults to the new behavior | Silent regression on deploy | Default to old, opt-in to new |
| Dropping a DB column as part of the refactor | Cannot roll back without restoring data | Stop writing to the column first, drop in a separate later PR |

## Example: Sequencing a God-Controller Breakup

A 2,000-line `orderController.js` with fan-out into 20+ modules.

**Do NOT** plan a single PR that extracts everything. Sequence it across sprints:

| Sprint | Extraction | Lines Removed | Rollback |
|---|---|---|---|
| 1 | `OrderReturnService` (return handlers) | ~300 | Revert one import |
| 2 | `OrderQueryService` additions (read handlers) | ~200 | Revert one import |
| 3 | `OrderCancellationService` | ~150 | Revert one import |
| 4 | `OrderPlacementService` refinement | ~250 | Revert one import |
| 5 | Final cleanup — remove dead helpers | ~100 | Revert one PR |

After 5 sprints, the controller is < 400 lines of pure HTTP adapter logic. Each sprint is independently shippable and rollbackable.

## Definition of Done for a Refactor

A refactor is complete when:

1. All three non-negotiable rules are satisfied for every shipped PR
2. No old → new shim has been removed before its callers are migrated
3. The old path has been monitored in production for at least one rollback window
4. Tests cover both the new implementation and any preserved compatibility shim
5. The PR description explicitly documents the rollback step
6. No business logic exists in two places after the cleanup phase

## Related Skills

- `coupling-cohesion-audit` — how to identify what to refactor
- `domain-service-extraction` — strangler fig for god controllers
- `provider-adapter-pattern` — ports/adapters for swappable dependencies
- `infrastructure-domain-separation` — splitting infra from domain code
- `modular-monolith-layout` — target folder structure
