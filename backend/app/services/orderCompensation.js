import Transaction from "../models/transaction.js";
import Order from "../models/order.js";
import CheckoutGroup from "../models/checkoutGroup.js";
import { releaseReservedStockForOrder } from "./stockService.js";
import { clearOrderTracking } from "./firebaseService.js";
import { reverseOrderFinanceOnCancellation } from "./finance/orderFinanceService.js";
import logger from "./logger.js";

/**
 * Reverse stock and fail seller transaction when an order is cancelled
 * after stock was deducted at placement.
 *
 * This function is the single chokepoint hit by every cancellation path
 * (seller timeout, payment timeout, delivery timeout, customer cancel,
 * auto-cancel job), so realtime tracking cleanup is wired here once and
 * stays consistent regardless of which caller triggers the cancellation.
 *
 * Audit Phase 3 (C-3): finance reversal (refund wallet redemption + debit
 * admin wallet for captured online payment) is also wired here so that
 * v2 cancellations stop silently keeping the customer's money. The
 * reversal is idempotent via `Order.financeFlags.cancellationReversalApplied`
 * (set inside the reversal's own transaction), so retried jobs and
 * legacy v1 callers that already invoke `reverseOrderFinanceOnCancellation`
 * directly (orderController.cancelOrder) never double-refund.
 */
export async function compensateOrderCancellation(order, orderIdString, opts = {}) {
  const { actorId = null, reason = "Cancelled before settlement" } = opts;

  const existing = await Order.findById(order._id);
  if (existing) {
    await releaseReservedStockForOrder(existing, {
      reason: "Cancelled",
    });
    await existing.save();
  }

  await Transaction.findOneAndUpdate(
    { reference: orderIdString },
    { status: "Failed" },
  );

  if (existing?.checkoutGroupId) {
    const activeCount = await Order.countDocuments({
      checkoutGroupId: existing.checkoutGroupId,
      status: { $ne: "cancelled" },
      workflowStatus: { $ne: "CANCELLED" },
    });
    if (activeCount === 0) {
      await CheckoutGroup.updateOne(
        { checkoutGroupId: existing.checkoutGroupId },
        {
          $set: {
            status: "CANCELLED",
            paymentStatus: "FAILED",
            "stockReservation.status": "RELEASED",
            "stockReservation.releasedAt": new Date(),
          },
        },
      );
    }
  }

  // Audit Phase 3 (C-3): refund wallet redemption + reverse captured
  // online payment. Idempotent through `financeFlags.cancellationReversalApplied`
  // — orderController.cancelOrder (v1) and this v2 path can both fire safely.
  //
  // Only invoked when the order carries a frozen pricing snapshot
  // (`paymentBreakdown.grandTotal != null`). Older orders that never went
  // through the new placement flow skip the reversal to avoid touching
  // wallets without a known refund amount; ops can backfill via the
  // audit-plan migration if needed.
  //
  // Failures are logged and swallowed (mirroring orderController.cancelOrder
  // L350-358). The cancellation path itself must not roll back stock release
  // or tracking cleanup because the finance reversal failed — surface the
  // error to ops and retry via the standard finance recovery tooling.
  if (existing?.paymentBreakdown?.grandTotal != null) {
    try {
      await reverseOrderFinanceOnCancellation(existing._id, {
        actorId,
        reason,
      });
    } catch (financeError) {
      logger.warn?.("compensateOrderCancellation finance reversal failed", {
        scope: "compensateOrderCancellation",
        orderId: existing.orderId || orderIdString,
        error: financeError?.message,
      });
    }
  }

  // Fire-and-forget cleanup of realtime tracking nodes. Mongo state is
  // already cancelled at this point — keeping RTDB nodes around would
  // just leave stale "live" markers on customer maps and bloat costs.
  const canonicalOrderId = existing?.orderId || orderIdString;
  if (canonicalOrderId) {
    clearOrderTracking(canonicalOrderId).catch(() => {});
  }
}
