---
name: frontend-page-decomposition
description: Decompose monolithic React page files (40 KB - 80 KB single-file pages) into composable per-page components using the in-place extraction pattern. Page shell ends at < 300 lines, all sub-components live in module/components/<page-name>/. Use when a JSX page file exceeds 20 KB, when the user mentions "decompose page", "break apart component", "split JSX", or when reviewing oversized React page components.
---

# Frontend Page Decomposition

## Purpose

Break monolithic React page files (often 40 KB - 80 KB single JSX files containing tables, filters, modals, forms, and business logic) into composable per-page components. The page shell becomes a thin layout that composes components and wires hooks.

## When To Use

- A page file exceeds **300 lines** or **15 KB**
- A page mixes data fetching, table rendering, modal state, form logic, and filter state in one file
- The user asks to "split", "decompose", "refactor page", "break apart component", or "extract components from page"
- A page is impossible to code-review in a single pass

## Target Shape

```jsx
// modules/admin/pages/ProductManagement.jsx  (~150 lines max)
import { useState } from 'react';
import { useApiState } from '../../../core/hooks/useApiState';
import { fetchProducts } from '../services/products.api';
import ProductFilters from '../components/products/ProductFilters';
import ProductListTable from '../components/products/ProductListTable';
import ProductFormModal from '../components/products/ProductFormModal';

export default function ProductManagement() {
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const { data, loading, refetch } = useApiState(() => fetchProducts(filters), [filters]);

  return (
    <>
      <ProductFilters value={filters} onChange={setFilters} />
      <ProductListTable
        data={data}
        loading={loading}
        onEdit={setEditing}
        onDelete={refetch}
      />
      {editing && (
        <ProductFormModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={refetch}
        />
      )}
    </>
  );
}
```

## Decomposition Workflow

**The cardinal rule: decompose in place. Never create a parallel new page and delete the old one in the same PR.**

Copy this checklist:

```
Decomposition Progress:
- [ ] Step 1: Map sub-concepts inside the monolithic page
- [ ] Step 2: Create module/components/<page-name>/ directory
- [ ] Step 3: Extract one sub-component, import it back immediately
- [ ] Step 4: Smoke test, ship
- [ ] Step 5: Repeat for the next sub-component
- [ ] Step 6: When page shell is < 300 lines, decomposition is complete
```

### Step 1 — Map Sub-Concepts

Read the file once. Identify visually and functionally distinct regions:

| Sub-Concept Type | Examples |
|---|---|
| Filters / search | `*Filters.jsx`, `*SearchBar.jsx` |
| Lists / tables | `*ListTable.jsx`, `*Grid.jsx`, `*Card.jsx` |
| Forms / modals | `*FormModal.jsx`, `*EditDrawer.jsx` |
| Detail panes | `*DetailsPanel.jsx`, `*PreviewCard.jsx` |
| Action bars | `*BulkActions.jsx`, `*ActionButtons.jsx` |
| Timelines / status | `*StatusTimeline.jsx`, `*StatusBadge.jsx` |
| Charts | `*Chart.jsx`, `*Summary.jsx` |

Aim for **5 - 8** components per large page. Fewer = under-decomposed. More = micro-fragmentation.

### Step 2 — Create The Components Directory

```
modules/<role>/components/<page-name>/
```

Group by page, not by component type. Example:

```
modules/admin/components/
  products/
    ProductListTable.jsx
    ProductFilters.jsx
    ProductFormModal.jsx
    ProductImageUpload.jsx
    ProductBulkActions.jsx
    ProductModerationCard.jsx
  orders/
    AdminOrdersTable.jsx
    AdminOrderFilters.jsx
```

Cross-page reusables go to `shared/components/ui/` (see `shared-ui-component-extraction`).

### Step 3 — Extract One Sub-Component

Pull a single cohesive region out into its own file. Pass the data and callbacks it needs as props.

**Extraction recipe:**

1. Cut the JSX block.
2. Identify every state/prop the block references.
3. Convert those into props on the new component.
4. Replace the cut region in the page with `<NewComponent ...props />`.

Page still works after every PR — that is the invariant.

### Step 4 — Smoke Test

Click through the page in dev. Verify all interactions still work. Ship the PR.

### Step 5 — Repeat

