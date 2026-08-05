import Order from "../models/order.js";
import Product from "../models/product.js";
import StockHistory from "../models/stockHistory.js";
import { createLowStockAlertCandidate } from "./lowStockAlertService.js";

const ONLINE_RESERVATION_MS = () =>
  parseInt(process.env.ONLINE_STOCK_RESERVATION_MS || "900000", 10);

export function computeStockReservationWindow(paymentMode) {
  const now = new Date();
  if (String(paymentMode || "").toUpperCase() !== "ONLINE") {
    return {
      status: "COMMITTED",
      reservedAt: now,
      expiresAt: null,
      releasedAt: null,
    };
  }
  return {
    status: "RESERVED",
    reservedAt: now,
    expiresAt: new Date(now.getTime() + ONLINE_RESERVATION_MS()),
    releasedAt: null,
  };
}

export async function reserveStockForItems({
  items,
  sellerId,
  orderId,
  session,
  paymentMode = "COD",
}) {
  const stockType = String(paymentMode || "").toUpperCase() === "ONLINE" ? "Reservation" : "Sale";
  const lowStockAlerts = [];

  for (const item of items) {
    const variantSku = String(item.variantSku || "").trim();

    let updated = null;
    if (variantSku) {
      // 1. Primary atomic attempt using arrayFilters with sku/name $or match
      const filter = {
        _id: item.productId,
        variants: {
          $elemMatch: {
            $or: [{ sku: variantSku }, { name: variantSku }],
            stock: { $gte: item.quantity },
          },
        },
      };
      const update = {
        $inc: {
          stock: -item.quantity,
          "variants.$[v].stock": -item.quantity,
        },
      };
      const options = {
        new: true,
        session,
        arrayFilters: [
          { $or: [{ "v.sku": variantSku }, { "v.name": variantSku }] },
        ],
      };

      updated = await Product.findOneAndUpdate(filter, update, options);

      // Fallback 2: If root stock check or strict query blocked update, attempt single variant or unsynced stock fallback
      if (!updated) {
        const query = Product.findById(item.productId);
        if (session) query.session(session);
        const product = await query;

        if (product && Array.isArray(product.variants) && product.variants.length > 0) {
          const vIdx = product.variants.findIndex(
            (v) =>
              String(v.sku || "").trim() === variantSku ||
              String(v.name || "").trim() === variantSku ||
              product.variants.length === 1
          );

          if (vIdx !== -1) {
            const vStock = Math.max(0, Number(product.variants[vIdx].stock || 0));
            if (vStock >= item.quantity) {
              product.variants[vIdx].stock -= item.quantity;
              product.stock = Math.max(
                0,
                product.variants.reduce(
                  (sum, v) => sum + Math.max(0, Number(v.stock || 0)),
                  0,
                ),
              );
              await product.save({ session });
              updated = product;
            }
          }
        }
      }
    } else {
      updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          stock: { $gte: item.quantity },
        },
        {
          $inc: { stock: -item.quantity },
        },
        { new: true, session },
      );

      if (!updated) {
        const query = Product.findById(item.productId);
        if (session) query.session(session);
        const product = await query;
        if (product && Array.isArray(product.variants) && product.variants.length > 0) {
          const variantSum = product.variants.reduce((sum, v) => sum + Math.max(0, Number(v.stock || 0)), 0);
          if (variantSum >= item.quantity) {
            product.stock = Math.max(0, variantSum - item.quantity);
            if (product.variants[0]) {
              product.variants[0].stock = Math.max(0, Number(product.variants[0].stock || 0) - item.quantity);
            }
            await product.save({ session });
            updated = product;
          }
        }
      }
    }

    if (!updated) {
      const err = new Error(`Insufficient stock for product: ${item.productName}${variantSku ? ` (variant: ${variantSku})` : ""}`);
      err.statusCode = 409;
      throw err;
    }

    await StockHistory.create(
      [
        {
          product: item.productId,
          seller: sellerId,
          type: stockType,
          quantity: -item.quantity,
          note: `Order #${orderId} ${stockType.toLowerCase()}${variantSku ? ` [variant: ${variantSku}]` : ""}`,
          variantSku: variantSku || null,
        },
      ],
      { session },
    );

    const previousStock = Number(updated.stock || 0) + Number(item.quantity || 0);
    let previousVariantStock = null;
    let currentVariantStock = null;

    if (variantSku) {
      const matchedVariant = Array.isArray(updated.variants)
        ? updated.variants.find(
          (variant) => String(variant?.sku || "").trim() === variantSku,
        )
        : null;
      if (matchedVariant) {
        currentVariantStock = Number(matchedVariant.stock || 0);
        previousVariantStock = currentVariantStock + Number(item.quantity || 0);
      }
    }

    const alertCandidate = createLowStockAlertCandidate({
      product: updated,
      previousStock,
      currentStock: Number(updated.stock || 0),
      variantSku,
      previousVariantStock,
      currentVariantStock,
    });

    if (alertCandidate) {
      lowStockAlerts.push(alertCandidate);
    }
  }

  return lowStockAlerts;
}

