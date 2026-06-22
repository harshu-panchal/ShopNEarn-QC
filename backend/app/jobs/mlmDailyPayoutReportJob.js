import logger from "../services/logger.js";
import MlmDailyPayoutReport from "../models/mlmDailyPayoutReport.js";
import { generateDailyPayoutReport } from "../services/mlm/mlmDailyPayoutReportService.js";
import {
  todayIstDateString,
  yesterdayIstDateString,
} from "../utils/mlmIstDate.js";

/**
 * MLM Daily Payout Report Job
 *
 * Runs every 15 minutes (configurable). After each IST midnight crossover,
 * generates the payout reconciliation report for the calendar day that just
 * ended (yesterday IST). Idempotent upsert — safe to re-run.
 *
 * Toggle: ENABLE_MLM_DAILY_PAYOUT_REPORT_JOB (default true)
 * Interval: MLM_DAILY_PAYOUT_REPORT_INTERVAL_MS (default 15m)
 */

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

let lastGeneratedForIstDate = null;

export const isMlmDailyPayoutReportJobEnabled = () =>
  String(process.env.ENABLE_MLM_DAILY_PAYOUT_REPORT_JOB || "true").toLowerCase()
  === "true";

export const getMlmDailyPayoutReportJobIntervalMs = () =>
  parseInt(
    process.env.MLM_DAILY_PAYOUT_REPORT_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`,
    10,
  );

export async function runMlmDailyPayoutReportJob() {
  const start = Date.now();
  const todayIst = todayIstDateString();
  const yesterdayIst = yesterdayIstDateString();

  const targets = [yesterdayIst];
  if (lastGeneratedForIstDate !== todayIst) {
    const todayReport = await MlmDailyPayoutReport.findOne({
      reportDate: todayIst,
    }).lean();
    if (!todayReport) {
      targets.push(todayIst);
    }
  }

  const results = [];
  for (const reportDate of targets) {
    if (reportDate === yesterdayIst && lastGeneratedForIstDate === todayIst) {
      const exists = await MlmDailyPayoutReport.findOne({ reportDate }).lean();
      if (exists) continue;
    }

    try {
      const res = await generateDailyPayoutReport(reportDate);
      results.push({
        reportDate,
        skipped: res.skipped,
        status: res.report?.status,
      });
    } catch (err) {
      logger.error("mlmDailyPayoutReportJob failed for date", {
        reportDate,
        error: err.message,
      });
      throw err;
    }
  }

  lastGeneratedForIstDate = todayIst;

  logger.info("mlmDailyPayoutReportJob completed", {
    durationMs: Date.now() - start,
    results,
  });
}

export function getMlmDailyPayoutReportJobHandler() {
  return runMlmDailyPayoutReportJob;
}
