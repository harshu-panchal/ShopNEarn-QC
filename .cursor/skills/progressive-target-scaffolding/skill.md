---
name: progressive-target-scaffolding
description: Stand up the *target* folder structure (barrels, re-export shims, empty index.js files, per-folder README migration tables) BEFORE moving any logic into it. Establishes the destination so subsequent extraction PRs are tiny and reviewable. Use when a refactor plan defines a target architecture but most of the actual extraction work still has to happen across many small PRs - typical mid-refactor state where Phase-1/2 cleanup is done but Phase-4/5 component+domain splits remain.
---

# Progressive Target Scaffolding

## Purpose

Make the *target* architecture **visible in the repo** before any real code
moves into it. The agent (or a human) creates:

1. The destination directory tree (empty if needed).
2. Barrel `index.js` files (initially empty or re-exporting).
3. Re-export shims at each target file path that forward to the still-canonical
   legacy implementation.
4. A `README.md` in every new directory listing the planned components and a
   migration-status table.

After this skill runs, **every future PR that extracts code** lands a single
file into a directory that already exists, with a README that already
references it. Reviewers see "fill in the blank" PRs instead of "invent a
new home + extract + wire it up in one go" PRs.

## When To Use

- Refactor plan exists with a clear target architecture (see
  `reusable/modular-monolith-layout/` for backend or
  `reusable/frontend-page-decomposition/` for frontend pages)
- Phase-1 cleanup is done but the bulk of extraction work remains
- The agent or team will land many small extraction PRs over multiple sprints
- Imports from "new" paths must already work so that the first extraction PR
  does not also have to invent the directory structure
- The user mentions "scaffold the target", "land the shape first", "set up
  the destination", "create the migration roadmap", or "barrel the new
  domains"

## When NOT To Use

- The refactor is small enough to do in one PR — just extract.
- No target architecture has been agreed on yet — first read
  `reusable/safe-refactor-strategy/` and `reusable/coupling-cohesion-audit/`.
- A directory already exists and has real code in it — adding more shims on
  top is noise. Only scaffold *empty* destinations.

## The Three Scaffold Primitives

### 1. Barrel Re-Export Shim (Backend)

Every new domain file at the target path becomes a one-line re-export of the
still-canonical legacy implementation:

```js
// app/domains/product/product.controller.js  (NEW — shim)
/**
 * Re-export shim — see `app/domains/README.md`.
 * Canonical implementation lives at `app/controller/productController.js`.
 */
export * from "../../controller/productController.js";
```

```js
// app/domains/product/index.js  (NEW — domain barrel)
export * as productController from "./product.controller.js";
export * from "./product.service.js";
export * as productValidation from "./product.validation.js";
export { default as productRoutes } from "./product.routes.js";
```

After this, *new* code can already write `import { productController } from
"@/domains/product"` even though no logic has moved yet. The first real
extraction PR just flips the implementation direction (canonical → shim).

### 2. Empty Component Barrel (Frontend)

For each oversized page, scaffold its per-page component directory with an
empty barrel:

```js
// frontend/src/modules/customer/components/checkout/index.js
/**
 * Barrel for checkout-page sub-components.
 *
 * Currently empty — components are added one at a time as
 * `CheckoutPage.jsx` is decomposed. Each extraction is one PR.
 *
 *   export { default as AddressStep } from './AddressStep';
 */
export {};
```

### 3. Migration-Status README

Every scaffolded directory gets a `README.md` that lists the planned
contents and tracks status:

```md
# `modules/customer/components/checkout/`

Per-page subcomponent home for `pages/CheckoutPage.jsx` (43 KB today).
Scaffolded in refactor P4.4 — decomposition is incremental, one PR per file.

## Target layout

```
├── AddressStep.jsx          # address picker + add-new-address flow
├── PaymentStep.jsx          # ONLINE / COD / WALLET selector
├── OrderSummary.jsx         # cart + pricing breakdown + tip
├── CouponInput.jsx          # coupon code apply/remove
└── index.js                 # barrel re-exports
```

## Migration status

| Component         | Status     |
| ----------------- | ---------- |
| Scaffolding       | complete   |
| AddressStep.jsx   | pending    |
| PaymentStep.jsx   | pending    |
| OrderSummary.jsx  | pending    |
| CouponInput.jsx   | pending    |
```

## Workflow

Copy this checklist into the PR description:

