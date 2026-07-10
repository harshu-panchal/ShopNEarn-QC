/**
 * Refund wallet redemption for a cancelled order that missed finance reversal.
 *
 * Usage:
 *   node scripts/refund-cancelled-order-wallet.js <orderId>
 *   node scripts/refund-cancelled-order-wallet.js <orderId> --apply
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import Order from "../app/models/order.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import { reverseOrderFinanceOnCancellation } from "../app/services/finance/orderFinanceService.js";
import { OWNER_TYPE } from "../app/constants/finance.js";
import { orderMatchQueryFromRouteParam } from "../app/utils/orderLookup.js";

const orderIdArg = process.argv[2];
const apply = process.argv.includes("--apply");

if (!orderIdArg) {
  console.error("Usage: node scripts/refund-cancelled-order-wallet.js <orderId> [--apply]");
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const query = orderMatchQueryFromRouteParam(orderIdArg);
  const order = await Order.findOne(query).lean();
  if (!order) throw new Error(`Order not found: ${orderIdArg}`);

  const walletBefore = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: order.customer,
  }).lean();

  const walletRefundLedger = await LedgerEntry.findOne({
    orderId: order._id,
    type: "WALLET_REFUND",
    direction: "CREDIT",
  }).lean();

  console.log({
    orderId: order.orderId,
    status: order.status,
    workflowStatus: order.workflowStatus,
    walletAmount: order.paymentBreakdown?.walletAmount || order.pricing?.walletAmount || 0,
    walletSplit: order.paymentBreakdown?.walletSplit || null,
    cancellationReversalApplied: order.financeFlags?.cancellationReversalApplied || false,
    shoppingBalanceBefore: walletBefore?.shoppingBalance ?? 0,
    alreadyRefunded: !!walletRefundLedger,
    apply,
  });

  if (order.status !== "cancelled" && order.workflowStatus !== "CANCELLED") {
    throw new Error("Order is not cancelled — aborting");
  }
  if (walletRefundLedger || order.financeFlags?.cancellationReversalApplied) {
    console.log("Wallet refund already applied — no action needed.");
    await mongoose.disconnect();
    return;
  }

  const walletUsed = Number(order.paymentBreakdown?.walletAmount || order.pricing?.walletAmount || 0);
  if (walletUsed <= 0) {
    console.log("No wallet amount on this order — nothing to refund.");
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to credit the customer wallet.");
    await mongoose.disconnect();
    return;
  }

  await reverseOrderFinanceOnCancellation(order._id, {
    actorId: null,
    reason: "Manual wallet refund for cancelled order (ops backfill)",
  });

  const walletAfter = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: order.customer,
  }).lean();

  console.log({
    refunded: walletUsed,
    shoppingBalanceAfter: walletAfter?.shoppingBalance ?? 0,
  });

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
