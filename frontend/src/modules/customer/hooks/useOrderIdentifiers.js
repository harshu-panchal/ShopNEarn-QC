import { useEffect, useMemo, useRef } from "react";

/**
 * Centralized resolver for the multiple ids that may refer to the same
 * order in the customer surface.
 *
 * A customer-facing order URL can carry any of:
 *   - the canonical `order.orderId` (e.g. "ORD-2025-…")
 *   - a `checkoutGroupId` alias (multi-store checkout shares one URL)
 *   - a 24-char Mongo _id (legacy deep links)
 *
 * Backend writes that fan out over realtime channels — Firebase RTDB,
 * Socket.IO rooms — are *always* keyed on the canonical `order.orderId`.
 * If the page subscribes using the raw URL param (which may be an alias),
 * it never receives those updates. This is the root cause of the
 * "tracking silent" bug on checkout-group URLs.
 *
 * Use `resolveOrderIdentifiers(order, routeParam)` outside React (e.g.
 * when computing a lookup id from a freshly-fetched response before state
 * has settled) and `useOrderIdentifiers(routeParam, order)` inside React
 * to get memoized identifiers + a stable ref for socket callbacks.
 */

const norm = (value) => String(value || "").trim();

export function resolveOrderIdentifiers(order, routeParam) {
  const route = norm(routeParam);
  const canonical = norm(order?.orderId);
  const group = norm(order?.checkoutGroupId);

  const canonicalOrderId = canonical || route || null;
  const lookupId = canonical || group || route || null;

  const identifiers = Array.from(
    new Set([route, canonical, group].filter(Boolean)),
  );

  const extraRoomId = canonical && canonical !== route ? canonical : "";

  return { canonicalOrderId, lookupId, identifiers, extraRoomId };
}

export function useOrderIdentifiers(routeParam, order) {
  const resolved = useMemo(
    () => resolveOrderIdentifiers(order, routeParam),
    [routeParam, order?.orderId, order?.checkoutGroupId],
  );

  // Mirror identifiers into a ref so socket callbacks (which capture once)
  // can match payloads against the latest known set without re-binding.
  const identifiersRef = useRef(resolved.identifiers);
  useEffect(() => {
    identifiersRef.current = resolved.identifiers;
  }, [resolved.identifiers]);

  return { ...resolved, identifiersRef };
}

export default useOrderIdentifiers;
