import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import Order from "../app/models/order.js";
import LedgerEntry from "../app/models/ledgerEntry.js";

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const cancelled = await Order.find({
    $and: [
      { $or: [{ status: "cancelled" }, { workflowStatus: "CANCELLED" }] },
      {
        $or: [
          { "paymentBreakdown.walletAmount": { $gt: 0 } },
          { "pricing.walletAmount": { $gt: 0 } },
        ],
      },
    ],
    "financeFlags.cancellationReversalApplied": { $ne: true },
  })
    .sort({ updatedAt: -1 })
    .limit(20)
    .select({
      orderId: 1,
      customer: 1,
      status: 1,
      workflowStatus: 1,
      paymentBreakdown: 1,
      pricing: 1,
      financeFlags: 1,
      cancelledBy: 1,
      updatedAt: 1,
    })
    .lean();

  const rows = [];
  for (const order of cancelled) {
    const refund = await LedgerEntry.exists({
      orderId: order._id,
      type: "WALLET_REFUND",
      direction: "CREDIT",
    });
    if (!refund) {
      rows.push({
        orderId: order.orderId,
        walletAmount:
          order.paymentBreakdown?.walletAmount || order.pricing?.walletAmount || 0,
        walletSplit: order.paymentBreakdown?.walletSplit || null,
        cancelledBy: order.cancelledBy,
        updatedAt: order.updatedAt,
      });
    }
  }
  console.log(JSON.stringify(rows, null, 2));
  await mongoose.disconnect();
}

run().catch(console.error);
