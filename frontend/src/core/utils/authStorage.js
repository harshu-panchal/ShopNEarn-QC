import { isTokenExpired } from "./token";
import { rawGet, rawRemove } from "./storage";

function extractTokenCandidate(rawValue) {
  if (rawValue == null) return null;

  const trimmed = String(rawValue).trim();
  if (!trimmed) return null;
  if (trimmed === "undefined" || trimmed === "null") return null;

  if (/^bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^bearer\s+/i, "").trim();
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const nestedToken =
        parsed?.token ||
        parsed?.accessToken ||
        parsed?.jwt ||
        parsed?.result?.token ||
        null;
      return nestedToken ? extractTokenCandidate(nestedToken) : null;
    } catch {
      return trimmed;
    }
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return extractTokenCandidate(trimmed.slice(1, -1));
  }

  return trimmed;
}

export function normalizeStoredToken(rawValue) {
  const token = extractTokenCandidate(rawValue);
  return token ? String(token).trim() : null;
}

export function getStoredAuthToken(storageKey, { allowExpired = false } = {}) {
  const normalized = normalizeStoredToken(rawGet(storageKey));
  if (!normalized) return null;
  if (!allowExpired && isTokenExpired(normalized)) {
    rawRemove(storageKey);
    return null;
  }
  return normalized;
}

export function hasValidStoredAuthToken(storageKey) {
  return Boolean(getStoredAuthToken(storageKey));
}

/**
 * Factory for socket `getToken` callbacks. Centralizes the duplicated inline
 * implementations previously found in OrderDetailPage / DeliveryOtpDisplay /
 * CheckoutPage / DeliveryLayout / Notifications / Returns. Tokens are read
 * fresh on every invocation so socket re-auth after a token refresh works.
 *
 * `allowExpired` defaults to true because socket subscriptions need to deliver
 * the existing token even if it's seconds past `exp` — the backend will close
 * the connection itself if the token is truly invalid.
 */
export function createSocketTokenReader(storageKey, { allowExpired = true } = {}) {
  return () => getStoredAuthToken(storageKey, { allowExpired });
}
