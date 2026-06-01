---
name: shared-hooks-library
description: Build a reusable React hooks library (useApiState, usePagination, useDebounce, useFilters, useConfirmDialog, useToast) that eliminates boilerplate of useState plus useEffect plus axios in every page. Use when pages reimplement loading and error and refetch logic, when the user mentions React Query, SWR, server state, or asks to "stop duplicating data fetching" or "build shared hooks".
---

# Shared Hooks Library

## Purpose

Eliminate the `useState` + `useEffect` + raw `axios` triad that bloats every page component with loading / error / refetch boilerplate. Provide a small, focused set of hooks that pages compose.

Goal: a typical page goes from ~80 lines of fetching boilerplate to one hook call.

## When To Use

- Pages re-implement `useState(null)` → `useEffect(() => fetch(...))` → `setLoading` → `setError` patterns
- No state-fetching library exists in the project (no React Query, SWR, or RTK Query)
- User mentions "shared hooks", "stop duplicating loading state", "useApiState", or asks for a hooks layer
- Page decomposition needs a thin server-state layer before component extraction begins

If the project already uses React Query / SWR, **do not** introduce a parallel hook system. Use the existing tool.

## Target Hook Inventory

| Hook | Replaces | Priority |
|---|---|---|
| `useApiState(fetchFn, deps)` | `useState` + `useEffect` + axios in every page | Highest (do first) |
| `usePagination(defaultLimit)` | Inline pagination state in every list page | High |
| `useDebounce(value, delay)` | Inline timeout refs for search inputs | High |
| `useFilters(defaultFilters)` | Inline filter state + reset in every list page | High |
| `useConfirmDialog()` | Inline delete confirmation `useState`s | Medium |
| `useToast()` | Inline toast / snackbar imports | Medium |

Place under `core/hooks/`.

## useApiState — The Highest-ROI Hook

This single hook eliminates ~80% of fetching boilerplate.

```js
// core/hooks/useApiState.js
import { useState, useEffect, useCallback, useRef } from 'react';

export function useApiState(fetchFn, deps = []) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const abortRef = useRef(null);

  const refetch = useCallback(async () => {
    abortRef.current?.abort?.();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = controller;
    setLoading(true);
    try {
      const result = await fetchFn({ signal: controller?.signal });
      setData(result);
      setError(null);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setError(e?.response?.data?.message || e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    refetch();
    return () => abortRef.current?.abort?.();
  }, [refetch]);

  return { data, loading, error, refetch, setData };
}
```

**Usage pattern:**

```jsx
const { data, loading, error, refetch } = useApiState(
  ({ signal }) => fetchProducts(filters, { signal }),
  [filters],
);
```

## usePagination

```js
// core/hooks/usePagination.js
import { useState, useMemo, useCallback } from 'react';

export function usePagination(defaultLimit = 20) {
  const [page, setPage]   = useState(1);
  const [limit, setLimit] = useState(defaultLimit);

  const reset      = useCallback(() => setPage(1), []);
  const nextPage   = useCallback(() => setPage((p) => p + 1), []);
  const prevPage   = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);

  const params = useMemo(() => ({ page, limit }), [page, limit]);

  return { page, limit, params, setPage, setLimit, nextPage, prevPage, reset };
}
```

## useDebounce

```js
// core/hooks/useDebounce.js
import { useState, useEffect } from 'react';

export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
```

## useFilters

```js
// core/hooks/useFilters.js
import { useState, useCallback, useMemo } from 'react';

export function useFilters(defaultFilters = {}) {
  const [filters, setFilters] = useState(defaultFilters);

  const setFilter = useCallback(
    (key, value) => setFilters((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const reset = useCallback(() => setFilters(defaultFilters), [defaultFilters]);

  const hasActiveFilters = useMemo(
    () => Object.keys(filters).some((k) => filters[k] !== defaultFilters[k]),
    [filters, defaultFilters],
  );

  return { filters, setFilters, setFilter, reset, hasActiveFilters };
}
```

## useConfirmDialog

