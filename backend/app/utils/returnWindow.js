/**
 * Single source of truth for return-window business rules.
 *
 * Replaces previously-duplicated copies of:
 *   - parsePositiveInt()
 *   - getReturnEligibilityDelayMinutes()
 *   - getReturnWindowMinutes()
 *   - computeReturnWindowForOrder()   (controller variant)
 *   - computeReturnWindowDates()      (finance-service variant)
 *
 * Both variants are preserved here under their original names so existing
 * callers can be migrated with a one-line import change, with zero behavior
 * difference.
 */

export function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
}

export function getReturnEligibilityDelayMinutes() {
  return parsePositiveInt(process.env.RETURN_ELIGIBILITY_DELAY_MINUTES, 2);
}

export function getReturnWindowMinutes() {
  return parsePositiveInt(process.env.RETURN_WINDOW_MINUTES, 2);
}

/**
 * Order-aware variant: prefers persisted timestamps on the order and falls
 * back to deliveredAt → createdAt → now. Returns the configured delay/window
 * values alongside the computed dates for use in user-facing error messages.
 *
 * Matches the previous `computeReturnWindowForOrder` in orderController.js.
 */
export function computeReturnWindowForOrder(order) {
  const base = order?.deliveredAt || order?.createdAt || new Date();
  const deliveredAt = base instanceof Date ? base : new Date(base);
  const eligibleDelay = getReturnEligibilityDelayMinutes();
  const windowMinutes = getReturnWindowMinutes();
  const eligibleAt =
    order?.returnEligibleAt ||
    new Date(deliveredAt.getTime() + eligibleDelay * 60 * 1000);
  let windowExpiresAt =
    order?.returnWindowExpiresAt ||
    new Date(deliveredAt.getTime() + windowMinutes * 60 * 1000);
  if (windowExpiresAt < eligibleAt) {
    windowExpiresAt = eligibleAt;
  }

  return {
    eligibleAt,
    windowExpiresAt,
    eligibleDelay,
    windowMinutes,
  };
}

/**
 * Date-only variant: derives the window strictly from a deliveredAt input,
 * ignoring any persisted order-level overrides. Used by the finance service
 * when stamping a freshly-delivered order.
 *
 * Matches the previous `computeReturnWindowDates` in orderFinanceService.js.
 */
export function computeReturnWindowDates(deliveredAt) {
  const eligibleDelay = getReturnEligibilityDelayMinutes();
  const windowMinutes = getReturnWindowMinutes();
  const start = deliveredAt instanceof Date ? deliveredAt : new Date();
  const eligibleAt = new Date(start.getTime() + eligibleDelay * 60 * 1000);
  const windowExpiresAt = new Date(start.getTime() + windowMinutes * 60 * 1000);

  return {
    eligibleAt,
    windowExpiresAt,
  };
}

/**
 * Franchise POS sales have no return workflow of their own — a POS sale's
 * `returnEligibleAt`/`returnWindowExpiresAt` only exist to give
 * `returnWindowReleaseJob` a maturity window before releasing the pending
 * repurchase bonus into `earnings` (see `franchisePosService.js`). That's a
 * fraud/chargeback-risk window, not a delivery-transit one, so it shouldn't
 * be silently pinned to whatever `RETURN_ELIGIBILITY_DELAY_MINUTES` /
 * `RETURN_WINDOW_MINUTES` happen to be tuned to for online deliveries —
 * lengthening the online window for delivery-transit reasons shouldn't also
 * delay POS upline payouts. Defaults match the online window today (no
 * behavior change) but can be tuned independently.
 */
export function getPosBonusReleaseDelayMinutes() {
  const raw = process.env.FRANCHISE_POS_BONUS_RELEASE_DELAY_MINUTES;
  return raw !== undefined
    ? parsePositiveInt(raw, getReturnEligibilityDelayMinutes())
    : getReturnEligibilityDelayMinutes();
}

export function getPosBonusReleaseWindowMinutes() {
  const raw = process.env.FRANCHISE_POS_BONUS_RELEASE_WINDOW_MINUTES;
  return raw !== undefined
    ? parsePositiveInt(raw, getReturnWindowMinutes())
    : getReturnWindowMinutes();
}

export function computePosBonusReleaseWindowDates(soldAt) {
  const eligibleDelay = getPosBonusReleaseDelayMinutes();
  const windowMinutes = getPosBonusReleaseWindowMinutes();
  const start = soldAt instanceof Date ? soldAt : new Date();
  const eligibleAt = new Date(start.getTime() + eligibleDelay * 60 * 1000);
  const windowExpiresAt = new Date(start.getTime() + windowMinutes * 60 * 1000);

  return {
    eligibleAt,
    windowExpiresAt,
  };
}
