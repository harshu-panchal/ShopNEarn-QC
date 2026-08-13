/**
 * Fix Pair #2 over-credit for Bhaveshkumar Jamn... (SE10762512).
 *
 * Requirements:
 *   1. Update MlmCommissionEvent for Pair #2 (SE10762512 on 8 Aug 2026):
 *      - bonusAmount: 300, cappedAmount: 300, netBonusAmount: 300
 *      - description: "team pair #2 matched; 4 active directs tier => ₹300 per pair."
 *      - meta.pairIncome: 300
 *   2. Deduct ₹50 from Wallet.earningsBalance (1650 -> 1600).
 *   3. Deduct ₹50 from MlmMembership.lifetimePlanAEarnings.
 *   4. Write LedgerEntry for accounting audit.
 *
 * Usage:
 *   node scripts/fix-bhavesh-pair2-overcredit.js          (dry run)
 *   node scripts/fix-bhavesh-pair2-overcredit.js --apply  (execute changes)
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Wallet from "../app/models/wallet.js";
import User from "../app/models/customer.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import { MLM_BONUS_TYPE } from "../app/constants/mlm.js";
import { OWNER_TYPE, LEDGER_DIRECTION, LEDGER_TRANSACTION_TYPE } from "../app/constants/finance.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function run() {
  await connectDB();
  console.log(`\n=== FIX BHAVESH (SE10762512) PAIR #2 OVER-CREDIT [${APPLY ? "APPLY MODE" : "DRY RUN MODE"}] ===\n`);

  // 1. Locate Membership
  const membership = await MlmMembership.findOne({ referralCode: "SE10762512" });
  if (!membership) {
    console.error("Error: Membership for SE10762512 not found!");
    process.exit(1);
  }

  const userId = membership.userId;
  const user = await User.findById(userId).select("name phone userId walletBalance");
  const wallet = await Wallet.findOne({ ownerType: OWNER_TYPE.CUSTOMER, ownerId: userId });

  console.log("Found Member:", {
    referralCode: membership.referralCode,
    userId: String(userId),
    customUserId: user?.userId,
    name: user?.name,
    phone: user?.phone,
    currentEarningsBalance: wallet?.earningsBalance,
    currentLifetimePlanAEarnings: membership.lifetimePlanAEarnings,
  });

  // 2. Find Commission Event for Pair #2
  const event = await MlmCommissionEvent.findOne({
    recipientId: userId,
    bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    $or: [
      { "meta.pairIndex": 2 },
      { idempotencyKey: { $regex: /-P2$/i } },
      { description: { $regex: /pair #2/i } }
    ]
  });

  if (!event) {
    console.error("Error: Pair #2 commission event for SE10762512 not found!");
    process.exit(1);
  }

  console.log("\nFound Target Event:", {
    eventId: String(event._id),
    bonusAmount: event.bonusAmount,
    cappedAmount: event.cappedAmount,
    description: event.description,
    status: event.status,
    createdAt: event.createdAt,
    meta: event.meta,
  });

  const oldAmount = event.cappedAmount || event.bonusAmount || 350;
  const newAmount = 300;
  const diff = oldAmount - newAmount; // 50

  const newDescription = "team pair #2 matched; 4 active directs tier => ₹300 per pair.";

  console.log(`\nProposed Changes:`);
  console.log(`- Commission Event ID ${event._id}:`);
  console.log(`  bonusAmount: ${event.bonusAmount} -> ${newAmount}`);
  console.log(`  cappedAmount: ${event.cappedAmount} -> ${newAmount}`);
  console.log(`  description: "${event.description}" -> "${newDescription}"`);
  console.log(`- Wallet (${wallet._id}):`);
  console.log(`  earningsBalance: ${wallet.earningsBalance} -> ${wallet.earningsBalance - diff}`);
  console.log(`- Membership (${membership._id}):`);
  console.log(`  lifetimePlanAEarnings: ${membership.lifetimePlanAEarnings} -> ${membership.lifetimePlanAEarnings - diff}`);

  if (!APPLY) {
    console.log("\n[DRY RUN] No changes were made. Re-run with '--apply' to execute these updates.\n");
    await mongoose.disconnect();
    return;
  }

  // Session for transactional safety
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // A. Update Commission Event
    event.bonusAmount = newAmount;
    event.cappedAmount = newAmount;
    event.netBonusAmount = newAmount;
    event.description = newDescription;
    if (event.meta) {
      event.meta.pairIncome = newAmount;
      event.meta.correctedFrom = oldAmount;
      event.meta.correctedAt = new Date();
    }
    await event.save({ session });
    console.log("✅ Commission event updated.");

    // B. Update Wallet
    const oldEarnings = wallet.earningsBalance || 0;
    wallet.earningsBalance = Math.max(0, oldEarnings - diff);
    await wallet.save({ session });
    console.log(`✅ Wallet earningsBalance updated: ₹${oldEarnings} -> ₹${wallet.earningsBalance}`);

    // Sync Customer.walletBalance if present
    if (user) {
      user.walletBalance = Math.max(0, (user.walletBalance || 0) - diff);
      await user.save({ session });
      console.log(`✅ Customer.walletBalance updated.`);
    }

    // C. Update MlmMembership
    const oldLifetime = membership.lifetimePlanAEarnings || 0;
    membership.lifetimePlanAEarnings = Math.max(0, oldLifetime - diff);
    await membership.save({ session });
    console.log(`✅ Membership lifetimePlanAEarnings updated: ₹${oldLifetime} -> ₹${membership.lifetimePlanAEarnings}`);

    // D. Write Audit Ledger Entry
    const auditKey = `MLM-ADJ-BHAVESH-P2-FIX-${Date.now()}`;
    const auditLedger = new LedgerEntry({
      transactionId: auditKey,
      idempotencyKey: auditKey,
      userId,
      actorType: OWNER_TYPE.CUSTOMER,
      actorId: userId,
      walletId: wallet._id,
      type: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
      direction: LEDGER_DIRECTION.DEBIT,
      amount: diff,
      walletBucket: "earnings",
      balanceAfter: wallet.earningsBalance,
      reference: `MlmCommissionEvent:${event._id}`,
      description: `Adjustment for Pair #2 rate correction: ₹${oldAmount} -> ₹${newAmount} (-₹${diff})`,
      metadata: {
        reason: "Rate sheet correction from ₹350/pair to ₹300/pair for 4 active directs tier",
        oldAmount,
        newAmount,
        diff,
      },
    });
    await auditLedger.save({ session });
    console.log("✅ Audit LedgerEntry written.");

    await session.commitTransaction();
    session.endSession();

    console.log("\n=== SUCCESS: All database records and history updated cleanly! ===\n");
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("\n❌ Transaction failed. Rolled back changes:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
