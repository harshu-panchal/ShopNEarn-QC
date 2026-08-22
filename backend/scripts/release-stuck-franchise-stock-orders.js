/**
 * release-stuck-franchise-stock-orders.js
 *
 * One-off correction: every franchise "Buy Stock" purchase requires an
 * admin dispatch step (REQUESTED -> DISPATCHED_PENDING_RECEIPT) and a
 * receipt confirmation (-> DELIVERED, which is what actually credits
 * FranchiseStockLedger). No admin UI ever existed for the dispatch
 * step, so every such order across the whole platform has been stuck
 * at REQUESTED since creation — the order's top-level `status` says
 * "delivered" (set at creation time) which made this invisible.
 *
 * This script runs the REAL service functions
 * (`dispatchFranchiseStockOrder` + `approveFranchiseStockOrderReceipt`)
 * for every non-cancelled order still stuck at REQUESTED, exactly as
 * if an admin had clicked through the new Stock Orders admin page —
 * real hub stock decrements, real franchise stock ledger credits,
 * full audit trail via FranchiseStockMovement/HubStockMovement.
 *
 * Cancelled orders (status: "cancelled") are skipped entirely.
 *
 * Usage:
 *   node backend/scripts/release-stuck-franchise-stock-orders.js              # dry-run
 *   node backend/scripts/release-stuck-franchise-stock-orders.js --apply      # write
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Order from "../app/models/order.js";
import FranchisePartner from "../app/models/franchisePartner.js";
import {
  dispatchFranchiseStockOrder,
  approveFranchiseStockOrderReceipt,
} from "../app/services/franchise/franchiseStockService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();

  const stuck = await Order.find({
    isFranchiseStockOrder: true,
    franchiseStockStatus: "REQUESTED",
    status: { $ne: "cancelled" },
  })
    .select("orderId franchisePartnerId items")
    .lean();

  const partnerIds = [...new Set(stuck.map((o) => String(o.franchisePartnerId)))];
  const partners = await FranchisePartner.find({ _id: { $in: partnerIds } })
    .select("displayName referralCode")
    .lean();
  const pmap = new Map(partners.map((p) => [String(p._id), p]));

  console.log(
    APPLY
      ? `[release-stuck-franchise-stock-orders] Applying to ${stuck.length} order(s) across ${partnerIds.length} partner(s)...`
      : `[release-stuck-franchise-stock-orders] (dry-run) ${stuck.length} order(s) across ${partnerIds.length} partner(s) would be released:`,
  );

  const summary = { total: stuck.length, dispatched: 0, received: 0, failed: 0 };

  for (const order of stuck) {
    const partner = pmap.get(String(order.franchisePartnerId));
    const label = `${order.orderId} (${partner?.displayName || order.franchisePartnerId} / ${partner?.referralCode || "?"}) — ${(order.items || []).length} product(s)`;

    if (!APPLY) {
      console.log("  would release:", label);
      continue;
    }

    try {
      await dispatchFranchiseStockOrder({ orderId: order.orderId, adminId: null });
      summary.dispatched += 1;
      await approveFranchiseStockOrderReceipt({
        franchisePartnerId: order.franchisePartnerId,
        orderId: order.orderId,
        userId: null,
      });
      summary.received += 1;
      console.log("  released:", label);
    } catch (error) {
      summary.failed += 1;
      console.error("  FAILED:", label, "-", error.message);
    }
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[release-stuck-franchise-stock-orders] FAILED:", error);
  process.exit(1);
});
