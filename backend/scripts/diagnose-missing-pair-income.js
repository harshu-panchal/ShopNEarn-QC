/**
 * READ-ONLY diagnostic: why did a member not receive binary team pair
 * (matching) income after a downline activation?
 *
 * Usage: node scripts/diagnose-missing-pair-income.js SE4C7NGSFB
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
  MLM_MEMBERSHIP_STATUS,
} from "../app/constants/mlm.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import {
  calculateBinaryPairs,
  countLegActivePlanAVolumes,
  countActivePlanADirects,
  resolvePairIncomeConfig,
} from "../app/services/mlm/mlmBinaryPairIncomeService.js";
import { hasCreditedDirectReferralFirstPairIncome } from "../app/services/mlm/mlmFirstPairIncomeGuard.js";

dotenv.config();

const code = (process.argv[2] || "").trim().toUpperCase();
if (!code) {
  console.error("Usage: node scripts/diagnose-missing-pair-income.js <REFERRAL_CODE>");
  process.exit(1);
}

await connectDB();

// referralCode mirrors the public Customer.userId after migration, but
// accept either identifier.
let mem = await MlmMembership.findOne({ referralCode: code }).lean();
if (!mem) {
  const customer = await Customer.findOne({ userId: code }).select("_id").lean();
  if (customer) {
    mem = await MlmMembership.findOne({ userId: customer._id }).lean();
  }
}
if (!mem) {
  console.log("Member not found:", code);
  process.exit(1);
}

const customer = await Customer.findById(mem.userId)
  .select("name phone userId")
  .lean();

console.log("\n=== MEMBER ===");
console.log({
  referralCode: mem.referralCode,
  publicUserId: customer?.userId,
  name: customer?.name,
  status: mem.status,
  planType: mem.planType,
  userId: String(mem.userId),
  binaryLeftChildId: String(mem.binaryLeftChildId || ""),
  binaryRightChildId: String(mem.binaryRightChildId || ""),
  pairsCompleted: mem.pairsCompleted,
  lastPaidPairIndex: mem.lastPaidPairIndex,
  binaryDailyPairTracker: mem.binaryDailyPairTracker,
  binaryTopupMember: mem.binaryTopupMember,
  snapshot: {
    leftLegTeamActiveCount: mem.leftLegTeamActiveCount,
    rightLegTeamActiveCount: mem.rightLegTeamActiveCount,
    binaryPairsEligible: mem.binaryPairsEligible,
    binaryLeftBalance: mem.binaryLeftBalance,
    binaryRightBalance: mem.binaryRightBalance,
    binaryPairSnapshotAt: mem.binaryPairSnapshotAt,
  },
});

// Live leg volumes and eligible pairs, exactly as the credit path counts.
const { leftActive, rightActive } = await countLegActivePlanAVolumes(mem, {});
const pairCalc = calculateBinaryPairs(leftActive, rightActive);
console.log("\n=== LIVE LEG VOLUMES (credit-path logic) ===");
console.log({
  leftActive,
  rightActive,
  totalPairsEligible: pairCalc.pairs,
  leftBalance: pairCalc.leftBalance,
  rightBalance: pairCalc.rightBalance,
  pairsCompletedOnMembership: mem.pairsCompleted || 0,
  unpaidEligiblePairs: Math.max(pairCalc.pairs - (mem.pairsCompleted || 0), 0),
});

// Tier resolution as of now.
const cfg = await getMlmConfig();
const directCount = await countActivePlanADirects(mem.userId, {});
const isTopup = Boolean(mem.binaryTopupMember);
const tier = resolvePairIncomeConfig(cfg, directCount, isTopup);
console.log("\n=== TIER / RATE ===");
console.log({
  activePlanADirectCount: directCount,
  isTopup,
  pairIncome: tier.pairIncome,
  dailyPairCap: tier.dailyPairCap,
  binaryPairIncomeTiers: cfg.binaryPairIncomeTiers,
});

const firstPairGuard = await hasCreditedDirectReferralFirstPairIncome(mem.userId, {});
console.log("firstDirectPairIncomeAlreadyCredited (pair #1 substitute):", firstPairGuard);

// Credited pair events + ledger rows.
const pairEvents = await MlmCommissionEvent.find({
  recipientId: mem.userId,
  bonusType: {
    $in: [
      MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
    ],
  },
})
  .sort({ createdAt: 1 })
  .lean();

console.log("\n=== PAIR-RELATED COMMISSION EVENTS ===");
for (const e of pairEvents) {
  console.log(
    `  ${e.createdAt?.toISOString?.()} ${e.bonusType} status=${e.status} ₹${e.cappedAmount ?? e.bonusAmount} key=${e.idempotencyKey} pairIndex=${e.meta?.pairIndex ?? "-"} trigger=${e.meta?.triggerUserId || e.sourceUserId || "-"}`,
  );
}

const wallet = await Wallet.findOne({
  ownerType: OWNER_TYPE.CUSTOMER,
  ownerId: mem.userId,
}).lean();
if (wallet) {
  const ledgerRows = await LedgerEntry.find({
    walletId: wallet._id,
    type: { $regex: "PAIR|DIRECT_REFERRAL" },
  })
    .sort({ createdAt: 1 })
    .lean();
  console.log("\n=== PAIR-RELATED LEDGER ROWS ===");
  for (const row of ledgerRows) {
    console.log(
      `  ${row.createdAt?.toISOString?.()} ${row.direction} ₹${row.amount} ${row.type} key=${row.idempotencyKey} pairIndex=${row.metadata?.pairIndex ?? "-"}`,
    );
  }
  console.log("\nWallet balances:", {
    earnings: wallet.earningsBalance,
    pending: wallet.pendingBalance,
    shopping: wallet.shoppingBalance,
  });
}

// Recent activations anywhere in this member's binary subtree (last 14 days).
const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
const subtree = await MlmMembership.aggregate([
  { $match: { userId: new mongoose.Types.ObjectId(String(mem.userId)) } },
  {
    $graphLookup: {
      from: MlmMembership.collection.name,
      startWith: "$userId",
      connectFromField: "userId",
      connectToField: "binaryParentId",
      as: "descendants",
      maxDepth: 64,
    },
  },
  { $unwind: "$descendants" },
  { $replaceRoot: { newRoot: "$descendants" } },
  {
    $match: {
      status: MLM_MEMBERSHIP_STATUS.ACTIVE,
      planAJoinedAt: { $gte: cutoff },
    },
  },
  {
    $project: {
      userId: 1,
      referralCode: 1,
      planAJoinedAt: 1,
      binaryParentId: 1,
      binaryPosition: 1,
    },
  },
  { $sort: { planAJoinedAt: -1 } },
]);

console.log(`\n=== SUBTREE ACTIVATIONS (last 14 days): ${subtree.length} ===`);
const activatedIds = subtree.map((row) => row.userId);
const activatedCustomers = await Customer.find({ _id: { $in: activatedIds } })
  .select("name userId")
  .lean();
const custById = new Map(activatedCustomers.map((c) => [String(c._id), c]));
for (const row of subtree) {
  const c = custById.get(String(row.userId));
  console.log(
    `  ${row.planAJoinedAt?.toISOString?.()} ${c?.name || "?"} (${c?.userId || row.referralCode}) pos=${row.binaryPosition} parent=${row.binaryParentId}`,
  );
}

// Which leg does each recent activation sit under, relative to this member?
if (subtree.length > 0 && (mem.binaryLeftChildId || mem.binaryRightChildId)) {
  const legOf = async (rootChildId) => {
    if (!rootChildId) return new Set();
    const rows = await MlmMembership.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(String(rootChildId)) } },
      {
        $graphLookup: {
          from: MlmMembership.collection.name,
          startWith: "$userId",
          connectFromField: "userId",
          connectToField: "binaryParentId",
          as: "descendants",
          maxDepth: 64,
        },
      },
      {
        $project: {
          ids: {
            $concatArrays: [["$userId"], "$descendants.userId"],
          },
        },
      },
    ]);
    return new Set((rows[0]?.ids || []).map(String));
  };
  const [leftSet, rightSet] = await Promise.all([
    legOf(mem.binaryLeftChildId),
    legOf(mem.binaryRightChildId),
  ]);
  console.log("\n=== RECENT ACTIVATION LEG PLACEMENT ===");
  for (const row of subtree) {
    const id = String(row.userId);
    const leg = leftSet.has(id) ? "LEFT" : rightSet.has(id) ? "RIGHT" : "OUTSIDE?";
    const c = custById.get(id);
    console.log(`  ${c?.userId || row.referralCode} -> ${leg}`);
  }
}

await mongoose.disconnect();
console.log("\nDone (read-only).");
