import crypto from "crypto";
import Product from "../../models/product.js";
import StockHistory from "../../models/stockHistory.js";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import FranchiseStockMovement from "../../models/franchiseStockMovement.js";
import { HUB_STOCK_TYPES, FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";
import { buildInsufficientStockMessage } from "../../utils/productStockUtils.js";

export function createTransferGroupId() {
  return `TRF-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Atomically decrement hub Product.stock and write StockHistory.
 * @returns {{ product: object, newStock: number }}
 */
export async function decrementHubProductStock({
  productId,
  sellerId,
  quantity,
  session,
  type = HUB_STOCK_TYPES.TRANSFER_OUT,
  note,
  orderId = null,
  transferGroupId = null,
  variantSku = null,
}) {
  const qty = Math.max(1, Number(quantity) || 0);
  const filter = { _id: productId, sellerId, stock: { $gte: qty } };

  const updated = await Product.findOneAndUpdate(
    filter,
    { $inc: { stock: -qty } },
    { new: true, session },
  );

  if (!updated) {
    const product = await Product.findOne({ _id: productId }).select("name stock").lean();
    const err = new Error(
      buildInsufficientStockMessage(product?.stock ?? 0, product?.name),
    );
    err.statusCode = 422;
    err.code = "INSUFFICIENT_STOCK";
    throw err;
  }

  await StockHistory.create(
    [
      {
        product: productId,
        seller: sellerId,
        type,
        quantity: -qty,
        note: note || `Stock out (${type})`,
        order: orderId,
        transferGroupId,
        variantSku,
      },
    ],
    { session },
  );

  return { product: updated, newStock: updated.stock };
}

/**
 * Increment franchise ledger and write movement row.
 */
export async function incrementFranchiseStock({
  franchisePartnerId,
  productId,
  quantity,
  session,
  type = FRANCHISE_STOCK_TYPES.TRANSFER_IN,
  note,
  orderId = null,
  transferGroupId = null,
  createdBy = null,
}) {
  const qty = Math.max(1, Number(quantity) || 0);

  const ledger = await FranchiseStockLedger.findOneAndUpdate(
    { franchisePartnerId, productId },
    {
      $inc: { quantity: qty },
      $set: {
        note: note || "Stock movement",
        ...(orderId ? { sourceStockOrderId: orderId } : {}),
      },
    },
    { upsert: true, new: true, session },
  );

  await FranchiseStockMovement.create(
    [
      {
        franchisePartnerId,
        productId,
        type,
        quantity: qty,
        balanceAfter: ledger.quantity,
        note: note || `Stock in (${type})`,
        order: orderId,
        transferGroupId,
        createdBy,
      },
    ],
    { session },
  );

  return ledger;
}

/**
 * Decrement franchise ledger; blocks if insufficient.
 */
export async function decrementFranchiseStock({
  franchisePartnerId,
  productId,
  quantity,
  session,
  type = FRANCHISE_STOCK_TYPES.FULFILLMENT,
  note,
  orderId = null,
  transferGroupId = null,
  createdBy = null,
}) {
  const qty = Math.max(1, Number(quantity) || 0);

  const ledger = await FranchiseStockLedger.findOneAndUpdate(
    { franchisePartnerId, productId, quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { new: true, session },
  );

  if (!ledger) {
    const err = new Error("Insufficient franchise stock to fulfill");
    err.statusCode = 422;
    err.code = "INSUFFICIENT_FRANCHISE_STOCK";
    throw err;
  }

  await FranchiseStockMovement.create(
    [
      {
        franchisePartnerId,
        productId,
        type,
        quantity: -qty,
        balanceAfter: ledger.quantity,
        note: note || `Stock out (${type})`,
        order: orderId,
        transferGroupId,
        createdBy,
      },
    ],
    { session },
  );

  return ledger;
}

/**
 * Restore franchise stock (e.g. cancelled order after fulfillment).
 */
export async function restoreFranchiseStock({
  franchisePartnerId,
  productId,
  quantity,
  session,
  type = FRANCHISE_STOCK_TYPES.RETURN_IN,
  note,
  orderId = null,
  createdBy = null,
}) {
  return incrementFranchiseStock({
    franchisePartnerId,
    productId,
    quantity,
    session,
    type,
    note,
    orderId,
    createdBy,
  });
}
