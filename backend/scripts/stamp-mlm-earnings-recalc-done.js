import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import MlmMembership from "../app/models/mlmMembership.js";

dotenv.config();

const MIGRATION_ID = "MLM-EARN-RECALC-2026";

await connectDB();
const keys = await LedgerEntry.distinct("idempotencyKey", {
  idempotencyKey: new RegExp(`^${MIGRATION_ID}-`),
});
const userIds = new Set();
for (const k of keys) {
  const pair = k.match(new RegExp(`^${MIGRATION_ID}-PAIR-([a-f0-9]{24})-P`));
  if (pair?.[1]) userIds.add(pair[1]);
  const reset = k.match(new RegExp(`^${MIGRATION_ID}-RESET-([a-f0-9]{24})-`));
  if (reset?.[1]) userIds.add(reset[1]);
}
const ids = [...userIds];
const result = await MlmMembership.updateMany(
  { userId: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
  {
    $set: {
      "meta.earningsRecalcMigrationId": MIGRATION_ID,
      "meta.earningsRecalcAt": new Date(),
    },
  },
);
console.log("stamped", result.modifiedCount, "of", ids.length);
await mongoose.disconnect();
