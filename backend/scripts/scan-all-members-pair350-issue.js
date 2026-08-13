/**
 * Scan all members in the database for ₹350 pair-match events or rate discrepancies.
 *
 * Usage:
 *   node scripts/scan-all-members-pair350-issue.js
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import User from "../app/models/customer.js";
import Wallet from "../app/models/wallet.js";
import { MLM_BONUS_TYPE, MLM_COMMISSION_EVENT_STATUS } from "../app/constants/mlm.js";
import { OWNER_TYPE } from "../app/constants/finance.js";

dotenv.config();

async function scan() {
  await connectDB();
  console.log("\n=== DEEP DATABASE SCAN FOR ₹350 PAIR MATCH EVENTS & RATE DISCREPANCIES ===\n");

  // 1. Scan MlmCommissionEvent for any events with amount 350 or 350 in description
  const events350 = await MlmCommissionEvent.find({
    $or: [
      { bonusAmount: 350 },
      { cappedAmount: 350 },
      { netBonusAmount: 350 },
      { description: { $regex: /350/i } }
    ]
  }).lean();

  console.log(`1. Total Commission Events with amount = ₹350 or '350' in description: ${events350.length}`);

  if (events350.length === 0) {
    console.log("   --> Zero other events found with amount ₹350!");
  } else {
    // Get unique recipient userIds
    const userIds = [...new Set(events350.map(e => String(e.recipientId)))];
    const users = await User.find({ _id: { $in: userIds } }).select("name phone userId").lean();
    const memberships = await MlmMembership.find({ userId: { $in: userIds } }).select("userId referralCode status directReferralsCount").lean();
    const wallets = await Wallet.find({ ownerType: OWNER_TYPE.CUSTOMER, ownerId: { $in: userIds } }).lean();

    const userMap = new Map(users.map(u => [String(u._id), u]));
    const memMap = new Map(memberships.map(m => [String(m.userId), m]));
    const walletMap = new Map(wallets.map(w => [String(w.ownerId), w]));

    console.log(`\nFound ${events350.length} event(s) across ${userIds.length} member(s):`);

    events350.forEach((ev, idx) => {
      const uid = String(ev.recipientId);
      const u = userMap.get(uid) || {};
      const m = memMap.get(uid) || {};
      const w = walletMap.get(uid) || {};

      console.log(`\n--- Result #${idx + 1} ---`);
      console.log(`Event ID: ${ev._id}`);
      console.log(`User ID: ${uid} (${u.userId || m.referralCode || 'N/A'})`);
      console.log(`Name: ${u.name || 'N/A'}, Phone: ${u.phone || 'N/A'}`);
      console.log(`Referral Code: ${m.referralCode || 'N/A'}`);
      console.log(`Bonus Type: ${ev.bonusType}`);
      console.log(`Bonus Amount: ₹${ev.bonusAmount} (Capped: ₹${ev.cappedAmount})`);
      console.log(`Status: ${ev.status}`);
      console.log(`Date: ${ev.createdAt}`);
      console.log(`Description: "${ev.description}"`);
      console.log(`Meta:`, JSON.stringify(ev.meta || {}));
      console.log(`Current Earning Wallet Balance: ₹${w.earningsBalance || 0}`);
    });
  }

  // 2. Scan for ALL BINARY_PAIR_MATCH events across all members to check bonusAmounts distribution
  console.log("\n---------------------------------------------------------");
  console.log("2. BINARY PAIR MATCH EVENTS BONUS AMOUNT DISTRIBUTION");
  console.log("---------------------------------------------------------");

  const pairEventsBreakdown = await MlmCommissionEvent.aggregate([
    { $match: { bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH, status: MLM_COMMISSION_EVENT_STATUS.CREDITED } },
    { $group: { _id: "$bonusAmount", count: { $sum: 1 }, totalPaid: { $sum: "$cappedAmount" } } },
    { $sort: { _id: -1 } }
  ]);

  console.log("Credited Pair Match Events by Bonus Amount:");
  pairEventsBreakdown.forEach(row => {
    console.log(`  - Amount ₹${row._id}: ${row.count} event(s), Total Paid: ₹${row.totalPaid}`);
  });

  // 3. Scan for any member who has any pair match event with pairIncome/amount not matching 200, 250, 300, 400, 550
  const nonStandardPairEvents = await MlmCommissionEvent.find({
    bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    bonusAmount: { $nin: [200, 250, 300, 400, 550] }
  }).lean();

  console.log(`\n3. Non-standard Pair Match Events (amount not in [200, 250, 300, 400, 550]): ${nonStandardPairEvents.length}`);
  if (nonStandardPairEvents.length > 0) {
    nonStandardPairEvents.forEach(ev => {
      console.log(`  - Event ${ev._id}: User ${ev.recipientId}, Amount ₹${ev.bonusAmount}, Desc: "${ev.description}"`);
    });
  } else {
    console.log("   --> Zero non-standard pair match events found! All remaining pair match events match standard rate sheet tiers.");
  }

  await mongoose.disconnect();
  console.log("\nScan complete.\n");
}

scan();
