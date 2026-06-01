/**
 * Re-export shim — see `app/domains/README.md`.
 * Canonical implementation lives at `app/modules/notifications/notification.controller.js`.
 * The notification module is already self-contained — this shim just gives
 * it a home under `domains/` for consistency.
 */
export * from "../../modules/notifications/notification.controller.js";
