/**
 * READ-ONLY: verify direct-referral count vs per-activation income paid.
 *
 * Usage: node scripts/diagnose-direct-referral-income.js SE4C7NGSFB
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Customer from "../app/models/customer.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import {
  isPerActivationIncomeCommissionEvent,
} from "../app/services/mlm/mlmSignupBonusService.js";
import {
  isDirectReferralFirstPairCommissionEvent,
} from "../app/services/mlm/mlmFirstPairIncomeGuard.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";

dotenv.config();

const code = (process.argv[2] || "").trim().toUpperCase();
if (!code) {
  console.error("Usage: node scripts/diagnose-direct-referral-income.js <REFERRAL_CODE>");
  process.exit(1);
}

await connectDB();

let mem = await MlmMembership.findOne({ referralCode: code }).lean();
if (!mem) {
  const customer = await Customer.findOne({ userId: code }).select("_id").lean();
  if (customer) mem = await MlmMembership.findOne({ userId: customer._id }).lean();
}
if (!mem) {
  console.log("Member not found:", code);
  process.exit(1);
}

const customer = await Customer.findById(mem.userId).select("name phone userId").lean();
const cfg = await getMlmConfig();
const perActivationAmount =
  Number(cfg.directReferralPerActivationAmount) ||
  Number(cfg.directReferralActivationSponsorAmount) ||
  200;

const directs = await MlmMembership.find({ sponsorId: mem.userId })
  .select("userId referralCode status planType planAJoinedAt createdAt")
  .sort({ createdAt: 1 })
  .lean();

const custDocs = await Customer.find({
  _id: { $in: directs.map((d) => d.userId) },
})
  .select("name userId phone")
  .lean();
const custById = new Map(custDocs.map((c) => [String(c._id), c]));

const activePlanA = directs.filter(
  (d) =>
    d.status === MLM_MEMBERSHIP_STATUS.ACTIVE &&
    (d.planType === MLM_PLAN_TYPE.A || d.planType === MLM_PLAN_TYPE.B),
);

const events = await MlmCommissionEvent.find({
  recipientId: mem.userId,
  status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
}).lean();

const perActivationEvents = events.filter(isPerActivationIncomeCommissionEvent);
const firstPairEvents = events.filter(isDirectReferralFirstPairCommissionEvent);

// Map credited per-activation to source/activated user id
const creditedForDirect = new Map();
for (const ev of perActivationEvents) {
  const sourceId = ev.sourceUserId ? String(ev.sourceUserId) : null;
  const key = sourceId || ev.idempotencyKey || String(ev._id);
  const prev = creditedForDirect.get(key);
  if (!prev || (Number(ev.cappedAmount) || 0) > (Number(prev.cappedAmount) || 0)) {
    creditedForDirect.set(key, ev);
  }
}

const paidDirectIds = new Set(
  [...creditedForDirect.values()]
    .map((ev) => (ev.sourceUserId ? String(ev.sourceUserId) : null))
    .filter(Boolean),
);

console.log("\n=== MEMBER ===");
console.log({
  code: customer?.userId || mem.referralCode,
  name: customer?.name,
  status: mem.status,
  planType: mem.planType,
  counterDirectReferralsCount: mem.directReferralsCount,
});

console.log("\n=== DIRECT REFERRALS (sponsorId = this member) ===");
console.log({
  totalDirectsAnyStatus: directs.length,
  activePlanAorB: activePlanA.length,
  registeredUnpaid: directs.filter((d) => d.status === MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID).length,
  other: directs.filter(
    (d) =>
      d.status !== MLM_MEMBERSHIP_STATUS.ACTIVE &&
      d.status !== MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
  ).length,
});

console.log("\n=== PER-ACTIVATION INCOME CONFIG ===");
console.log({
  perActivationEnabled: cfg.directReferralPerActivationEnabled !== false,
  perActivationAmount,
  masterDirectReferralBonusEnabled: cfg.directReferralActivationBonusEnabled !== false,
});

console.log("\n=== CREDITED PER-ACTIVATION EVENTS ===");
console.log({
  uniqueDirectsPaid: paidDirectIds.size,
  eventRows: perActivationEvents.length,
  totalAmount: perActivationEvents.reduce((s, e) => s + (Number(e.cappedAmount) || 0), 0),
  firstPairCredits: firstPairEvents.length,
  firstPairAmount: firstPairEvents.reduce((s, e) => s + (Number(e.cappedAmount) || 0), 0),
});

console.log("\n=== EACH DIRECT ===");
let missing = 0;
let paid = 0;
let notEligible = 0;
for (const d of directs) {
  const c = custById.get(String(d.userId));
  const isActive =
    d.status === MLM_MEMBERSHIP_STATUS.ACTIVE &&
    (d.planType === MLM_PLAN_TYPE.A || d.planType === MLM_PLAN_TYPE.B);
  const gotPaid = paidDirectIds.has(String(d.userId));
  let flag = "";
  if (isActive && gotPaid) {
    paid += 1;
    flag = "PAID";
  } else if (isActive && !gotPaid) {
    missing += 1;
    flag = "ACTIVE BUT NO PER-ACTIVATION CREDIT";
  } else {
    notEligible += 1;
    flag = `not eligible (status=${d.status})`;
  }
  console.log(
    `  ${c?.name || "?"} (${c?.userId || d.referralCode}) status=${d.status} plan=${d.planType} activated=${d.planAJoinedAt?.toISOString?.() || "-"} => ${flag}`,
  );
}

console.log("\n=== VERDICT ===");
console.log({
  claim: "7 referrals but earnings for only 5",
  totalDirectsAnyStatus: directs.length,
  activeDirectsEligibleForPerActivation: activePlanA.length,
  perActivationCreditsPaid: paid,
  activeMissingPerActivationCredit: missing,
  unpaidOrInactiveDirects: notEligible,
  claimTrue:
    activePlanA.length >= 7 && paid <= 5
      ? "LIKELY TRUE — investigate missing credits"
      : activePlanA.length === 7 && paid === 5
        ? "TRUE — 7 active, only 5 paid"
        : activePlanA.length === paid
          ? "FALSE — every active direct has per-activation credit"
          : `PARTIAL — active=${activePlanA.length}, paid=${paid}, missing=${missing}`,
});

await mongoose.disconnect();
console.log("\nDone (read-only).");
