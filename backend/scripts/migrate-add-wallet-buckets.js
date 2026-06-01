/**
 * migrate-add-wallet-buckets.js
 *
 * MLM Phase 1 migration. Adds the two new bucket fields to every
 * pre-existing Wallet row so `creditWallet({bucket:"shopping"|"earnings"})`
 * doesn't hit `undefined` arithmetic.
 *
 * Idempotent: only sets fields that are missing (via `$set` with
 * `$exists: false` filter). Safe to re-run.
 *
 * Usage:
 *   node backend/scripts/migrate-add-wallet-buckets.js              # dry-run
 *   node backend/scripts/migrate-add-wallet-buckets.js --apply      # write
 *
 * Reverse: not provided — these fields are purely additive. To roll
 *          back, drop the columns manually via mongo shell:
 *            db.wallets.updateMany({}, { $unset: { shoppingBalance: "", earningsBalance: "" } })
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Wallet from "../app/models/wallet.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();

  const summary = {
    walletsScanned: 0,
    needShoppingBucket: 0,
    needEarningsBucket: 0,
    writesApplied: 0,
    apply: APPLY,
  };

  const total = await Wallet.countDocuments({});
  summary.walletsScanned = total;

  const needShopping = await Wallet.countDocuments({ shoppingBalance: { $exists: false } });
  const needEarnings = await Wallet.countDocuments({ earningsBalance: { $exists: false } });
  summary.needShoppingBucket = needShopping;
  summary.needEarningsBucket = needEarnings;

  if (APPLY) {
    const r1 = await Wallet.updateMany(
      { shoppingBalance: { $exists: false } },
      { $set: { shoppingBalance: 0 } },
    );
    const r2 = await Wallet.updateMany(
      { earningsBalance: { $exists: false } },
      { $set: { earningsBalance: 0 } },
    );
    summary.writesApplied = (r1?.modifiedCount || 0) + (r2?.modifiedCount || 0);
    console.log(`[migrate-add-wallet-buckets] shoppingBalance set on ${r1?.modifiedCount || 0} rows`);
    console.log(`[migrate-add-wallet-buckets] earningsBalance set on ${r2?.modifiedCount || 0} rows`);
  } else {
    console.log("[migrate-add-wallet-buckets] (dry-run) Would set shoppingBalance on", needShopping, "rows");
    console.log("[migrate-add-wallet-buckets] (dry-run) Would set earningsBalance on", needEarnings, "rows");
  }

  // Verification pass — these counts must be zero after a successful apply.
  const checkShop = await Wallet.countDocuments({ shoppingBalance: { $exists: false } });
  const checkEarn = await Wallet.countDocuments({ earningsBalance: { $exists: false } });
  summary.postMigrationMissingShopping = checkShop;
  summary.postMigrationMissingEarnings = checkEarn;

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[migrate-add-wallet-buckets] FAILED:", error);
  process.exit(1);
});
