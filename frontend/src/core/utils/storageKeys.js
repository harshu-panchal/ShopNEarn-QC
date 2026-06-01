/**
 * storageKeys.js — single registry of every known browser-storage key used by
 * the app. Importing from here (instead of hard-coding strings) makes it
 * possible to:
 *
 *   - Reason about every persisted byte in one place.
 *   - Bump the schema version (storage.js) and wipe every legacy blob safely.
 *   - Detect duplicates and accidental collisions during code review.
 *
 * Keys here must match the literal strings currently in use, so renaming any
 * value here is a breaking change for users who have data under the old key.
 * To migrate, bump STORAGE_SCHEMA_VERSION in storage.js — that wipes every
 * legacy key on the next page load.
 */

export const STORAGE_KEYS = Object.freeze({
    // ── Auth tokens (one per portal) ──────────────────────────────────────────
    AUTH_CUSTOMER: 'auth_customer',
    AUTH_SELLER: 'auth_seller',
    AUTH_ADMIN: 'auth_admin',
    AUTH_DELIVERY: 'auth_delivery',
    AUTH_LEGACY: 'token',

    // ── Guest-mode state (overridden by backend once authenticated) ──────────
    CART: 'cart',
    WISHLIST: 'wishlist',

    // ── Address & location ───────────────────────────────────────────────────
    LOCATION: 'location_v2',
    RECIPIENT_ADDRESS: 'appzeto_checkout_recipient_v1',
    GEOCODE_CACHE: 'qc_geocode_cache_v1',

    // ── Customer UX caches ───────────────────────────────────────────────────
    RECENT_SEARCHES: 'appzeto_recent_searches',
    FAQ_CACHE: 'customer_faqs_cache_v1',
    EXPERIENCE_RETURN: 'experienceReturn',

    // ── Delivery operational state ───────────────────────────────────────────
    DELIVERY_LAST_LOCATION: 'delivery_partner_last_location',
    DELIVERY_HANDLED_INCOMING: 'deliveryHandledIncomingOrderIds',
});

/**
 * Prefixes for dynamically-built keys (suffix is role/userId/etc.). Used by
 * the schema migration and logout cleanup to wipe every matching entry.
 */
export const KEY_PREFIXES = Object.freeze({
    PUSH_FCM_TOKEN: 'push:fcm-token:',
    PUSH_REGISTERED: 'push:registered:',
    SUPPORT_UNREAD: 'supportUnread:',
});

/** Convenience map: every literal key the app may persist. */
export const ALL_KNOWN_KEYS = Object.freeze(Object.values(STORAGE_KEYS));

export default {
    STORAGE_KEYS,
    KEY_PREFIXES,
    ALL_KNOWN_KEYS,
};
