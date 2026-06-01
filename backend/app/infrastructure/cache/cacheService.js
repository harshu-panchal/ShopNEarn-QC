/**
 * Forward-compat shim for `app/services/cacheService.js`.
 *
 * Establishes the `app/infrastructure/cache/` namespace introduced in
 * refactor Phase 2.5. New code SHOULD import from this path; existing code
 * importing from `services/cacheService.js` continues to work unchanged.
 *
 * Phase 5 will move the implementation here and turn the legacy path into
 * the shim, completing the directional flip.
 */
export * from "../../services/cacheService.js";
export { default } from "../../services/cacheService.js";
