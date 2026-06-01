/**
 * storage.js — centralized client-side storage manager.
 *
 * Solves the long-standing fragmentation around localStorage/sessionStorage:
 *
 *   - Safe parse/stringify: every call handles QuotaExceeded, corrupted blobs
 *     ("undefined", truncated strings, invalid JSON) without crashing callers.
 *   - TTL envelopes: cache entries carry an expiry and are auto-evicted on read.
 *   - Schema versioning: a single STORAGE_SCHEMA_VERSION constant guards every
 *     known app key; bumping it on a breaking change causes one-time auto-wipe
 *     on the next page load, ensuring stale state can never resurface.
 *   - Logout cleanup: a single entry point removes role-scoped sensitive data
 *     (PII, push tokens, role-specific caches) without nuking guest preferences.
 *   - SSR-safe: every helper short-circuits when window is undefined.
 *
 * Convention: all known app keys are declared in `storageKeys.js`.
 * Callers should import keys from that module instead of hard-coding strings.
 */

import { STORAGE_KEYS, KEY_PREFIXES, ALL_KNOWN_KEYS } from './storageKeys';

const STORAGE_NAMESPACE = 'appzeto';
/**
 * Bump this whenever a known persisted shape changes incompatibly so the
 * next page load wipes legacy blobs from every known key.
 */
export const STORAGE_SCHEMA_VERSION = 2;
const SCHEMA_KEY = `${STORAGE_NAMESPACE}:storage_schema_version`;
const ENVELOPE_VERSION = 1;

const isBrowser = () => typeof window !== 'undefined';

const resolveStorage = (kind) => {
    if (!isBrowser()) return null;
    try {
        return kind === 'session' ? window.sessionStorage : window.localStorage;
    } catch {
        return null;
    }
};

const swallow = (fn) => {
    try {
        return fn();
    } catch {
        return undefined;
    }
};

/** Safe read of a raw string value. Returns null on any failure. */
export function rawGet(key, { storage = 'local' } = {}) {
    const store = resolveStorage(storage);
    if (!store || !key) return null;
    try {
        return store.getItem(key);
    } catch {
        return null;
    }
}

/** Safe write of a raw string value. Returns true on success. */
export function rawSet(key, value, { storage = 'local' } = {}) {
    const store = resolveStorage(storage);
    if (!store || !key) return false;
    try {
        store.setItem(key, value);
        return true;
    } catch (error) {
        if (error && error.name === 'QuotaExceededError') {
            try {
                evictExpiredEntries(storage);
                store.setItem(key, value);
                return true;
            } catch {
                /* give up silently — degraded mode, not fatal */
            }
        }
        return false;
    }
}

