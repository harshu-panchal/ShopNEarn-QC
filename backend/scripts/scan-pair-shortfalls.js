/**
 * READ-ONLY: list active members with unpaid eligible pairs, and whether
 * those pairs are payable now (tier rate > 0 + daily cap remaining).
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import Customer from "../app/models/customer.js";
import { MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";
import {
  calculateBinaryPairs,
  countLegActivePlanAVolumes,
  countActivePlanADirects,
  resolvePairIncomeConfig,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";

dotenv.config();
await connectDB();

const cfg = await getMlmConfig();
const memberships = await MlmMembership.find({
  status: MLM_MEMBERSHIP_STATUS.ACTIVE,
})
  .select(
    "userId referralCode pairsCompleted binaryLeftChildId binaryRightChildId binaryTopupMember binaryDailyPairTracker",
  )
  .lean();

const IST_OFFSET_MIN = 330;
function todayIst() {
  const local = new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const today = todayIst();

const shortfalls = [];
for (const mem of memberships) {
  if (!mem.binaryLeftChildId && !mem.binaryRightChildId) continue;
  const { leftActive, rightActive } = await countLegActivePlanAVolumes(mem);
  const { pairs } = calculateBinaryPairs(leftActive, rightActive);
  const paid = Number(mem.pairsCompleted) || 0;
  if (pairs <= paid) continue;

  const directs = await countActivePlanADirects(mem.userId);
  const { pairIncome, dailyPairCap } = resolvePairIncomeConfig(
    cfg,
    directs,
    Boolean(mem.binaryTopupMember),
  );
  const missing = pairs - paid;
  const tracker = mem.binaryDailyPairTracker || {};
  const paidToday = tracker.date === today ? Number(tracker.pairsPaid || 0) : 0;
  const dailyRemaining = Math.max(dailyPairCap - paidToday, 0);
  const wouldCreditNow =
    pairIncome > 0 && dailyPairCap > 0 ? Math.min(missing, dailyRemaining) : 0;

  let reason = "payable_now";
  if (pairIncome <= 0) reason = "needs_2_plus_active_directs";
  else if (dailyRemaining <= 0) reason = "daily_cap_exhausted";

  shortfalls.push({
    userId: String(mem.userId),
    code: mem.referralCode,
    L: leftActive,
    R: rightActive,
    eligible: pairs,
    paid,
    missing,
    directs,
    pairIncome,
    dailyPairCap,
    dailyRemaining,
    wouldCreditNow,
    reason,
  });
}

const cust = await Customer.find({
  _id: { $in: shortfalls.map((s) => s.userId) },
})
  .select("name userId")
  .lean();
const byId = new Map(cust.map((c) => [String(c._id), c]));

console.log(`Scanned active members: ${memberships.length}`);
console.log(`Members with unpaid eligible pairs: ${shortfalls.length}\n`);

const payable = shortfalls.filter((s) => s.wouldCreditNow > 0);
const blocked = shortfalls.filter((s) => s.wouldCreditNow === 0);

console.log(`=== SAME BUG / PAYABLE NOW: ${payable.length} ===`);
if (payable.length === 0) console.log("  (none)");
for (const s of payable) {
  const c = byId.get(s.userId);
  console.log(
    `  ${c?.name || "?"} (${c?.userId || s.code}) missing=${s.missing} wouldCredit=${s.wouldCreditNow} @ Rs.${s.pairIncome}`,
  );
}

console.log(`\n=== UNPAID PAIRS BUT NOT PAYABLE YET: ${blocked.length} ===`);
if (blocked.length === 0) console.log("  (none)");
for (const s of blocked) {
  const c = byId.get(s.userId);
  console.log(
    `  ${c?.name || "?"} (${c?.userId || s.code}) L=${s.L} R=${s.R} missing=${s.missing} directs=${s.directs} rate=Rs.${s.pairIncome} reason=${s.reason}`,
  );
}

await mongoose.disconnect();
console.log("\nDone (read-only).");