```js
// core/hooks/useConfirmDialog.js
import { useState, useCallback } from 'react';

export function useConfirmDialog() {
  const [state, setState] = useState({ open: false, config: null });

  const confirm = useCallback(
    (config) =>
      new Promise((resolve) => {
        setState({
          open: true,
          config: {
            ...config,
            onConfirm: () => { setState({ open: false, config: null }); resolve(true); },
            onCancel:  () => { setState({ open: false, config: null }); resolve(false); },
          },
        });
      }),
    [],
  );

  return { ...state, confirm };
}
```

Pair with the `ConfirmDialog` shared component.

## useToast

```js
// core/hooks/useToast.js
import { useCallback } from 'react';
import { toast } from 'react-hot-toast'; // or your toast lib

export function useToast() {
  const success = useCallback((msg, opts) => toast.success(msg, opts), []);
  const error   = useCallback((msg, opts) => toast.error(msg, opts), []);
  const info    = useCallback((msg, opts) => toast(msg, opts), []);
  return { success, error, info };
}
```

A thin wrapper keeps the toast library swappable.

## Before / After Comparison

**Before — every list page:**

```jsx
const [products, setProducts]     = useState([]);
const [loading, setLoading]       = useState(true);
const [error, setError]           = useState(null);
const [filters, setFilters]       = useState({});

useEffect(() => {
  let cancelled = false;
  setLoading(true);
  axios.get('/admin/products', { params: filters })
    .then((r) => { if (!cancelled) setProducts(r.data.data); })
    .catch((e) => { if (!cancelled) setError(e.message); })
    .finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, [filters]);
```

**After:**

```jsx
const { filters, setFilter } = useFilters({});
const { data, loading, error, refetch } = useApiState(
  ({ signal }) => fetchProducts(filters, { signal }),
  [filters],
);
```

## Implementation Rules

1. **Hooks live in `core/hooks/` only.** Module-scoped hooks (e.g., `useCart`) live under `modules/<role>/hooks/`.
2. **Hooks return objects, not arrays.** Easier to extend; consumers destructure named fields.
3. **`useApiState` always handles abort / cancellation.** Prevents setState-after-unmount warnings.
4. **`fetchFn` receives `{ signal }`.** API service functions accept and forward the signal to axios.
5. **Hooks never read from `window.location` or context.** Inputs come through parameters.
6. **Toast / dialog hooks are thin wrappers over the chosen library.** Keeps the library swappable.
7. **No hook owns business logic.** Hooks orchestrate state; business decisions live in service / domain code.
8. **Every hook ships with an example usage in its JSDoc.**

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| `useApiState` that doesn't return `refetch` | Pages re-implement refetch after every mutation | Always return `refetch` |
| Returning `[data, loading, error]` as a tuple | Hard to extend without breaking consumers | Return an object |
| Hook that captures `axios` instance internally | Couples hook to one HTTP client | Accept a `fetchFn` parameter |
| `useApiState` that re-runs on every render | Infinite loop | Wrap `fetchFn` in `useCallback`, depend on stable deps |
| Hook that throws on first render before data | Crashes pages on cold load | Return `{ data: null, loading: true }` initially |
| One-mega `useEverything` hook | Re-creates god-object pattern | Split per concern |
| Storing server data in a global store via the hook | Hidden global state | Keep state local to the consumer |

## Adoption Sequence

1. Ship `useApiState` first (highest impact).
2. Migrate **one** list page to it as a proof point.
3. Ship `usePagination`, `useFilters`, `useDebounce` (often used together with `useApiState`).
4. Ship `useConfirmDialog` and `useToast`.
5. Document the hooks in the project README; require them in code review for new pages.
6. Migrate existing pages opportunistically during `frontend-page-decomposition` sprints — never all at once.

## When To Reach For React Query Instead

This handcrafted hooks library is the right choice when:
- The team is small and a third-party dependency is unwelcome
- Server-state caching is not yet needed
- Backend already provides reasonable response times without client cache

Switch to React Query / SWR when:
- Multiple pages need the **same** server data with consistent freshness
- Optimistic updates are needed
- Mutations should automatically refetch related queries

Migration to React Query reuses the same call sites (`useApiState` → `useQuery`) with minimal page-level rewrite.

## Related Skills

- `frontend-page-decomposition` — page shells compose these hooks
- `shared-ui-component-extraction` — shared UI components pair with shared hooks
- `frontend-auth-role-store` — hooks never read `window.location`; role lookups use the store
