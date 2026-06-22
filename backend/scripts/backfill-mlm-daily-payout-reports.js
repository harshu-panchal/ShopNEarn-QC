/**
 * backfill-mlm-daily-payout-reports.js
 *
 * Generate MlmDailyPayoutReport documents for a date range (IST).
 *
 * Usage:
 *   node backend/scripts/backfill-mlm-daily-payout-reports.js --from=2026-01-01 --to=2026-06-20
 *   node backend/scripts/backfill-mlm-daily-payout-reports.js --from=2026-06-01 --to=2026-06-20 --apply
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import { generateDailyPayoutReport } from "../app/services/mlm/mlmDailyPayoutReportService.js";
import { istDayBounds, todayIstDateString } from "../app/utils/mlmIstDate.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

function getArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function nextIstDate(dateStr) {
  const { endUtc } = istDayBounds(dateStr);
  return todayIstDateString(endUtc);
}

function tag(...args) {
  console.log("[backfill-mlm-daily-payout-reports]", ...args);
}

async function main() {
  const from = getArg("from");
  const to = getArg("to") || from;
  if (!from) {
    tag("Usage: --from=YYYY-MM-DD [--to=YYYY-MM-DD] [--apply]");
    process.exit(1);
  }

  await connectDB();
  tag(APPLY ? "APPLY mode" : "DRY-RUN mode");

  let cursor = from;
  let generated = 0;
  let skipped = 0;

  while (cursor <= to) {
    if (!APPLY) {
      tag(`WOULD generate ${cursor}`);
      generated += 1;
    } else {
      const res = await generateDailyPayoutReport(cursor, { force: false });
      if (res.skipped) {
        skipped += 1;
        tag(`SKIP ${cursor}: ${res.skipped}`);
      } else {
        generated += 1;
        tag(`OK ${cursor} — ${res.report?.memberLineItems?.length || 0} members`);
      }
    }
    if (cursor === to) break;
    cursor = nextIstDate(cursor);
  }

  tag("Summary:", { generated, skipped });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[backfill-mlm-daily-payout-reports] FATAL:", err);
  process.exit(1);
});
