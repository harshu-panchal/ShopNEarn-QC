/**
 * Shared regex helpers (audit-plan ticket P3-5).
 *
 * `escapeRegex` is required at every place we feed unsanitised user input
 * into a Mongo `$regex` filter. Without it a search term containing any
 * of `. * + ? ^ $ { } ( ) | [ ] \` either throws or produces unexpected
 * matches — both are bugs we already had in productController.
 */

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

export function escapeRegex(input) {
  if (input == null) return "";
  return String(input).replace(REGEX_SPECIALS, "\\$&");
}

/**
 * Build a Mongo `$regex` filter for a search term. Defaults to a
 * case-insensitive prefix match (`^term`) — this is the only shape that
 * can actually use an index. Pass `anchored: false` for the legacy
 * substring behavior.
 */
export function buildSearchRegex(term, { anchored = true, caseInsensitive = true } = {}) {
  const escaped = escapeRegex(term);
  return {
    $regex: anchored ? `^${escaped}` : escaped,
    ...(caseInsensitive ? { $options: "i" } : {}),
  };
}
