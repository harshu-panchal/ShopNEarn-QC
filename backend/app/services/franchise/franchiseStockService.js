import mongoose from "mongoose";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Product from "../../models/product.js";
import Order from "../../models/order.js";
import { generateUniquePublicOrderId } from "../orderIdService.js";
import { FRANCHISE_IDEMPOTENCY_PREFIX } from "../../constants/franchise.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../../constants/finance.js";
import { debitWallet } from "../finance/walletService.js";
import { listHubCatalogProducts } from "./franchiseCatalogService.js";
import { getFranchiseWalletBalance } from "./franchiseWalletService.js";
import {
  buildInsufficientStockMessage,
  resolveAvailableStock,
} from "../../utils/productStockUtils.js";
import {
  createTransferGroupId,
  decrementHubProductStock,
  incrementFranchiseStock,
} from "../inventory/inventoryMovementService.js";
import { HUB_STOCK_TYPES, FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";

export async function getFranchiseStockSummary(franchisePartnerId) {
  const rows = await FranchiseStockLedger.find({ franchisePartnerId }).lean();
  const productIds = rows.map((r) => r.productId);
  const products = productIds.length
    ? await Product.find(
        { _id: { $in: productIds } },
        { name: 1, price: 1, salePrice: 1, mainImage: 1, galleryImages: 1, variants: 1 },
      ).lean()
    : [];
  const pmap = new Map(products.map((p) => [String(p._id), p]));
  return rows.map((row) => ({
    ...row,
    product: pmap.get(String(row.productId)) || null,
  }));
}

/**
 * Franchise B2B stock purchase from Harsh's Hub catalog using wallet balance.
 * Atomically: hub stock out + franchise ledger in (linked transferGroupId).
 */
export async function purchaseFranchiseStock({
  franchisePartnerId,
  userId,
  items,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("Cart is empty");
    err.statusCode = 400;
    throw err;
  }

  const partner = await FranchisePartner.findById(franchisePartnerId);
  if (!partner || String(partner.userId) !== String(userId)) {
    const err = new Error("Franchise partner not found");
    err.statusCode = 404;
    throw err;
  }

  if (!partner.hasCompletedFirstTopup) {
    const err = new Error(
      "First top-up must be fulfilled by Admin. Self-purchasing stock is available after your first top-up is completed.",
    );
    err.statusCode = 400;
    err.code = "FIRST_TOPUP_PENDING_ADMIN_SELECTION";
    throw err;
  }

  const catalog = await listHubCatalogProducts({ limit: 500 });
  const hubProductIds = new Set(catalog.items.map((p) => String(p._id)));

  let totalCost = 0;
  const lineItems = [];
  for (const line of items) {
    const productId = String(line.productId || "");
    const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
    if (!hubProductIds.has(productId)) {
      const err = new Error("Product is not available in hub catalog");
      err.statusCode = 422;
      throw err;
    }
    const product = catalog.items.find((p) => String(p._id) === productId);
    const available = resolveAvailableStock(product, "");
    if (qty > available) {
      const err = new Error(buildInsufficientStockMessage(available, product?.name));
      err.statusCode = 422;
      err.code = "INSUFFICIENT_STOCK";
      throw err;
    }
    const unitPrice = Number(product.price) || 0;
    const lineTotal = unitPrice * qty;
    totalCost += lineTotal;
    lineItems.push({ productId, qty, unitPrice, lineTotal, name: product.name });
  }

  const wallet = await getFranchiseWalletBalance(franchisePartnerId);
  if (wallet.availableBalance < totalCost) {
    const err = new Error("Insufficient franchise wallet balance");
    err.statusCode = 422;
    err.code = "INSUFFICIENT_FRANCHISE_WALLET";
    throw err;
  }

  const session = await mongoose.startSession();
  const transferGroupId = createTransferGroupId();

  try {
    let stockOrderId;
    let stockOrderDocId;
    await session.withTransaction(async () => {
      const idempotencyKey = `${FRANCHISE_IDEMPOTENCY_PREFIX.STOCK_PURCHASE}-${franchisePartnerId}-${Date.now()}`;
      await debitWallet({
        ownerType: OWNER_TYPE.FRANCHISE,
        ownerId: franchisePartnerId,
        amount: totalCost,
        bucket: "available",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_STOCK_PURCHASE,
        ledgerReference: idempotencyKey,
        ledgerDescription: `Franchise stock purchase (${lineItems.length} SKU)`,
        idempotencyKey,
        metadata: { lineItems, transferGroupId },
        syncUserWalletBalance: false,
      });

      const publicOrderId = await generateUniquePublicOrderId({ session });
      const order = await Order.create(
        [
          {
            orderId: publicOrderId,
            customer: userId,
            seller: catalog.hubSellerId,
            address: {
              type: "Work",
              name: partner.displayName || "Franchise",
              address: "Stock purchase",
            },
            items: lineItems.map((l) => ({
              product: l.productId,
              quantity: l.qty,
              price: l.unitPrice,
              name: l.name,
            })),
            isFranchiseStockOrder: true,
            franchisePartnerId,
            status: "delivered",
            orderStatus: "delivered",
            workflowStatus: "DELIVERED",
            paymentMode: "ONLINE",
            paymentStatus: "PAID",
            pricing: { total: totalCost, grandTotal: totalCost },
          },
        ],
        { session },
      );
      stockOrderDocId = order[0]._id;
      stockOrderId = publicOrderId;

      for (const line of lineItems) {
        await decrementHubProductStock({
          productId: line.productId,
          sellerId: catalog.hubSellerId,
          quantity: line.qty,
          session,
          type: HUB_STOCK_TYPES.TRANSFER_OUT,
          note: `Transfer to franchise partner (${publicOrderId})`,
          orderId: stockOrderDocId,
          transferGroupId,
        });

        await incrementFranchiseStock({
          franchisePartnerId,
          productId: line.productId,
          quantity: line.qty,
          session,
          type: FRANCHISE_STOCK_TYPES.TRANSFER_IN,
          note: `Stock purchase from hub (${publicOrderId})`,
          orderId: stockOrderDocId,
          transferGroupId,
          createdBy: userId,
        });
      }
    });
    return { stockOrderId, stockOrderDocId, totalCost, lineItems, transferGroupId };
  } finally {
    await session.endSession();
  }
}