/** Safe removal — never throws. */
export function rawRemove(key, { storage = 'local' } = {}) {
    const store = resolveStorage(storage);
    if (!store || !key) return false;
    try {
        store.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse JSON safely. Returns `fallback` for missing, empty, malformed, or
 * sentinel ("undefined") values — never throws.
 */
export function safeParseJson(rawValue, fallback = null) {
    if (rawValue == null) return fallback;
    const trimmed = String(rawValue).trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return fallback;
    try {
        return JSON.parse(trimmed);
    } catch {
        return fallback;
    }
}

/**
 * Read a JSON value. Supports both plain values and TTL envelopes written by
 * `setJSON`. Expired envelopes are auto-removed and the fallback is returned.
 */
export function getJSON(key, fallback = null, { storage = 'local' } = {}) {
    const raw = rawGet(key, { storage });
    if (raw == null) return fallback;

    const parsed = safeParseJson(raw, undefined);
    if (parsed === undefined) {
        // Corrupted: drop it so future reads return the fallback cleanly.
        rawRemove(key, { storage });
        return fallback;
    }

    if (parsed && typeof parsed === 'object' && parsed.__env === ENVELOPE_VERSION) {
        if (typeof parsed.exp === 'number' && parsed.exp > 0 && parsed.exp <= Date.now()) {
            rawRemove(key, { storage });
            return fallback;
        }
        return parsed.data === undefined ? fallback : parsed.data;
    }

    return parsed;
}

/**
 * Write a JSON value. When `ttlMs` is provided, the value is wrapped in a
 * TTL envelope so reads after expiry return the fallback transparently.
 *
 * Returns true on success; failure is silent (degraded mode in private browsing
 * or when quota is exhausted).
 */
export function setJSON(key, value, { storage = 'local', ttlMs } = {}) {
    if (!isBrowser() || !key) return false;
    let payload;
    try {
        if (typeof ttlMs === 'number' && ttlMs > 0) {
            const envelope = {
                __env: ENVELOPE_VERSION,
                ts: Date.now(),
                exp: Date.now() + ttlMs,
                data: value,
            };
            payload = JSON.stringify(envelope);
        } else {
            payload = JSON.stringify(value);
        }
    } catch {
        return false;
    }
    return rawSet(key, payload, { storage });
}

/** Remove a key from local or session storage. */
export function remove(key, { storage = 'local' } = {}) {
    return rawRemove(key, { storage });
}

/** Iterate live keys in a given storage area. Safe in private browsing modes. */
function listKeys(storage = 'local') {
    const store = resolveStorage(storage);
    if (!store) return [];
    const keys = [];
    try {
        for (let i = 0; i < store.length; i += 1) {
            const key = store.key(i);
            if (typeof key === 'string') keys.push(key);
        }
    } catch {
        /* ignore */
    }
    return keys;
}

/** Remove every key starting with `prefix`. */
export function clearByPrefix(prefix, { storage = 'local' } = {}) {
    if (!prefix) return 0;
    const keys = listKeys(storage).filter((k) => k.startsWith(prefix));
    keys.forEach((k) => rawRemove(k, { storage }));
    return keys.length;
}

/** Bulk remove a list of explicit keys. */
export function clearKeys(keys = [], { storage = 'local' } = {}) {
    let removed = 0;
    for (const key of keys) {
        if (rawRemove(key, { storage })) removed += 1;
    }
    return removed;
}

/**
 * Walk both storages and drop any TTL-envelope entries whose `exp` has passed.
 * Used as a recovery step when a write hits QuotaExceededError.
 */
export function evictExpiredEntries(storage = 'both') {
    const targets = storage === 'both' ? ['local', 'session'] : [storage];
    let evicted = 0;
    for (const target of targets) {
        for (const key of listKeys(target)) {
            const raw = rawGet(key, { storage: target });
            const parsed = safeParseJson(raw, null);
            if (parsed && typeof parsed === 'object' && parsed.__env === ENVELOPE_VERSION) {
                if (typeof parsed.exp === 'number' && parsed.exp > 0 && parsed.exp <= Date.now()) {
                    rawRemove(key, { storage: target });
                    evicted += 1;
                }
            }
        }
    }
    return evicted;
}

/**
 * One-time schema migration. If STORAGE_SCHEMA_VERSION has changed since the
 * last visit, wipe every known app key from both storages. Unknown keys are
 * preserved so we don't trample third-party/extension state.
 */
export function ensureStorageSchema() {
    if (!isBrowser()) return;
    const stored = Number(rawGet(SCHEMA_KEY) || 0);
    if (stored === STORAGE_SCHEMA_VERSION) return;

    for (const key of ALL_KNOWN_KEYS) {
        rawRemove(key, { storage: 'local' });
        rawRemove(key, { storage: 'session' });
    }
    for (const prefix of Object.values(KEY_PREFIXES)) {
        clearByPrefix(prefix, { storage: 'local' });
        clearByPrefix(prefix, { storage: 'session' });
    }

    rawSet(SCHEMA_KEY, String(STORAGE_SCHEMA_VERSION));
}

/**
 * Clear sensitive role-scoped data on logout.
 *
 * Always removed:
 *   - Push tokens & registration markers for the role being logged out.
 *   - Recent searches, recipient address, support-unread counts.
 *   - Delivery-only rider GPS cache.
 *
 * Preserved by default:
 *   - Other roles' tokens (multi-portal browsing on one device).
 *   - Guest cart and wishlist (these are guest-mode state, not user PII).
 *   - Last known location (UX preference for guest browsing).
 *
 * Pass options to override defaults.
 */
export function clearOnLogout({
    role,
    userId,
    clearGuestCart = true,
    clearGuestWishlist = true,
    clearLastLocation = false,
} = {}) {
    if (!isBrowser()) return;
    const normalizedRole = String(role || '').toLowerCase().trim();

    // Push state — per role.
    if (normalizedRole) {
        rawRemove(`${KEY_PREFIXES.PUSH_FCM_TOKEN}${normalizedRole}`, { storage: 'local' });
        rawRemove(`${KEY_PREFIXES.PUSH_REGISTERED}${normalizedRole}`, { storage: 'session' });
    } else {
        clearByPrefix(KEY_PREFIXES.PUSH_FCM_TOKEN, { storage: 'local' });
        clearByPrefix(KEY_PREFIXES.PUSH_REGISTERED, { storage: 'session' });
    }

    // Support unread counts are keyed by `supportUnread:<role>:<userId>`.
    const uid = String(userId || '').trim();
    if (normalizedRole && uid) {
        rawRemove(`${KEY_PREFIXES.SUPPORT_UNREAD}${normalizedRole}:${uid}`, { storage: 'local' });
    } else if (normalizedRole) {
        clearByPrefix(`${KEY_PREFIXES.SUPPORT_UNREAD}${normalizedRole}:`, { storage: 'local' });
    }

    // Recently-typed PII on shared devices must not leak across accounts.
    rawRemove(STORAGE_KEYS.RECIPIENT_ADDRESS, { storage: 'local' });
    rawRemove(STORAGE_KEYS.RECENT_SEARCHES, { storage: 'local' });

    if (clearGuestCart) rawRemove(STORAGE_KEYS.CART, { storage: 'local' });
    if (clearGuestWishlist) rawRemove(STORAGE_KEYS.WISHLIST, { storage: 'local' });

    if (normalizedRole === 'delivery' || clearLastLocation) {
        rawRemove(STORAGE_KEYS.DELIVERY_LAST_LOCATION, { storage: 'local' });
        rawRemove(STORAGE_KEYS.DELIVERY_HANDLED_INCOMING, { storage: 'session' });
    }

    if (clearLastLocation) {
        rawRemove(STORAGE_KEYS.LOCATION, { storage: 'local' });
    }

    swallow(() => rawRemove(STORAGE_KEYS.FAQ_CACHE, { storage: 'session' }));
    swallow(() => rawRemove(STORAGE_KEYS.EXPERIENCE_RETURN, { storage: 'session' }));
}

/** Hard reset of every known app key — exposed for diagnostics and tests. */
export function clearAllAppStorage() {
    if (!isBrowser()) return;
    for (const key of ALL_KNOWN_KEYS) {
        rawRemove(key, { storage: 'local' });
        rawRemove(key, { storage: 'session' });
    }
    for (const prefix of Object.values(KEY_PREFIXES)) {
        clearByPrefix(prefix, { storage: 'local' });
        clearByPrefix(prefix, { storage: 'session' });
    }
    rawSet(SCHEMA_KEY, String(STORAGE_SCHEMA_VERSION));
}

export { STORAGE_KEYS, KEY_PREFIXES };

export default {
    rawGet,
    rawSet,
    rawRemove,
    safeParseJson,
    getJSON,
    setJSON,
    remove,
    clearByPrefix,
    clearKeys,
    evictExpiredEntries,
    ensureStorageSchema,
    clearOnLogout,
    clearAllAppStorage,
    STORAGE_KEYS,
    KEY_PREFIXES,
    STORAGE_SCHEMA_VERSION,
};
