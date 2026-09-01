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
  const filter = { _id: productId, sellerId };
  const update = { $inc: { stock: -qty } };
  const options = { new: true, session };

  const normVariantSku = String(variantSku || "").trim();
  if (normVariantSku) {
    filter.variants = {
      $elemMatch: {
        $or: [{ sku: normVariantSku }, { name: normVariantSku }],
        stock: { $gte: qty },
      },
    };
    update.$inc["variants.$[v].stock"] = -qty;
    options.arrayFilters = [
      { $or: [{ "v.sku": normVariantSku }, { "v.name": normVariantSku }] },
    ];
  } else {
    filter.stock = { $gte: qty };
  }

  let updated = await Product.findOneAndUpdate(filter, update, options);

  if (!updated && normVariantSku) {
    // Fallback attempt: if variant stock was not nested or root stock check failed
    delete filter.variants;
    delete update.$inc["variants.$[v].stock"];
    delete options.arrayFilters;
    filter.stock = { $gte: qty };
    updated = await Product.findOneAndUpdate(filter, update, options);
  }

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
        variantSku: normVariantSku || null,
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
  variantSku = "",
  variantName = "",
}) {
  const qty = Math.max(1, Number(quantity) || 0);
  const normVariantSku = String(variantSku || "").trim();
  const normVariantName = String(variantName || "").trim();

  const ledger = await FranchiseStockLedger.findOneAndUpdate(
    { franchisePartnerId, productId, variantSku: normVariantSku },
    {
      $inc: { quantity: qty },
      $set: {
        note: note || "Stock movement",
        variantName: normVariantName,
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
        variantSku: normVariantSku || null,
        variantName: normVariantName || null,
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
  variantSku = "",
}) {
  const qty = Math.max(1, Number(quantity) || 0);
  const normVariantSku = String(variantSku || "").trim();

  // 1. Try exact variant SKU match if provided
  let ledger;
  if (normVariantSku) {
    ledger = await FranchiseStockLedger.findOneAndUpdate(
      { franchisePartnerId, productId, variantSku: normVariantSku, quantity: { $gte: qty } },
      { $inc: { quantity: -qty } },
      { new: true, session },
    );
  }

  // 2. Try default (empty variantSku) match
  if (!ledger) {
    ledger = await FranchiseStockLedger.findOneAndUpdate(
      { franchisePartnerId, productId, variantSku: "", quantity: { $gte: qty } },
      { $inc: { quantity: -qty } },
      { new: true, session },
    );
  }

  // 3. Try any single ledger row with sufficient quantity
  if (!ledger) {
    ledger = await FranchiseStockLedger.findOneAndUpdate(
      { franchisePartnerId, productId, quantity: { $gte: qty } },
      { $inc: { quantity: -qty } },
      { new: true, session },
    );
  }

  // 4. Fallback: split decrement across multiple ledger rows if stock is fragmented
  if (!ledger) {
    const rows = await FranchiseStockLedger.find(
      { franchisePartnerId, productId, quantity: { $gt: 0 } },
      null,
      { session },
    ).sort({ quantity: -1 });

    const totalAvailable = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    if (totalAvailable >= qty) {
      let remaining = qty;
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(row.quantity, remaining);
        await FranchiseStockLedger.updateOne(
          { _id: row._id },
          { $inc: { quantity: -take } },
          { session }
        );
        row.quantity -= take;
        remaining -= take;
        ledger = row;
      }
    }
  }

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
        variantSku: normVariantSku || null,
      },
    ],
    { session },
  );

  return ledger;
}

/**
 * Reserve (decrement) franchise ledger stock for every item in a newly
 * placed order fulfilled by that franchise. Single-nearest-franchise
 * model: the decrement happens HERE, at placement, rather than later at
 * physical hand-over — this is the "hold" that stops a concurrent sale
 * (online or in-person POS) from taking the same units before delivery.
 * Reuses the same atomic per-item guard `decrementFranchiseStock`
 * already provides (`quantity: {$gte: qty}`), so this is race-safe.
 *
 * `fulfillFranchiseOrder` already skips its own decrement when
 * `order.franchiseStockConsumed` is true (set by the caller here), so
 * calling this at placement does not double-decrement at fulfillment.
 */
export async function reserveFranchiseStockForItems({
  items,
  franchisePartnerId,
  orderId,
  publicOrderId = null,
  session,
}) {
  for (const item of items || []) {
    const productId = item.productId || item.product?._id || item.product;
    const qty = Math.max(1, Number(item.quantity) || 1);
    if (!productId) continue;
    await decrementFranchiseStock({
      franchisePartnerId,
      productId,
      quantity: qty,
      session,
      type: FRANCHISE_STOCK_TYPES.FULFILLMENT,
      note: `Order #${publicOrderId || orderId} placed — franchise stock reserved`,
      orderId,
      variantSku: item.variantSku || item.sku || "",
    });
  }
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

/**
 * Restore hub Product.stock when a dispatched transfer is cancelled.
 */
export async function restoreHubProductStock({
  productId,
  sellerId,
  quantity,
  session,
  type = HUB_STOCK_TYPES.ADJUSTMENT_IN,
  note,
  orderId = null,
  transferGroupId = null,
  variantSku = null,
}) {
  const qty = Math.max(1, Number(quantity) || 0);
  const normVariantSku = String(variantSku || "").trim();
  const filter = { _id: productId, sellerId };
  const update = { $inc: { stock: qty } };
  const options = { new: true, session };

  if (normVariantSku) {
    update.$inc["variants.$[v].stock"] = qty;
    options.arrayFilters = [
      { $or: [{ "v.sku": normVariantSku }, { "v.name": normVariantSku }] },
    ];
  }

  const updated = await Product.findOneAndUpdate(filter, update, options);
  await StockHistory.create(
    [
      {
        product: productId,
        seller: sellerId,
        type,
        quantity: qty,
        note: note || `Stock restored (${type})`,
        order: orderId,
        transferGroupId,
        variantSku: normVariantSku || null,
      },
    ],
    { session },
  );

  return { product: updated, newStock: updated?.stock || 0 };
}

