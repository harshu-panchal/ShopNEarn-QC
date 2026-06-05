import crypto from "crypto";

/**
 * Customer-MLM-rebuild Phase 7 (PO-request) — public-facing User ID.
 *
 * Every Customer gets a short, human-readable, unique identifier that
 * is independent of the Mongo ObjectId. This ID:
 *
 *   • Is the THIRD canonical login identifier (alongside email +
 *     phone) — see `customerAuthController.loginWithPassword`.
 *   • Is included in the welcome email so the customer can write it
 *     down once and never lose it.
 *   • Is shown back to the user on the "Account Credentials" screen.
 *   • Surfaces in admin tooling so support agents can look an account
 *     up without copy-pasting an ObjectId.
 *
 * FORMAT: `SE` + 8 random characters drawn from a 32-character
 * unambiguous alphabet (excludes `0/O`, `1/I/L`). Total length 10.
 *
 *   Example: "SEA7K2X4P9", "SEXMZP3RTV"
 *
 * SEARCH SPACE: 32^8 ≈ 1.1 * 10^12 unique values. At the realistic
 * scale of this app (single-digit millions of customers, lifetime)
 * the collision probability per generation is ~10^-6, and we still
 * retry on collision below.
 *
 * SECURITY: The ID is NOT a secret. It identifies the account, the
 * same way an email or phone does. Knowing a User ID alone never
 * authenticates anything — login still requires the password.
 */

export const USER_ID_PREFIX = "SE";
const USER_ID_BODY_LENGTH = 8;
const USER_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const USER_ID_TOTAL_LENGTH = USER_ID_PREFIX.length + USER_ID_BODY_LENGTH;
const MAX_COLLISION_RETRIES = 10;

/**
 * Pattern that matches a valid User ID. Anchored, case-INSENSITIVE
 * because callers may have lowercased the input. Use
 * `isLikelyUserId(value)` for the cheap "does this string look like a
 * User ID at all" check used by the login identifier router.
 */
export const USER_ID_PATTERN = new RegExp(
  `^${USER_ID_PREFIX}[${USER_ID_ALPHABET}]{${USER_ID_BODY_LENGTH}}$`,
  "i",
);

/**
 * Loose check used by the login controller to decide which Customer
 * field to query. Returns true for any uppercase alphanumeric string
 * that starts with the prefix and has the right total length —
 * deliberately not strict on the body alphabet so a customer who
 * misremembers an `O` vs `0` still routes to userId lookup (and gets
 * the correct "Invalid credentials" response, not a confusing phone
 * normalisation error).
 */
export function isLikelyUserId(rawValue) {
  if (!rawValue) return false;
  const upper = String(rawValue).trim().toUpperCase();
  if (upper.length !== USER_ID_TOTAL_LENGTH) return false;
  if (!upper.startsWith(USER_ID_PREFIX)) return false;
  return /^[A-Z0-9]+$/.test(upper);
}

/**
 * RNG using crypto.randomBytes with REJECTION SAMPLING — unbiased
 * across the (31-char) alphabet.
 *
 * Why rejection: the alphabet is 31 characters (excludes 0/O, 1/I/L
 * for visual disambiguation). A naive `bytes[i] & 31` produces an
 * index in [0,31] which is one slot beyond the alphabet, and a
 * naive `bytes[i] % 31` introduces a ~3% bias on the wrap-around
 * letters (A..D would appear 9/256 times each, the rest 8/256).
 *
 * The rejection loop draws extra bytes up front to keep the cost
 * essentially one syscall, and discards values >= 31. With a 31/32
 * acceptance rate the expected number of draws is 8 * (32/31) ≈ 8.3,
 * comfortably inside the buffer we pre-allocate.
 */
function randomUserIdBody() {
  let out = "";
  while (out.length < USER_ID_BODY_LENGTH) {
    const bytes = crypto.randomBytes(USER_ID_BODY_LENGTH * 2);
    for (let i = 0; i < bytes.length && out.length < USER_ID_BODY_LENGTH; i += 1) {
      const idx = bytes[i] & 31;
      if (idx < USER_ID_ALPHABET.length) {
        out += USER_ID_ALPHABET[idx];
      }
    }
  }
  return out;
}

/**
 * Generate one random User ID without any uniqueness check. Use
 * `generateUniqueUserId` instead for any database-write path.
 */
export function generateRandomUserId() {
  return `${USER_ID_PREFIX}${randomUserIdBody()}`;
}

/**
 * Generate a User ID that is guaranteed to be unique in the supplied
 * Mongoose Customer collection at the moment of generation.
 *
 * @param {import("mongoose").Model} CustomerModel
 *   The Customer mongoose model to check uniqueness against.
 * @param {object} [options]
 * @param {import("mongoose").ClientSession} [options.session]
 *   Optional session for transactional caller.
 * @param {number} [options.maxRetries]
 *   Override the default collision-retry budget.
 * @returns {Promise<string>}
 *   A unique `SE…` user ID.
 *
 * NOTE: The "unique now" guarantee is best-effort — a race between
 * the uniqueness check and the eventual insert is still possible.
 * The unique sparse index on `Customer.userId` is the real backstop:
 * a duplicate write throws E11000 and the caller can retry.
 */
export async function generateUniqueUserId(CustomerModel, options = {}) {
  const { session = null, maxRetries = MAX_COLLISION_RETRIES } = options;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const candidate = generateRandomUserId();
    const query = CustomerModel.exists({ userId: candidate });
    if (session) query.session(session);
    const exists = await query;
    if (!exists) return candidate;
  }
  const err = new Error(
    `Failed to generate a unique User ID after ${maxRetries} attempts`,
  );
  err.statusCode = 500;
  throw err;
}
