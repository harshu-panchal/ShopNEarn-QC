/** IST (+05:30) helpers for MLM daily boundaries. */

export const IST_TZ_OFFSET_MIN = 330;

/**
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD in IST
 */
export function todayIstDateString(now = new Date()) {
  const local = new Date(now.getTime() + IST_TZ_OFFSET_MIN * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD for the IST calendar day before `now`
 */
export function yesterdayIstDateString(now = new Date()) {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return todayIstDateString(yesterday);
}

/**
 * UTC instants bounding one IST calendar day (inclusive start, exclusive end).
 * @param {string} dateStr YYYY-MM-DD
 * @returns {{ startUtc: Date, endUtc: Date }}
 */
export function istDayBounds(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!match) {
    throw new Error(`Invalid IST date string: ${dateStr}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  startUtc.setUTCMinutes(startUtc.getUTCMinutes() - IST_TZ_OFFSET_MIN);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD in IST for an arbitrary instant
 */
export function toIstDateString(date) {
  return todayIstDateString(date instanceof Date ? date : new Date(date));
}
