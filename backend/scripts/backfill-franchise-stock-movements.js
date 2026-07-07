/**
 * Idempotent backfill: seed FranchiseStockMovement from existing ledger balances
 * and historical franchise stock purchase orders.
 *
 * Run: node backend/scripts/backfill-franchise-stock-movements.js
 * Dry-run: DRY_RUN=true node backend/scripts/backfill-franchise-stock-movements.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import FranchiseStockLedger from "../app/models/franchiseStockLedger.js";
import FranchiseStockMovement from "../app/models/franchiseStockMovement.js";
import Order from "../app/models/order.js";
import { FRANCHISE_STOCK_TYPES } from "../app/constants/inventory.js";

const DRY_RUN = process.env.DRY_RUN === "true";

async function backfillOpeningBalances() {
  const ledgers = await FranchiseStockLedger.find({ quantity: { $gt: 0 } }).lean();
  let created = 0;
  let skipped = 0;

  for (const row of ledgers) {
    const exists = await FranchiseStockMovement.exists({
      franchisePartnerId: row.franchisePartnerId,
      productId: row.productId,
      type: FRANCHISE_STOCK_TYPES.CORRECTION,
      note: "Opening balance backfill",
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    if (!DRY_RUN) {
      await FranchiseStockMovement.create({
        franchisePartnerId: row.franchisePartnerId,
        productId: row.productId,
        type: FRANCHISE_STOCK_TYPES.CORRECTION,
        quantity: row.quantity,
        balanceAfter: row.quantity,
        note: "Opening balance backfill",
      });
    }
    created += 1;
  }
  return { created, skipped };
}

async function backfillStockPurchaseOrders() {
  const orders = await Order.find({
    isFranchiseStockOrder: true,
    franchisePartnerId: { $ne: null },
  }).lean();

  let created = 0;
  let skipped = 0;

  for (const order of orders) {
    for (const item of order.items || []) {
      const productId = item.product;
      const qty = Number(item.quantity) || 0;
      if (!productId || qty <= 0) continue;

      const exists = await FranchiseStockMovement.exists({
        franchisePartnerId: order.franchisePartnerId,
        productId,
        order: order._id,
        type: FRANCHISE_STOCK_TYPES.TRANSFER_IN,
      });
      if (exists) {
        skipped += 1;
        continue;
      }

      const ledger = await FranchiseStockLedger.findOne({
        franchisePartnerId: order.franchisePartnerId,
        productId,
      }).lean();

      if (!DRY_RUN) {
        await FranchiseStockMovement.create({
          franchisePartnerId: order.franchisePartnerId,
          productId,
          type: FRANCHISE_STOCK_TYPES.TRANSFER_IN,
          quantity: qty,
          balanceAfter: ledger?.quantity ?? qty,
          note: `Historical stock purchase (${order.orderId})`,
          order: order._id,
        });
      }
      created += 1;
    }
  }
  return { created, skipped };
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI required");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`[backfill] DRY_RUN=${DRY_RUN}`);

  const opening = await backfillOpeningBalances();
  console.log("[backfill] opening balances", opening);

  const purchases = await backfillStockPurchaseOrders();
  console.log("[backfill] stock purchase orders", purchases);

  await mongoose.disconnect();
  console.log("[backfill] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
