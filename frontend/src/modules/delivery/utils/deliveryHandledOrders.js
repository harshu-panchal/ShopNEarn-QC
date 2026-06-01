/**
 * Persist order IDs for which the incoming-offer modal should never show again
 * (accept/skip/view active order). Sessions are bounded by:
 *   - MAX_ENTRIES  → keeps the list from growing unboundedly across a long shift
 *   - ENTRY_TTL_MS → drops stale IDs so a 3-day-old "skipped" offer can resurface
 *                    if the dispatcher ever re-offers it later.
 *
 * Stored as `{ ids: [{ id, ts }] }` envelopes; legacy `string[]` payloads are
 * still understood and silently migrated on the next write.
 */

import { rawGet, rawSet, rawRemove, safeParseJson, STORAGE_KEYS } from "@core/utils/storage";

export const HANDLED_INCOMING_ORDER_IDS_KEY = STORAGE_KEYS.DELIVERY_HANDLED_INCOMING;

const MAX_ENTRIES = 200;
const ENTRY_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours covers a single rider shift

function readEnvelope() {
  const raw = rawGet(HANDLED_INCOMING_ORDER_IDS_KEY, { storage: "session" });
  const parsed = safeParseJson(raw, null);
  const now = Date.now();

  if (Array.isArray(parsed)) {
    return parsed.map((id) => ({ id: String(id), ts: now }));
  }

  if (parsed && Array.isArray(parsed.ids)) {
    return parsed.ids
      .filter((entry) => entry && typeof entry.id === "string")
      .filter((entry) => {
        const ts = typeof entry.ts === "number" ? entry.ts : 0;
        return ENTRY_TTL_MS <= 0 || now - ts <= ENTRY_TTL_MS;
      });
  }

  return [];
}

function writeEnvelope(entries) {
  if (!entries.length) {
    rawRemove(HANDLED_INCOMING_ORDER_IDS_KEY, { storage: "session" });
    return;
  }
  const trimmed = entries
    .slice(-MAX_ENTRIES)
    .map((entry) => ({ id: String(entry.id), ts: entry.ts || Date.now() }));
  try {
    rawSet(
      HANDLED_INCOMING_ORDER_IDS_KEY,
      JSON.stringify({ ids: trimmed }),
      { storage: "session" },
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadHandledIncomingOrderIds() {
  return readEnvelope().map((entry) => entry.id);
}

export function markIncomingOrderHandled(orderId) {
  if (!orderId) return;
  const id = String(orderId);
  const entries = readEnvelope().filter((entry) => entry.id !== id);
  entries.push({ id, ts: Date.now() });
  writeEnvelope(entries);
}
