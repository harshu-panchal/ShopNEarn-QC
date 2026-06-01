---
name: frontend-auth-role-store
description: Replace fragile window.location.pathname-based role detection in React apps with a single in-memory activeRoleStore that the router sets on mount and that AuthContext, axios interceptors, and guards all read from. Use when multiple places independently derive the current role from URLs, when route renames silently break auth, or when the user mentions "auth role detection", "axios token picker", or "auth context coupled to URL".
---

# Frontend Auth Role Store

## Purpose

Stop deriving the active user role from `window.location.pathname` in multiple places (axios interceptor, AuthContext, guards). Centralize it into a single `activeRoleStore` that the router sets on mount. Every other module reads from the store. Route renames no longer silently break auth.

## When To Use

- `axios.js` (or interceptor) reads `window.location.pathname` to pick the auth token
- `AuthContext` also reads `window.location.pathname` via a helper like `getCurrentRoleFromUrl()`
- Tokens are stored per role under different localStorage keys (`adminToken`, `sellerToken`, `customerToken`)
- A route rename or URL prefix change has silently broken auth in the past
- The user asks to "fix auth role coupling", "remove window.location from auth", or "centralize active role"

## The Problem Pattern

```js
// core/api/axios.js — reads URL directly
const role = window.location.pathname.startsWith('/admin')   ? 'admin'
           : window.location.pathname.startsWith('/seller')  ? 'seller'
           : 'customer';
const token = localStorage.getItem(`${role}Token`);

// core/context/AuthContext.jsx — independently reads URL
function getCurrentRoleFromUrl() {
  const p = window.location.pathname;
  if (p.startsWith('/admin'))  return 'admin';
  if (p.startsWith('/seller')) return 'seller';
  return 'customer';
}
```

Two truth sources. Any URL prefix change has to be made in both places. SSR / non-browser contexts (server-rendered, tests) break.

## The Solution: activeRoleStore

A single module, no React, no globals beyond a module-scoped variable.

```js
// core/auth/activeRoleStore.js
let _activeRole = 'customer';
const _listeners = new Set();

export function getActiveRole() {
  return _activeRole;
}

export function setActiveRole(role) {
  if (role === _activeRole) return;
  _activeRole = role;
  for (const fn of _listeners) {
    try { fn(role); } catch { /* listener errors must not break callers */ }
  }
}

export function subscribeActiveRole(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export const ROLES = Object.freeze({
  ADMIN:    'admin',
  SELLER:   'seller',
  DELIVERY: 'delivery',
  CUSTOMER: 'customer',
});
```

## Wire-Up Per Layer

### 1. Router — Sets The Role On Mount

Each module's top-level route component sets the role on mount.

```jsx
// modules/admin/routes/AdminRoutes.jsx
import { useEffect } from 'react';
import { setActiveRole, ROLES } from '../../../core/auth/activeRoleStore';

export default function AdminRoutes() {
  useEffect(() => { setActiveRole(ROLES.ADMIN); }, []);
  return <Routes>{/* admin routes */}</Routes>;
}
```

Repeat for `SellerRoutes`, `DeliveryRoutes`, `CustomerRoutes`.

### 2. Axios Interceptor — Reads From The Store

```js
// core/api/axios.js
import axios from 'axios';
import { getActiveRole } from '../auth/activeRoleStore';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config) => {
  const role = getActiveRole();
  const token = localStorage.getItem(`${role}Token`);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
```

No `window.location` reference.

### 3. AuthContext — Reads From The Store

```jsx
// core/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { getActiveRole, subscribeActiveRole } from '../auth/activeRoleStore';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [role, setRole] = useState(getActiveRole());
  const [user, setUser] = useState(() => loadUserForRole(getActiveRole()));

  useEffect(() => {
    return subscribeActiveRole((next) => {
      setRole(next);
      setUser(loadUserForRole(next));
    });
  }, []);

  // login / logout helpers operate on `role` from the store
  return <AuthContext.Provider value={{ role, user, /* ... */ }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
```

### 4. Guards — Read From The Store

```jsx
// core/guards/RoleGuard.jsx
import { getActiveRole } from '../auth/activeRoleStore';

export function RoleGuard({ allow, children, fallback }) {
  const role = getActiveRole();
  return allow.includes(role) ? children : (fallback ?? null);
}
```

## Migration Workflow

```
Auth Role Store Migration Progress:
- [ ] Step 1: Create core/auth/activeRoleStore.js
- [ ] Step 2: Set active role from each module's top-level route component
- [ ] Step 3: Update axios interceptor to read from the store
- [ ] Step 4: Update AuthContext to subscribe to the store
- [ ] Step 5: Update guards to read from the store
- [ ] Step 6: Remove all window.location.pathname auth derivation
- [ ] Step 7: Test login / logout / cross-role navigation
```