```
PROGRESSIVE TARGET SCAFFOLDING — pre-flight

[ ] Target architecture confirmed (link to plan doc)
[ ] Each NEW directory has a README listing planned files + status table
[ ] Each NEW file is a re-export shim OR an empty barrel
[ ] No business logic moved in this PR
[ ] Imports from BOTH the legacy path AND the new target path resolve
[ ] Lint + node --input-type=module smoke-imports all new paths
[ ] Master README updated with new scaffolds (e.g. domains/README.md)
[ ] PR diff is "additions only" — no deletions, no edits to existing logic
```

## Detailed Steps

### Backend domain scaffold

For each domain `<entity>` in the plan that does not yet have a folder:

1. Create `app/domains/<entity>/`.
2. Add four shim files, each one-line re-exporting the canonical file:
   - `<entity>.controller.js` → `../../controller/<entity>Controller.js`
   - `<entity>.service.js` → aggregate `export *` of related services
   - `<entity>.validation.js` → `../../validation/<entity>Validation.js`
   - `<entity>.routes.js` → `../../routes/<entity>Routes.js`
3. Add `index.js` barrel that re-exports the four shims under namespaced
   names so consumers get one import surface.
4. Update `app/domains/README.md` migration table: status `shim scaffold
   complete`.

### Frontend per-page component scaffold

For each oversized page (≥ 20 KB) in the plan:

1. Create `<module>/components/<page-name>/`.
2. Add `index.js` exporting an empty object (`export {};`) with a comment
   listing the export pattern for future contributors.
3. Add `README.md` with target layout + migration-status table.
4. Optionally extract truly trivial utilities (status-color maps, formatter
   functions) into a `<thing>Utils.js` first — these are zero-risk and
   prove the directory is wired correctly.

### Per-module hook scaffold

If the page being decomposed needs custom hooks (e.g., `useCheckout` for a
two-step preview/place flow), scaffold `<module>/hooks/` with:

1. The two or three highest-value hooks for the upcoming decomposition.
2. An `index.js` barrel.
3. Do **not** shadow existing context hooks (e.g., `useCart` already exported
   by `CartContext`). Pick a different name or skip the hook.

## Anti-Patterns

| Anti-pattern | Why it's bad | Fix |
| --- | --- | --- |
| Move the real implementation while scaffolding | Couples extraction risk with structural risk. | Scaffolding PR is **additions only**. Real moves are separate PRs. |
| Empty directory with no README | Future agents have no context. The directory looks abandoned. | Always add a migration-status README. |
| Shim with TODO comments instead of a real re-export | Imports fail. The shim must be runnable. | One-line `export * from` or `export { default } from`. |
| Scaffold a domain that has zero planned content | Adds noise. | Only scaffold domains the plan explicitly lists. |
| Shadow an existing hook / component name | Silent name collision; consumers get the wrong export. | `grep` for the symbol first. If it exists, pick a different name. |

## Verification

After scaffolding, run a smoke import in Node (or your test runner):

```bash
node --input-type=module -e "Promise.all([
  import('./backend/app/domains/product/index.js'),
  import('./backend/app/domains/seller/index.js'),
  import('./backend/app/domains/customer/index.js'),
]).then(arr => console.log('OK', arr.map(m => Object.keys(m).length)))"
```

Every barrel should resolve and report a positive key count. Zero linter
errors. Existing call sites unchanged.

## Relationship to other skills

| Skill | How this complements it |
| --- | --- |
| `reusable/modular-monolith-layout` | That skill defines the *target shape*. This skill *lands the shape* before code fills it. |
| `reusable/safe-refactor-strategy` | Wrap-and-improve says "old keeps working." This skill makes the new path also work from day one, before any wrapping. |
| `reusable/domain-service-extraction` | Run that skill AFTER scaffolding — the destination it needs is already there. |
| `reusable/frontend-page-decomposition` | Run that skill AFTER scaffolding — `components/<page>/` directory and README already exist. |
| `reusable/infrastructure-domain-separation` | Same pattern (re-export shims). This skill generalizes it to any new directory. |

## When the scaffold is no longer needed

Once **every** planned file in a scaffolded directory has been filled in
with real logic (and the README status table is all `complete`), the
README's migration table can be removed and the scaffolding skill stops
being relevant for that directory. The barrel `index.js` stays — it is now
a real export point, not a placeholder.
