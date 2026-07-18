/**
 * Repair binary team-pair income shortfalls caused by the old
 * `$graphLookup maxDepth: 64` cap, which silently dropped members deeper
 * than 64 levels from leg volume counts.
 *
 * Dry-run (default): lists every active membership whose live eligible
 * pair count exceeds `pairsCompleted` — i.e. unpaid pairs.
 *
 * Apply (`--apply`): re-runs the production credit path
 * (`computeAndCreditBinaryTeamPairIncome`) for each shorted membership
 * inside its own transaction. The engine is idempotent per pair index
 * (`BINARY_PAIR_MATCH-<userId>-P<n>`), so re-running is safe.
 *
 * Usage:
 *   node scripts/repair-binary-pair-income.js            # dry run
 *   node scripts/repair-binary-pair-income.js --apply    # credit
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
  computeAndCreditBinaryTeamPairIncome,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const CORRELATION_ID = `repair-pair-depth-cap-${new Date().toISOString().slice(0, 10)}`;

await connectDB();

const memberships = await MlmMembership.find({
  status: MLM_MEMBERSHIP_STATUS.ACTIVE,
})
  .select("userId referralCode pairsCompleted binaryLeftChildId binaryRightChildId")
  .lean();

console.log(`Active memberships to scan: ${memberships.length}`);
console.log(`Mode: ${APPLY ? "APPLY (credits will be written)" : "DRY RUN"}\n`);

const shortfalls = [];
for (const mem of memberships) {
  if (!mem.binaryLeftChildId && !mem.binaryRightChildId) continue;
  const { leftActive, rightActive } = await countLegActivePlanAVolumes(mem);
  const { pairs } = calculateBinaryPairs(leftActive, rightActive);
  const paid = Number(mem.pairsCompleted) || 0;
  if (pairs > paid) {
    shortfalls.push({ mem, leftActive, rightActive, eligible: pairs, paid });
  }
}

if (shortfalls.length === 0) {
  console.log("No shortfalls found. Nothing to repair.");
} else {
  const custDocs = await Customer.find({
    _id: { $in: shortfalls.map((s) => s.mem.userId) },
  })
    .select("name userId")
    .lean();
  const custById = new Map(custDocs.map((c) => [String(c._id), c]));

  console.log(`=== SHORTFALLS: ${shortfalls.length} member(s) ===`);
  for (const s of shortfalls) {
    const c = custById.get(String(s.mem.userId));
    console.log(
      `  ${c?.name || "?"} (${c?.userId || s.mem.referralCode}) L=${s.leftActive} R=${s.rightActive} eligible=${s.eligible} paid=${s.paid} missing=${s.eligible - s.paid}`,
    );
  }

  if (APPLY) {
    console.log("\n=== APPLYING CREDITS ===");
    for (const s of shortfalls) {
      const c = custById.get(String(s.mem.userId));
      const session = await mongoose.startSession();
      try {
        let events = [];
        await session.withTransaction(async () => {
          events = await computeAndCreditBinaryTeamPairIncome({
            sponsorUserId: s.mem.userId,
            triggerUserId: null,
            session,
            correlationId: CORRELATION_ID,
          });
        });
        const total = events.reduce((sum, e) => sum + (Number(e.bonusAmount) || 0), 0);
        console.log(
          `  ${c?.name || "?"} (${c?.userId || s.mem.referralCode}): credited ${events.length} pair(s), total Rs.${total}${events.length < s.eligible - s.paid ? " (remainder limited by daily cap — re-run tomorrow)" : ""}`,
        );
      } catch (err) {
        console.error(
          `  FAILED ${c?.userId || s.mem.referralCode}: ${err.message}`,
        );
      } finally {
        await session.endSession();
      }
    }
  } else {
    console.log("\nDry run only. Re-run with --apply to credit.");
  }
}

await mongoose.disconnect();
console.log("\nDone.");