function aggregateReleaseLines(items = []) {
  const aggregated = new Map();
  items.forEach((item, index) => {
    const productId = item?.product?._id || item?.product;
    if (!productId) {
      const err = new Error(`Order item ${index} is missing product reference`);
      err.statusCode = 500;
      throw err;
    }
    const quantity = Number(item.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const err = new Error(`Order item ${index} has invalid quantity`);
      err.statusCode = 500;
      throw err;
    }
    const variantSku = String(item.variantSku || item.variantSlot || "").trim();
    const key = `${String(productId)}::${variantSku}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      aggregated.set(key, {
        productId,
        variantSku,
        quantity,
        lineIndex: index,
      });
    }
  });
  return Array.from(aggregated.values());
}

/**
 * Atomically claim and restore reserved/committed stock for an order.
 * Returns:
 *   { released: true, order }  – stock was restored in this call
 *   { released: false, order, duplicate: true } – already RELEASED (idempotent)
 */
export async function releaseReservedStockForOrder(
  order,
  { session = null, reason = "Reservation released" } = {},
) {
  if (!order?._id) {
    return { released: false, order: null, duplicate: false };
  }

  const claimFilter = {
    _id: order._id,
    $or: [
      { "stockReservation.status": { $in: ["RESERVED", "COMMITTED"] } },
      { "stockReservation.status": { $exists: false } },
      { "stockReservation.status": null },
    ],
  };
  const claimUpdate = {
    $set: {
      "stockReservation.status": "RELEASED",
      "stockReservation.releasedAt": new Date(),
    },
  };
  const claimOptions = { new: true };
  if (session) claimOptions.session = session;

  const claimed = await Order.findOneAndUpdate(claimFilter, claimUpdate, claimOptions);
  if (!claimed) {
    const currentQuery = Order.findById(order._id);
    if (session) currentQuery.session(session);
    const current = await currentQuery;
    if (current?.stockReservation?.status === "RELEASED") {
      order.stockReservation = current.stockReservation;
      return { released: false, order: current, duplicate: true };
    }
    const err = new Error(
      `Unable to claim stock release for order ${order.orderId || order._id}`,
    );
    err.statusCode = 409;
    throw err;
  }

  if (!Array.isArray(claimed.items) || claimed.items.length === 0) {
    order.stockReservation = claimed.stockReservation;
    return { released: true, order: claimed, duplicate: false };
  }

  const lines = aggregateReleaseLines(claimed.items);
  const writeOptions = session ? { session } : {};

  for (const line of lines) {
    let result;
    if (line.variantSku) {
      result = await Product.updateOne(
        {
          _id: line.productId,
          variants: {
            $elemMatch: { sku: line.variantSku },
          },
        },
        {
          $inc: {
            stock: line.quantity,
            "variants.$.stock": line.quantity,
          },
        },
        writeOptions,
      );
    } else {
      result = await Product.updateOne(
        { _id: line.productId },
        { $inc: { stock: line.quantity } },
        writeOptions,
      );
    }

    const matched = Number(result?.matchedCount ?? result?.n ?? 0);
    const modified = Number(result?.modifiedCount ?? result?.nModified ?? 0);
    if (matched !== 1 || modified !== 1) {
      const err = new Error(
        `Failed to restore stock for product ${line.productId}${
          line.variantSku ? ` (variant: ${line.variantSku})` : ""
        }`,
      );
      err.statusCode = 500;
      throw err;
    }

    await StockHistory.create(
      [
        {
          product: line.productId,
          seller: claimed.seller,
          type: "Release",
          quantity: line.quantity,
          note: `Order #${claimed.orderId} ${reason}${
            line.variantSku ? ` [variant: ${line.variantSku}]` : ""
          }`,
          order: claimed._id,
          variantSku: line.variantSku || null,
          idempotencyKey: `STOCK-RELEASE:${claimed._id}:${line.lineIndex}`,
        },
      ],
      writeOptions,
    );
  }

  order.stockReservation = claimed.stockReservation;
  order.items = claimed.items;
  return { released: true, order: claimed, duplicate: false };
}
