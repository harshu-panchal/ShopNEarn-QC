import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Wallet from "../app/models/wallet.js";
import { OWNER_TYPE } from "../app/constants/finance.js";

dotenv.config();

await connectDB();

const totalMembers = await MlmMembership.countDocuments({});
const planA = await MlmMembership.countDocuments({
  planType: "A",
  status: "active",
});
const planB = await MlmMembership.countDocuments({
  planType: "B",
  status: "active",
});
const planAAll = await MlmMembership.countDocuments({ planType: "A" });

const lifetimePayouts = await MlmCommissionEvent.aggregate([
  { $match: { status: "credited" } },
  { $group: { _id: null, total: { $sum: "$cappedAmount" }, count: { $sum: 1 } } },
]);

const byBonus = await MlmCommissionEvent.aggregate([
  { $match: { status: "credited" } },
  { $group: { _id: "$bonusType", total: { $sum: "$cappedAmount" }, count: { $sum: 1 } } },
  { $sort: { total: -1 } },
]);

const clawedBack = await MlmCommissionEvent.aggregate([
  { $match: { status: "clawed_back", "meta.recalcVoided": true } },
  { $group: { _id: "$bonusType", total: { $sum: "$cappedAmount" }, count: { $sum: 1 } } },
]);

const recalcPairs = await MlmCommissionEvent.aggregate([
  { $match: { status: "credited", "meta.migrationId": "MLM-EARN-RECALC-2026" } },
  { $group: { _id: null, total: { $sum: "$cappedAmount" }, count: { $sum: 1 } } },
]);

const earningsWallets = await Wallet.aggregate([
  { $match: { ownerType: OWNER_TYPE.CUSTOMER } },
  {
    $group: {
      _id: null,
      earnings: { $sum: "$earningsBalance" },
      pending: { $sum: "$pendingBalance" },
      shopping: { $sum: "$shoppingBalance" },
    },
  },
]);

const pairStats = await MlmMembership.aggregate([
  { $match: { status: "active", binaryPairsEligible: { $gt: 0 } } },
  {
    $group: {
      _id: null,
      members: { $sum: 1 },
      eligiblePairs: { $sum: "$binaryPairsEligible" },
      paidPairs: { $sum: "$pairsCompleted" },
    },
  },
]);

console.log(
  JSON.stringify(
    {
      dashboard: {
        totalMembers,
        planAActive: planA,
        planBActive: planB,
        planAAllTypes: planAAll,
        lifetimePayouts: lifetimePayouts[0]?.total || 0,
        lifetimeEventCount: lifetimePayouts[0]?.count || 0,
      },
      byBonusType: byBonus,
      clawedBackFromRecalc: clawedBack,
      recalcNewBinaryCredits: recalcPairs[0] || { total: 0, count: 0 },
      walletTotals: earningsWallets[0] || {},
      pairStats: pairStats[0] || {},
    },
    null,
    2,
  ),
);

await mongoose.disconnect();
