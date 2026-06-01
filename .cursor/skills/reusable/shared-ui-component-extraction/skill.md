---
name: shared-ui-component-extraction
description: Build a reusable React UI primitive library - DataTable, FilterBar, Modal, ConfirmDialog, StatusBadge, Pagination, FormField, LoadingSpinner, EmptyState - extracted from monolithic pages and promoted to shared/components/ui only after a second use case exists. Use when multiple pages re-implement the same table, modal, filter, status chip, or form patterns, or when the user asks for a "design system", "shared UI library", or "extract reusable component".
---

# Shared UI Component Extraction

## Purpose

Build a small, focused library of reusable UI primitives that replace inline implementations of tables, modals, filters, status chips, pagination controls, and form fields. Promoted to `shared/components/ui/` only after a **second** use case exists — never on first extraction.

This skill is the cross-page complement to `frontend-page-decomposition` (which handles **per-page** extraction).

## When To Use

- Two or more pages contain visibly similar table / modal / form / status patterns
- The user asks for "shared components", "UI library", "design primitives", or "stop duplicating tables"
- A `shared/components/` folder exists but holds fewer than 10 files for a large project
- During `frontend-page-decomposition` sprints, a component is extracted twice in different pages

## Target Inventory

Place under `shared/components/ui/`:

| Component | Replaces | Required Props (minimum) |
|---|---|---|
| `DataTable` | Inline `<table>` markup with sort + selection | `columns`, `data`, `rowKey`, `onRowClick?` |
| `FilterBar` | Inline filter row patterns | `filters`, `onChange`, `onReset?` |
| `Modal` | Inline modal state + Tailwind overlay | `open`, `onClose`, `title?`, `children` |
| `ConfirmDialog` | Inline delete confirmation patterns | `open`, `title`, `message`, `onConfirm`, `onCancel` |
| `StatusBadge` | Inline status chip with color logic | `status`, `variantMap?` |
| `Pagination` | Inline page/limit controls | `page`, `limit`, `total`, `onChange` |
| `FormField` | Inline `<label>` + `<input>` + error patterns | `label`, `name`, `error?`, `children` |
| `LoadingSpinner` | Inline spinner / loading text | `size?`, `label?` |
| `EmptyState` | Empty-list placeholder | `title`, `message?`, `action?` |

## The Promotion Rule

A component graduates to `shared/components/ui/` only after **all three** are true:

1. The component has been extracted in **two or more** pages
2. The component's props can be expressed without page-specific assumptions
3. The component has zero dependencies on a specific module's API or state

Premature promotion creates abstractions that later need to be rewritten because the second use case doesn't fit. Hold the component in `modules/<role>/components/` until proof exists.

## Component Contracts (Minimum Surface)

### DataTable

```jsx
<DataTable
  columns={[
    { key: 'id',     label: 'Order #', render: (row) => row.orderId },
    { key: 'amount', label: 'Total',   render: (row) => `₹${row.total}` },
    { key: 'status', label: 'Status',  render: (row) => <StatusBadge status={row.status} /> },
  ]}
  data={orders}
  rowKey={(r) => r._id}
  onRowClick={(r) => navigate(`/orders/${r._id}`)}
  loading={loading}
  emptyState={<EmptyState title="No orders yet" />}
/>
```

Implementation rules:
- Accepts a `columns` array, **not** JSX `<th>` children — easier to compute dynamically
- `render(row)` receives the row, returns the cell content
- `rowKey` is **always** required (stable React keys)
- Owns loading and empty-state branches internally

### Modal

```jsx
<Modal open={isOpen} onClose={close} title="Edit Product">
  <ProductForm initial={product} onSubmit={save} />
</Modal>
```

Implementation rules:
- Renders nothing when `open` is false (no `display: none`)
- Backdrop click and ESC key both trigger `onClose`
- Locks body scroll while open
- `<Modal.Footer>` / `<Modal.Body>` slots are optional but encouraged

### ConfirmDialog (built on Modal)

```jsx
const { confirm, ...dialogProps } = useConfirmDialog();

const handleDelete = async () => {
  const ok = await confirm({
    title: 'Delete product?',
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (ok) await deleteProduct(id);
};

return <ConfirmDialog {...dialogProps} />;
```

Pairs with the `useConfirmDialog` hook from `shared-hooks-library`.

### FilterBar

```jsx
<FilterBar
  fields={[
    { name: 'search',   type: 'text',   placeholder: 'Search orders' },
    { name: 'status',   type: 'select', options: STATUS_OPTIONS },
    { name: 'dateFrom', type: 'date' },
    { name: 'dateTo',   type: 'date' },
  ]}
  value={filters}
  onChange={setFilters}
  onReset={resetFilters}
/>
```

Generic `fields` array; same component handles every list page.

### StatusBadge

```jsx
<StatusBadge
  status={order.status}
  variantMap={{
    placed:    'info',
    accepted:  'primary',
    shipped:   'warning',
    delivered: 'success',
    cancelled: 'danger',
  }}
/>
```

If `variantMap` is not provided, falls back to a default mapping for common status strings.

### Pagination

```jsx
<Pagination
  page={page}
  limit={limit}
  total={data?.total ?? 0}
  onChange={(next) => setPage(next.page)}
/>
```

