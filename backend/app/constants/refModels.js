/**
 * Canonical Mongoose model names used in polymorphic refs and
 * discriminator fields (`refPath` enums) across the schema layer.
 *
 * Phase 5 (P5-1) introduced this file to unify the user-facing model
 * vocabulary. Previously the codebase used three different conventions
 * for the same logical actor:
 *
 *   - "User"     vs   "Customer"
 *   - "Delivery" vs   "Rider"
 *
 * The canonical names below are what `mongoose.model("…")` is registered
 * with (verified via `app/core/modelRegistry.js`). Legacy aliases are
 * exported separately so schemas can keep accepting historical rows
 * during the migration window (Phase 5 → Phase 7).
 *
 * Usage:
 *   import {
 *     USER_MODEL_NAMES,
 *     ALL_USER_MODEL_NAMES,
 *     ALL_USER_MODEL_NAMES_WITH_LEGACY,
 *   } from "../constants/refModels.js";
 *
 *   recipientModel: {
 *     type: String,
 *     enum: ALL_USER_MODEL_NAMES_WITH_LEGACY,  // tolerant during migration
 *     required: true,
 *   }
 *
 * After Phase 5 migration script runs and the legacy values are confirmed
 * gone from production (zero rows match the legacy values), Phase 7 will
 * narrow each enum to `ALL_USER_MODEL_NAMES` only.
 */

export const USER_MODEL_NAMES = Object.freeze({
  USER: "User",
  SELLER: "Seller",
  DELIVERY: "Delivery",
  ADMIN: "Admin",
});

export const ALL_USER_MODEL_NAMES = Object.freeze(
  Object.values(USER_MODEL_NAMES),
);

/**
 * Legacy discriminator values that historical rows may still carry.
 * These are scheduled for removal in Phase 7 once the
 * `migrate-customer-to-user-discriminator.js` script has rewritten every
 * row in production.
 */
export const LEGACY_USER_MODEL_NAMES = Object.freeze({
  CUSTOMER: "Customer", // legacy alias for "User"
  RIDER: "Rider", // legacy alias for "Delivery"
});

export const ALL_LEGACY_USER_MODEL_NAMES = Object.freeze(
  Object.values(LEGACY_USER_MODEL_NAMES),
);

/**
 * Union of canonical + legacy. Use this in `enum:` declarations on
 * schemas that hold historical data and need to keep validating during
 * the migration window.
 */
export const ALL_USER_MODEL_NAMES_WITH_LEGACY = Object.freeze([
  ...ALL_USER_MODEL_NAMES,
  ...ALL_LEGACY_USER_MODEL_NAMES,
]);

/**
 * Canonicalisation helper. Returns the canonical name for any legacy
 * alias; passes through canonical names; returns null for unknown
 * values so callers can detect unmapped data.
 */
export function canonicalUserModelName(value) {
  if (!value) return null;
  if (ALL_USER_MODEL_NAMES.includes(value)) return value;
  if (value === LEGACY_USER_MODEL_NAMES.CUSTOMER) return USER_MODEL_NAMES.USER;
  if (value === LEGACY_USER_MODEL_NAMES.RIDER) return USER_MODEL_NAMES.DELIVERY;
  return null;
}
