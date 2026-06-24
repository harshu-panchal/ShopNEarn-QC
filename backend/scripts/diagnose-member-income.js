/**
 * One-off diagnose member by referral code
 * node backend/scripts/diagnose-member-income.js SE41171865
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import Customer from "../app/models/customer.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import { classifyDirectReferralsByLegUnderRoot } from "../app/services/mlm/mlmBinaryTreeBuilder.js";
import { countDirectReferralLegPairsFromLegMap } from "../app/services/mlm/mlmSignupBonusService.js";

dotenv.config();

const code = (process.argv[2] || "").trim().toUpperCase();
if (!code) {
  console.error("Usage: node backend/scripts/diagnose-member-income.js <REFERRAL_CODE>");
  process.exit(1);
}

await connectDB();

const mem = await MlmMembership.findOne({ referralCode: code }).lean();
if (!mem) {
  console.log("Member not found:", code);
  process.exit(1);
}

const customer = await Customer.findById(mem.userId).select("name phone userId").lean();
const directs = await MlmMembership.find({
  sponsorId: mem.userId,
})
  .select("referralCode status planType planAJoinedAt binaryPosition binaryParentId createdAt")
  .lean();

const activeDirects = directs.filter(
  (d) => d.status === MLM_MEMBERSHIP_STATUS.ACTIVE && d.planType === MLM_PLAN_TYPE.A,
);

const legMap = await classifyDirectReferralsByLegUnderRoot({
  rootMembership: mem,
  directReferrals: activeDirects,
});
const legPairs = countDirectReferralLegPairsFromLegMap(activeDirects, legMap);

const events = await MlmCommissionEvent.find({ recipientId: mem.userId })
  .sort({ createdAt: -1 })
  .lean();

const wallet = await Wallet.findOne({
  ownerType: OWNER_TYPE.CUSTOMER,
  ownerId: mem.userId,
}).lean();

let ledger = [];
if (wallet) {
  ledger = await LedgerEntry.find({ walletId: wallet._id })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
}

console.log("\n=== MEMBER ===");
console.log({
  referralCode: mem.referralCode,
  name: customer?.name,
  status: mem.status,
  planType: mem.planType,
  userId: String(mem.userId),
});

console.log("\n=== WALLET ===");
console.log(wallet
  ? {
      earnings: wallet.earningsBalance,
      pending: wallet.pendingBalance,
      shopping: wallet.shoppingBalance,
    }
  : "NO WALLET");

console.log("\n=== DIRECT REFERRALS ===");
console.log(`Total: ${directs.length}, Active Plan A: ${activeDirects.length}`);
console.log(`Leg pairs (L+R): left=${legPairs.left} right=${legPairs.right} pairs=${legPairs.pairs}`);
for (const d of activeDirects) {
  console.log(
    `  ${d.referralCode} leg=${legMap.get(String(d._id)) || "?"} status=${d.status} joined=${d.planAJoinedAt}`,
  );
}

console.log("\n=== COMMISSION EVENTS (all time) ===");
const byType = {};
for (const e of events) {
  const k = `${e.bonusType}:${e.status}`;
  byType[k] = (byType[k] || 0) + (e.cappedAmount || e.bonusAmount || 0);
}
console.log("By type/status:", byType);

const dra = events.filter((e) => e.bonusType === MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION);
console.log("\nDIRECT_REFERRAL_ACTIVATION events:", dra.length);
for (const e of dra) {
  console.log(`  ${e.status} ₹${e.cappedAmount} key=${e.idempotencyKey} at=${e.createdAt}`);
}

const pairEvents = events.filter((e) => e.bonusType === MLM_BONUS_TYPE.BINARY_PAIR_MATCH);
const pairCredited = pairEvents.filter((e) => e.status === MLM_COMMISSION_EVENT_STATUS.CREDITED);
const pairPending = pairEvents.filter((e) => e.walletBucket === "pending" || e.status?.includes("held"));
console.log(`\nBINARY_PAIR_MATCH: total=${pairEvents.length} credited=${pairCredited.length}`);

const clawed = events.filter((e) => e.status === MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK);
console.log(`Clawed back events: ${clawed.length}`, clawed.map((e) => ({ type: e.bonusType, amt: e.clawbackAmount })));

console.log("\n=== RECENT LEDGER (earnings-related) ===");
for (const row of ledger.filter((l) => l.type?.includes("MLM"))) {
  console.log(`  ${row.direction} ₹${row.amount} ${row.type} ${row.createdAt?.toISOString?.() || row.createdAt}`);
}

await mongoose.disconnect();