Pairs with `usePagination` from `shared-hooks-library`.

### FormField

```jsx
<FormField label="Email" name="email" error={errors.email}>
  <input
    type="email"
    value={form.email}
    onChange={(e) => setField('email', e.target.value)}
    className="..."
  />
</FormField>
```

Wraps any control; standardizes label position, error display, required asterisk.

## Implementation Rules

1. **One file per component.** `DataTable.jsx`, not `tables/index.js` with everything inside.
2. **Props are flat objects with primitives or simple arrays.** No "config" prop containing everything.
3. **No business-domain knowledge.** `DataTable` knows nothing about orders, products, or sellers.
4. **No data fetching inside primitives.** They receive data and callbacks from the parent.
5. **No routing imports.** No `useNavigate`, no `<Link>`. Parent passes `onClick` callbacks.
6. **Styling is internal and themable via Tailwind utility props or a `variantMap`.** No inline style overrides expected from callers.
7. **All primitives are accessible.** Modal traps focus; FormField links label to input via `htmlFor`; ConfirmDialog uses `role="alertdialog"`.
8. **Default exports for components, named exports for hooks / utilities.**
9. **TypeScript or PropTypes types ship with the component.** Documents the contract.
10. **Storybook stories optional but recommended.** Forces props to be testable in isolation.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Promoting on first use ("we'll need it elsewhere eventually") | Component is shaped for one page; second use exposes wrong abstraction | Wait for the second use |
| `DataTable` that fetches its own data | Cannot reuse with different fetch sources | Parent fetches, passes `data` |
| Component that takes a `render` prop covering 80% of its rendering | All the logic is back in the caller | Reduce surface; if everything is custom, no abstraction exists |
| Massive `config` prop with 30 fields | Hard to compose, easy to misuse | Flat props with sensible defaults |
| Modal that ignores ESC and backdrop click | Accessibility failure | Both close the modal |
| StatusBadge with hardcoded order-status colors | Not reusable for products, payouts, etc. | `variantMap` prop |
| FormField with built-in validation library coupling | Forces every page to use the same validator | Accept `error` string; validation happens elsewhere |
| Components imported via deep paths (`shared/components/ui/data-table/DataTable.jsx`) | Brittle | Single `index.js` re-exports all primitives |
| Two near-duplicate components (`Table` and `DataGrid`) | Reviewer / user confusion | One canonical name; deprecate the other |

## Extraction Workflow

```
Shared UI Extraction Progress:
- [ ] Step 1: Spot the duplicate pattern across two pages
- [ ] Step 2: Extract to one of the pages' module/components/ first
- [ ] Step 3: Use it in the second page; refine the props
- [ ] Step 4: When stable, promote to shared/components/ui/
- [ ] Step 5: Migrate the original module-scoped copies to import from shared/
- [ ] Step 6: Delete the module-scoped copies
- [ ] Step 7: Document props with TypeScript types or PropTypes
```

### Step 2 — First Extract Stays Local

If `ProductManagement.jsx` and `OrderList.jsx` both have a similar table, extract first into `modules/admin/components/shared/`. Do not jump straight to `shared/`.

### Step 4 — Promote After Stability

Once two consumers use the local component with identical (or near-identical) props, promote it. Update its file to `shared/components/ui/DataTable.jsx`. Add a re-export at the old location if needed (see `safe-refactor-strategy`).

## Composition Example

A list page after this skill is applied:

```jsx
export default function OrdersList() {
  const { filters, setFilters, reset } = useFilters({});
  const { page, limit, params, setPage } = usePagination(20);
  const { data, loading, refetch } = useApiState(
    ({ signal }) => fetchOrders({ ...filters, ...params }, { signal }),
    [filters, params],
  );
  const { confirm, ...dialogProps } = useConfirmDialog();

  const handleCancel = async (order) => {
    const ok = await confirm({
      title: 'Cancel order?',
      message: `Order ${order.orderId} will be cancelled.`,
      danger: true,
    });
    if (ok) { await cancelOrder(order._id); refetch(); }
  };

  return (
    <>
      <FilterBar fields={ORDER_FILTER_FIELDS} value={filters} onChange={setFilters} onReset={reset} />
      <DataTable
        columns={ORDER_COLUMNS(handleCancel)}
        data={data?.items}
        rowKey={(r) => r._id}
        loading={loading}
        emptyState={<EmptyState title="No orders match the filters" />}
      />
      <Pagination page={page} limit={limit} total={data?.total ?? 0} onChange={(n) => setPage(n.page)} />
      <ConfirmDialog {...dialogProps} />
    </>
  );
}
```

Page shell: ~30 lines. All primitives are framework-agnostic.

## When NOT To Extract

- The "similar" pattern is only similar at first glance — close inspection reveals different layouts, different states, different interactions
- The component is needed in only one place
- The pattern is so simple it does not justify the import overhead (e.g., a wrapper `<div>`)
- Tailwind utility classes already cover the use case adequately

## Related Skills

- `frontend-page-decomposition` — per-page extraction precedes shared promotion
- `shared-hooks-library` — `useConfirmDialog`, `usePagination`, `useFilters` pair with these primitives
- `safe-refactor-strategy` — re-export pattern when promoting from module to shared
