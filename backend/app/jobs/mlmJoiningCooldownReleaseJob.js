import dotenv from "dotenv";
import logger from "../services/logger.js";
import { getPlanAPairBonusReleaseCooldownDays } from "../services/mlm/mlmConfigService.js";
import {
  releaseEligiblePendingPlanABonuses,
} from "../services/mlm/mlmPairBonusCooldownReleaseService.js";

dotenv.config();

/**
 * MLM Joining Cooldown Release Job — Plan A binary pair-match bonuses
 *
 * Plan A's `BINARY_PAIR_MATCH` bonuses are credited to the recipient's
 * `pending` bucket synchronously when a pair-completing referral
 * activates. They are NOT tied to an Order (joining is a direct
 * payment), so the existing `returnWindowReleaseJob` cannot move them
 * to `earnings` because that job keys off `Order.returnWindowExpiresAt`.
 *
 * Instead, this job runs on its own cadence and promotes pair-match
 * events that have sat in pending for at least
 * `Setting.mlm.planAPairBonusReleaseCooldownDays` (default 7 days).
 * The cooldown gives finance a window to dispute / refund a joining
 * payment before the sponsor can withdraw the bonus.
 *
 * Mechanics (per event, atomic inside one session):
 *   1. Debit the recipient's `pending` bucket
 *      (LedgerEntry: MLM_BONUS_RELEASED, idempotency `MLM-BPR-<id>-D`)
 *   2. Credit the recipient's `earnings` bucket
 *      (LedgerEntry: MLM_BONUS_RELEASED, idempotency `MLM-BPR-<id>-C`)
 *   3. Stamp `MlmCommissionEvent.releasedAt` and flip
 *      `walletBucket: "earnings"` so it never re-enters the candidate
 *      query.
 *
 * Idempotent: failures partway through a session roll the event back
 * intact, and the next run picks it up via the same `releasedAt`
 * filter. The unique idempotency keys on the new ledger rows prevent
 * any double-release if the job overlaps itself.
 *
 * Toggle via `ENABLE_MLM_JOINING_COOLDOWN_RELEASE_JOB`
 * (default `true`). Cadence via
 * `MLM_JOINING_COOLDOWN_RELEASE_INTERVAL_MS` (default 1h).
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h

const isJobEnabled = () =>
  String(
    process.env.ENABLE_MLM_JOINING_COOLDOWN_RELEASE_JOB || "true",
  ).toLowerCase() === "true";

const getJobInterval = () =>
  parseInt(
    process.env.MLM_JOINING_COOLDOWN_RELEASE_INTERVAL_MS ||
      `${DEFAULT_INTERVAL_MS}`,
    10,
  );

const mlmJoiningCooldownReleaseJobHandler = async () => {
  const startTime = Date.now();
  try {
    const cooldownDays = await getPlanAPairBonusReleaseCooldownDays();
    const { processed, failed, scanned } =
      await releaseEligiblePendingPlanABonuses({ cooldownDays });

    if (processed > 0 || failed > 0) {
      const duration = Date.now() - startTime;
      logger.info("MLM pair bonus cooldown release completed", {
        jobName: "mlmJoiningCooldownReleaseJob",
        duration,
        processed,
        failed,
        scanned,
        cooldownDays,
      });
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("MLM pair bonus cooldown release job failed", {
      jobName: "mlmJoiningCooldownReleaseJob",
      duration,
      error: err.message,
      stack: err.stack,
    });
  }
};

export const getMlmJoiningCooldownReleaseJobHandler = () =>
  mlmJoiningCooldownReleaseJobHandler;
export const getMlmJoiningCooldownReleaseJobIntervalMs = () =>
  getJobInterval();
export const isMlmJoiningCooldownReleaseJobEnabled = () => isJobEnabled();

export default mlmJoiningCooldownReleaseJobHandler;