Pick the next sub-concept. One per PR. Per sprint, 1 - 2 extractions per page.

### Step 6 — Stop When The Shell Is Thin

A finished page shell:
- Holds top-level state (filters, selected row, modal open/close)
- Composes 5 - 8 components
- Wires hooks (`useApiState`, `usePagination`, etc.)
- Is under 300 lines

Do not extract further once the shell is thin. Over-decomposition makes navigation harder than under-decomposition.

## Implementation Rules

1. **Decompose in place.** Never create a new parallel page; the old page lives until extractions are done in it.
2. **One extraction per PR.** Multiple extractions in one PR explode review and rollback scope.
3. **Components take props, not module imports for data.** Data fetching stays in the page (or in a hook).
4. **Page-scoped components live next to the page module**, not in `shared/`.
5. **Truly reusable components are promoted later.** Wait until a second use case exists before moving to `shared/`.
6. **No inline modals in page files past the first extraction sprint.** Modals are their own component.
7. **Form components own their own form state.** Page passes `initialValue` + `onSubmit`.
8. **Components are < 200 lines.** Past that, extract further.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| New page file alongside the old one ("v2") | Two truth sources; merges break both | Decompose in place |
| Extracting 5 components in one PR | Unreviewable | One per PR |
| Components that import the page's hook | Circular dependency hazard | Page owns the hook, passes data as prop |
| Component depending on `useNavigate()` directly | Reduces reusability, harder to test | Page handles navigation, passes callback |
| Components mutating shared module state via context | Re-creates god-object pattern via context | State stays in page; child uses callback |
| Promoting to `shared/` on first extraction | Premature generalization | Wait for the second use case |
| `<PageThingThatDoesAllThings />` god component | Just relocates the god object | Decompose by visual region |
| Extracting purely visual snippets (a `<div>` wrapper) | Adds ceremony without cohesion benefit | Extract only when the region has its own logic, state, or > 30 lines |

## Worked Example: ProductManagement (80 KB → 15 KB)

**Before:** one file containing filter state, table rendering, form state, upload state, moderation flow, bulk actions — all inline.

**Extraction sequence (5 PRs over 5 sprints):**

| PR | Extract | Net Lines Removed | Page Shell After |
|---|---|---|---|
| 1 | `ProductListTable.jsx` | ~400 | ~1,800 |
| 2 | `ProductFormModal.jsx` | ~500 | ~1,300 |
| 3 | `ProductFilters.jsx` | ~200 | ~1,100 |
| 4 | `ProductImageUpload.jsx` | ~300 | ~800 |
| 5 | `ProductBulkActions.jsx` + `ProductModerationCard.jsx` | ~600 | ~200 |

After PR 5: page shell is < 200 lines, six focused components live in `modules/admin/components/products/`, each independently testable.

## Page Shell Pattern (Reusable)

Every finished page shell follows this structure:

```jsx
export default function <Page>() {
  // 1. URL params / route state
  const params = useParams();

  // 2. Local UI state
  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(null);

  // 3. Server state via shared hook
  const { data, loading, error, refetch } = useApiState(
    () => fetch<Entity>(filters),
    [filters],
  );

  // 4. Early returns for loading / error
  if (loading && !data) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} />;

  // 5. Composition of extracted components
  return (
    <>
      <<Entity>Filters value={filters} onChange={setFilters} />
      <<Entity>Table data={data} onSelect={setSelected} />
      {selected && (
        <<Entity>FormModal
          entity={selected}
          onClose={() => setSelected(null)}
          onSaved={refetch}
        />
      )}
    </>
  );
}
```

## What Stays In The Page Shell

- Top-level routing concerns (`useParams`, `useNavigate`)
- Filter / pagination / selection state
- One server-state hook call
- Composition of child components
- Error and loading branches

## What Leaves The Page Shell

- Table / grid rendering
- Form fields and form validation
- Modal contents
- Upload logic
- Charts and summary cards
- Bulk action menus

## Related Skills

- `shared-hooks-library` — `useApiState`, `usePagination`, `useFilters` for the page shell
- `shared-ui-component-extraction` — promote truly cross-page reusables to `shared/components/ui/`
- `frontend-auth-role-store` — replace `window.location.pathname` checks if found during extraction
- `safe-refactor-strategy` — the in-place migration rule applies here too
