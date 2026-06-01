/**
 * JobSchedulerPort
 *
 * Provider-agnostic interface for scheduling workflow timeout jobs.
 * Implementations live alongside this file (see `bullJobScheduler.js`).
 *
 * Domain code (orderWorkflowService) calls these high-level helpers instead
 * of importing Bull queues directly — closing the infrastructure-leakage gap
 * identified in TC-03 of the refactor plan.
 *
 * All methods are guaranteed to:
 *   - Resolve / return cleanly even if the underlying queue is unavailable.
 *   - Bound their wait time by `BULL_ADD_TIMEOUT_MS` (default 10s) to keep
 *     order acceptance from blocking on slow Redis.
 *   - Log warnings via `logger` with a stable `scope` field on failure.
 *
 * Switching the implementation is a one-line change in this file:
 *   import { bullJobScheduler } from "./bullJobScheduler.js";
 *   // replace with: import { sqsJobScheduler } from "./sqsJobScheduler.js";
 *   export const jobScheduler = bullJobScheduler;
 */

import { bullJobScheduler } from "./bullJobScheduler.js";

export const jobScheduler = bullJobScheduler;

export const scheduleSellerTimeout = (orderId) =>
  jobScheduler.scheduleSellerTimeout(orderId);

export const removeSellerTimeout = (orderId) =>
  jobScheduler.removeSellerTimeout(orderId);

export const scheduleDeliveryTimeout = (orderId, attempt = 1) =>
  jobScheduler.scheduleDeliveryTimeout(orderId, attempt);

export const removeDeliveryTimeout = (orderId, attempt = 1) =>
  jobScheduler.removeDeliveryTimeout(orderId, attempt);

export const scheduleReturnPickupTimeout = (orderId, attempt = 1) =>
  jobScheduler.scheduleReturnPickupTimeout(orderId, attempt);

export const removeReturnPickupTimeout = (orderId, attempt = 1) =>
  jobScheduler.removeReturnPickupTimeout(orderId, attempt);

export default jobScheduler;