### Step 1 — Create The Store

Drop in the module above. No behavior change yet.

### Step 2 — Set The Role From The Router

Each role's top-level route file calls `setActiveRole(ROLES.X)` in a `useEffect`. This happens before the user lands on any page in that module.

### Step 3-5 — Update Consumers

Replace every `window.location.pathname.startsWith('/x')` with `getActiveRole() === 'x'`.

### Step 6 — Remove Old Code

Grep:

```bash
rg "window\.location\.pathname" src/core/api src/core/context src/core/guards
```

Should return zero results when migration is complete.

### Step 7 — Test Matrix

| Scenario | Expected |
|---|---|
| Login as admin | `getActiveRole() === 'admin'`, admin token attached to API calls |
| Switch to seller portal via in-app nav | Role updates, seller token attached |
| Logout | Role-specific token cleared; other roles' tokens untouched |
| Hard reload on `/admin/orders` | Router mounts `AdminRoutes`, `setActiveRole('admin')` fires |
| Server-rendered initial state | `getActiveRole()` returns default `'customer'`; no `window` access |

## Implementation Rules

1. **One module owns the role.** Other modules import `getActiveRole` / `setActiveRole`.
2. **Role is set by the router, not by URL parsers in random places.**
3. **No `window.location.pathname` in `core/api/`, `core/context/`, or `core/guards/`.**
4. **Token storage keys are derived from the role:** `${role}Token`. Never hardcoded per call site.
5. **The store is a module singleton.** Do not put it in React context (would force a Provider in every test).
6. **Components that need to react to role changes subscribe via `subscribeActiveRole`.** Non-React consumers (axios) read on demand.
7. **`ROLES` is a frozen enum.** No string literals scattered through call sites.
8. **Default role is the most public one** (usually `'customer'`) — safest fallback before the router has mounted.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Putting the active role in React context only | Non-React modules (axios interceptor) can't read it | Module-scoped store + optional subscribe |
| Setting active role inside a deep page component | Race conditions when navigating between portals | Set in the top-level route module |
| Reading `window.location.pathname` "just for one helper" | Re-introduces the dual truth source | Use `getActiveRole()` |
| Hardcoded token keys per role at every call site | Adding a new role requires touching every call site | Derive from role |
| Storing the active role in localStorage | Stale role after logout in another tab | Keep in-memory; rebuild from router on mount |
| Replacing the store with a global `window.__activeRole` | Pollutes globals; same coupling, new disguise | Module-scoped variable |
| Setting active role from a custom hook the user has to import everywhere | High friction; easy to forget | Router sets it once at the boundary |

## Worked Example: Before / After

**Before — `axios.js`:**

```js
import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config) => {
  const p = window.location.pathname;
  const role = p.startsWith('/admin')    ? 'admin'
             : p.startsWith('/seller')   ? 'seller'
             : p.startsWith('/delivery') ? 'delivery'
             : 'customer';
  const token = localStorage.getItem(`${role}Token`);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

**After — `axios.js`:**

```js
import axios from 'axios';
import { getActiveRole } from '../auth/activeRoleStore';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config) => {
  const role = getActiveRole();
  const token = localStorage.getItem(`${role}Token`);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

Same behavior. Single source of truth. URL prefix changes no longer touch this file.

## Multi-Tab / Cross-Tab Behavior

The store is per-tab. Each tab independently calls `setActiveRole` based on its mounted router. This is the desired behavior — two tabs can be open in different portals at the same time without interfering.

If global "logged out everywhere" behavior is needed, hook into a `storage` event listener separately. That concern is **not** the role store's responsibility.

## Testing The Store

```js
import { getActiveRole, setActiveRole, ROLES } from './activeRoleStore';

afterEach(() => setActiveRole(ROLES.CUSTOMER));

test('switches role and notifies subscribers', () => {
  const seen = [];
  const unsub = subscribeActiveRole((r) => seen.push(r));
  setActiveRole(ROLES.ADMIN);
  setActiveRole(ROLES.SELLER);
  expect(seen).toEqual(['admin', 'seller']);
  unsub();
});
```

No DOM, no React, no router. Pure unit tests.

## Related Skills

- `frontend-page-decomposition` — page shells should not read `window.location` for auth either
- `shared-hooks-library` — `useAuth` hook may wrap the store for component-friendly access
- `safe-refactor-strategy` — migrate per consumer, one PR at a time
