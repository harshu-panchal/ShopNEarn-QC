/**
 * activeRoleStore
 *
 * Single in-memory source of truth for "which portal is the user currently
 * inside" (customer / seller / admin / delivery). Replaces the fragile,
 * duplicated `window.location.pathname.startsWith('/admin')` checks scattered
 * across the axios interceptor and AuthContext (TC-04 in the refactor plan).
 *
 * Wired up via:
 *   - Each module's top-level route component calls `setActiveRole(...)` in
 *     a useEffect on mount.
 *   - axios interceptor reads `getActiveRole()` when picking the bearer token.
 *   - AuthContext subscribes to changes so UI re-renders when the role flips.
 *
 * Multi-tab semantics: per-tab. Two tabs in different portals are independent.
 *
 * For backward-compatibility during the migration, both the new store and
 * the legacy window.location.pathname inference still work. The store always
 * wins when it has a non-default value; if no router has yet mounted (e.g.
 * very first render before App mounts), callers fall back to URL inference.
 */

export const ROLES = Object.freeze({
    ADMIN: 'admin',
    SELLER: 'seller',
    DELIVERY: 'delivery',
    CUSTOMER: 'customer',
});

let _activeRole = null;
const _listeners = new Set();

function inferRoleFromUrl() {
    if (typeof window === 'undefined') return ROLES.CUSTOMER;
    const path = window.location.pathname;
    if (path.startsWith('/seller')) return ROLES.SELLER;
    if (path.startsWith('/admin')) return ROLES.ADMIN;
    if (path.startsWith('/delivery')) return ROLES.DELIVERY;
    return ROLES.CUSTOMER;
}

/**
 * Returns the current role. If no router has explicitly set the role yet,
 * falls back to URL inference for the very first call.
 */
export function getActiveRole() {
    if (_activeRole != null) return _activeRole;
    return inferRoleFromUrl();
}

/**
 * Sets the active role. Idempotent — does nothing if the role hasn't changed.
 * Errors thrown by listeners are swallowed so a buggy subscriber cannot break
 * the router or the request pipeline.
 */
export function setActiveRole(role) {
    if (!role) return;
    if (role === _activeRole) return;
    _activeRole = role;
    for (const fn of _listeners) {
        try {
            fn(role);
        } catch {
            // listener failures must not break the caller
        }
    }
}

export function subscribeActiveRole(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

/** Test helper. Resets store state between tests. */
export function __resetActiveRoleForTests() {
    _activeRole = null;
    _listeners.clear();
}
