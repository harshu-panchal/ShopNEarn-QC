import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
import Order from "./app/models/order.js";
import { settleDeliveredOrder } from "./app/services/finance/orderFinanceService.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const query = {
    orderStatus: "delivered",
    "financeFlags.deliveredSettlementApplied": { $ne: true },
  };

  const candidates = await Order.find(query).select("_id orderId createdAt").sort({ createdAt: 1 }).lean();
  console.log(`Found ${candidates.length} delivered-but-unsettled orders.`);

  if (DRY_RUN) {
    console.log("Dry run — not settling anything. Sample:");
    console.log(JSON.stringify(candidates.slice(0, 5), null, 2));
    process.exit(0);
  }

  let succeeded = 0;
  let failed = 0;
  const failures = [];

  for (const order of candidates) {
    try {
      await settleDeliveredOrder(order._id);
      succeeded += 1;
      console.log(`OK   ${order.orderId}`);
    } catch (err) {
      failed += 1;
      failures.push({ orderId: order.orderId, error: err.message });
      console.log(`FAIL ${order.orderId} — ${err.message}`);
    }
  }

  console.log("\n=== Backfill complete ===");
  console.log(`Total candidates: ${candidates.length}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    console.log(JSON.stringify(failures, null, 2));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill script crashed:", err);
  process.exit(1);
});
