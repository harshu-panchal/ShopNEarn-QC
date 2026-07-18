import mongoose from "mongoose";
import Transaction from "../models/transaction.js";
import Order from "../models/order.js";
import CheckoutGroup from "../models/checkoutGroup.js";
import { releaseReservedStockForOrder } from "./stockService.js";
import { clearOrderTracking } from "./firebaseService.js";
import { reverseOrderFinanceOnCancellation } from "./finance/orderFinanceService.js";
import { restoreFranchiseStockForOrder } from "./franchise/franchiseOrderService.js";
async function updateCheckoutGroupAfterCancel(existing, { session } = {}) {
  if (!existing?.checkoutGroupId) return;
  const activeCount = await Order.countDocuments({
    checkoutGroupId: existing.checkoutGroupId,
    status: { $ne: "cancelled" },
    workflowStatus: { $ne: "CANCELLED" },
  }).session(session || null);

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
      session ? { session } : {},
    );
  }
}

/**
 * Apply stock/finance/checkout-group compensation for an already-cancelled order.
 * Prefer `cancelAndCompensateOrder` when the caller also owns the status transition.
 */
export async function compensateOrderCancellation(
  order,
  orderIdString,
  opts = {},
) {
  const {
    actorId = null,
    reason = "Cancelled before settlement",
    session: externalSession = null,
  } = opts;

  const run = async (session) => {
    const existingQuery = Order.findById(order._id);
    if (session) existingQuery.session(session);
    const existing = await existingQuery;
    if (!existing) {
      return {
        order: null,
        stockReleased: false,
        financeReversed: false,
        duplicate: false,
      };
    }

    const releaseResult = await releaseReservedStockForOrder(existing, {
      reason: "Cancelled",
      session,
    });
    // Keep the in-memory order aligned with the atomic claim so later
    // saves (e.g. franchise restore) cannot overwrite RELEASED status.
    if (releaseResult?.order?.stockReservation) {
      existing.stockReservation = releaseResult.order.stockReservation;
    }

    if (existing.franchisePartnerId && !existing.isFranchiseStockOrder) {
      await restoreFranchiseStockForOrder(existing, { session });
    }

    await Transaction.findOneAndUpdate(
      { reference: orderIdString },
      { status: "Failed" },
      session ? { session } : {},
    );

    await updateCheckoutGroupAfterCancel(existing, { session });

    let financeReversed = false;
    if (existing.paymentBreakdown?.grandTotal != null) {
      await reverseOrderFinanceOnCancellation(existing._id, {
        actorId,
        reason,
        session,
      });
      financeReversed = true;
    }

    return {
      order: existing,
      stockReleased: Boolean(releaseResult?.released),
      financeReversed,
      duplicate: Boolean(releaseResult?.duplicate),
    };
  };

  let result;
  if (externalSession) {
    // Caller owns the transaction and post-commit side effects.
    return run(externalSession);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      result = await run(session);
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
  } finally {
    session.endSession();
  }

  const canonicalOrderId = result?.order?.orderId || orderIdString;
  if (canonicalOrderId) {
    clearOrderTracking(canonicalOrderId).catch(() => {});
  }

  return result;
}

/**
 * Conditionally cancel an order and compensate inventory/finance in one transaction.
 */
export async function cancelAndCompensateOrder({
  filter,
  cancellationPatch,
  actorId = null,
  reason = "Cancelled before settlement",
  orderIdString = null,
} = {}) {
  if (!filter || typeof filter !== "object") {
    const err = new Error("cancelAndCompensateOrder requires a filter");
    err.statusCode = 500;
    throw err;
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const updated = await Order.findOneAndUpdate(
        filter,
        { $set: cancellationPatch || {} },
        { new: true, session },
      );

      if (!updated) {
        const err = new Error("Order not available to cancel");
        err.statusCode = 409;
        throw err;
      }

      const compensation = await compensateOrderCancellation(
        updated,
        orderIdString || updated.orderId,
        { actorId, reason, session },
      );

      result = {
        order: updated,
        stockReleased: compensation?.stockReleased,
        financeReversed: compensation?.financeReversed,
        duplicate: compensation?.duplicate,
      };
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
  } finally {
    session.endSession();
  }

  const canonicalOrderId = result?.order?.orderId || orderIdString;
  if (canonicalOrderId) {
    clearOrderTracking(canonicalOrderId).catch(() => {});
  }

  return result;
}
