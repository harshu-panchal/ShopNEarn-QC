import mongoose from "mongoose";
import FranchiseWalletTopUp from "../../models/franchiseWalletTopUp.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Order from "../../models/order.js";
import {
  FRANCHISE_IDEMPOTENCY_PREFIX,
  FRANCHISE_PAYMENT_MODE,
  FRANCHISE_TOPUP_STATUS,
} from "../../constants/franchise.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../../constants/finance.js";
import { creditWallet, debitWallet, getOrCreateWallet } from "../finance/walletService.js";
import { getFranchiseConfig } from "./franchiseConfigService.js";
import { getManualQrConfig } from "../mlm/mlmConfigService.js";
import { listHubCatalogProducts } from "./franchiseCatalogService.js";
import {
  buildInsufficientStockMessage,
  resolveAvailableStock,
  resolveSellingPrice,
} from "../../utils/productStockUtils.js";
import {
  createTransferGroupId,
  decrementHubProductStock,
  incrementFranchiseStock,
} from "../inventory/inventoryMovementService.js";
import { HUB_STOCK_TYPES, FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";
import { generateUniquePublicOrderId } from "../orderIdService.js";

export async function getFranchiseWalletBalance(franchisePartnerId, { session } = {}) {
  const wallet = await getOrCreateWallet(OWNER_TYPE.FRANCHISE, franchisePartnerId, { session });
  return {
    availableBalance: wallet.availableBalance || 0,
    pendingBalance: wallet.pendingBalance || 0,
    walletId: wallet._id,
  };
}

export async function createFranchiseWalletTopUpRequest({
  franchisePartnerId,
  userId,
  amount,
  idempotencyKey,
}) {
  const cfg = await getFranchiseConfig();
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    const err = new Error("Amount must be greater than 0");
    err.statusCode = 400;
    throw err;
  }

  const partner = await FranchisePartner.findById(franchisePartnerId);
  if (!partner || String(partner.userId) !== String(userId)) {
    const err = new Error("Franchise partner not found");
    err.statusCode = 404;
    throw err;
  }

  const isFirstTopup = !partner.hasCompletedFirstTopup;

  const topUp = await FranchiseWalletTopUp.create({
    franchisePartnerId,
    userId,
    amount: normalizedAmount,
    creditMultiplierSnapshot: Number(cfg.walletCreditMultiplier) || 2,
    status: FRANCHISE_TOPUP_STATUS.CREATED,
    paymentMode: FRANCHISE_PAYMENT_MODE.MANUAL_QR,
    idempotencyKey: idempotencyKey || `fr-topup-${franchisePartnerId}-${Date.now()}`,
    isFirstTopup,
  });

  const manualQr = await getManualQrConfig();
  return { topUp, manualQr };
}

export async function submitFranchiseTopUpProof({
  topUpId,
  userId,
  transactionId,
  screenshotUrl,
  paidAmount,
}) {
  const topUp = await FranchiseWalletTopUp.findById(topUpId);
  if (!topUp || String(topUp.userId) !== String(userId)) {
    const err = new Error("Top-up request not found");
    err.statusCode = 404;
    throw err;
  }
  if (!transactionId?.trim() || !screenshotUrl?.trim()) {
    const err = new Error("Transaction ID and screenshot are required");
    err.statusCode = 422;
    throw err;
  }
  topUp.manualPaymentDetails = {
    transactionId: String(transactionId).trim(),
    screenshotUrl: String(screenshotUrl).trim(),
    paidAmount: paidAmount != null ? Number(paidAmount) : topUp.amount,
    submittedAt: new Date(),
  };
  topUp.status = FRANCHISE_TOPUP_STATUS.PENDING_REVIEW;
  await topUp.save();
  return topUp;
}

export async function approveFranchiseWalletTopUp({ topUpId, adminId, adminRemarks, items = [] }) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const topUp = await FranchiseWalletTopUp.findById(topUpId).session(session);
      if (!topUp) {
        const err = new Error("Top-up not found");
        err.statusCode = 404;
        throw err;
      }
      if (topUp.status === FRANCHISE_TOPUP_STATUS.APPROVED) {
        result = { skipped: true, topUp };
        return;
      }

      const partner = await FranchisePartner.findById(topUp.franchisePartnerId).session(session);
      if (!partner) {
        const err = new Error("Franchise partner not found");
        err.statusCode = 404;
        throw err;
      }

      const isFirst = topUp.isFirstTopup || !partner.hasCompletedFirstTopup;

      if (isFirst) {
        if (!Array.isArray(items) || items.length === 0) {
          const err = new Error("For the first top-up, admin must select products to allocate to the franchise partner.");
          err.statusCode = 400;
          throw err;
        }

        const catalog = await listHubCatalogProducts({ limit: 2000 });
        const hubProductIds = new Set(catalog.items.map((p) => String(p._id)));

        let totalCost = 0;
        const lineItems = [];
        for (const line of items) {
          const productId = String(line.productId || "");
          const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
          if (!hubProductIds.has(productId)) {
            const err = new Error(`Product is not available in hub catalog`);
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
          const unitPrice = resolveSellingPrice(product);
          const lineTotal = unitPrice * qty;
          totalCost += lineTotal;
          lineItems.push({ productId, qty, unitPrice, lineTotal, name: product.name });
        }

        const creditAmount = Math.round(topUp.amount * (topUp.creditMultiplierSnapshot || 2) * 100) / 100;
        if (totalCost > creditAmount) {
          const err = new Error(`Total selected product cost (₹${totalCost}) exceeds the maximum credit budget (₹${creditAmount})`);
          err.statusCode = 422;
          throw err;
        }

        const topupCreditIdempotencyKey = `${FRANCHISE_IDEMPOTENCY_PREFIX.TOPUP_CREDIT}-${topUp._id}`;

        // 1. Credit full 2x top-up amount to franchise wallet
        await creditWallet({
          ownerType: OWNER_TYPE.FRANCHISE,
          ownerId: topUp.franchisePartnerId,
          amount: creditAmount,
          bucket: "available",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_WALLET_TOPUP_CREDIT,
          ledgerReference: String(topUp._id),
          ledgerDescription: `1st Franchise wallet top-up (${topUp.creditMultiplierSnapshot}x on ₹${topUp.amount})`,
          idempotencyKey: topupCreditIdempotencyKey,
          metadata: {
            adminId: adminId ? String(adminId) : null,
            depositedAmount: topUp.amount,
            multiplier: topUp.creditMultiplierSnapshot,
            isFirstTopup: true,
          },
          syncUserWalletBalance: false,
        });

        // 2. Create B2B Stock Transfer Order
        const transferGroupId = createTransferGroupId();
        const publicOrderId = await generateUniquePublicOrderId({ session });
        const order = await Order.create(
          [
            {
              orderId: publicOrderId,
              customer: topUp.userId,
              seller: catalog.hubSellerId,
              address: {
                type: "Work",
                name: partner.displayName || "Franchise",
                address: partner.address || "First top-up stock allocation",
              },
              items: lineItems.map((l) => ({
                product: l.productId,
                quantity: l.qty,
                price: l.unitPrice,
                name: l.name,
              })),
              isFranchiseStockOrder: true,
              franchisePartnerId: partner._id,
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
        const stockOrderDocId = order[0]._id;

        // 3. Debit products cost from franchise wallet
        const stockPurchaseIdempotencyKey = `${FRANCHISE_IDEMPOTENCY_PREFIX.STOCK_PURCHASE}-first-${topUp._id}`;
        await debitWallet({
          ownerType: OWNER_TYPE.FRANCHISE,
          ownerId: partner._id,
          amount: totalCost,
          bucket: "available",
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_STOCK_PURCHASE,
          ledgerReference: stockPurchaseIdempotencyKey,
          ledgerDescription: `1st Top-up stock allocation by Admin (${lineItems.length} SKU)`,
          idempotencyKey: stockPurchaseIdempotencyKey,
          metadata: { lineItems, transferGroupId, stockOrderDocId, publicOrderId, isFirstTopup: true },
          syncUserWalletBalance: false,
        });

        // 4. Update stock levels
        for (const line of lineItems) {
          await decrementHubProductStock({
            productId: line.productId,
            sellerId: catalog.hubSellerId,
            quantity: line.qty,
            session,
            type: HUB_STOCK_TYPES.TRANSFER_OUT,
            note: `First top-up transfer to franchise (${publicOrderId})`,
            orderId: stockOrderDocId,
            transferGroupId,
          });

          await incrementFranchiseStock({
            franchisePartnerId: partner._id,
            productId: line.productId,
            quantity: line.qty,
            session,
            type: FRANCHISE_STOCK_TYPES.TRANSFER_IN,
            note: `First top-up stock allocation from hub (${publicOrderId})`,
            orderId: stockOrderDocId,
            transferGroupId,
            createdBy: adminId || topUp.userId,
          });
        }

        partner.hasCompletedFirstTopup = true;
        await partner.save({ session });

        topUp.status = FRANCHISE_TOPUP_STATUS.APPROVED;
        topUp.approvedCreditAmount = creditAmount;
        topUp.allocatedItems = lineItems.map((l) => ({
          productId: l.productId,
          name: l.name,
          quantity: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        }));
        topUp.adminStockOrderId = stockOrderDocId;
        topUp.reviewedAt = new Date();
        topUp.reviewedBy = adminId || null;
        topUp.adminRemarks = adminRemarks || "";
        topUp.creditLedgerRef = topupCreditIdempotencyKey;
        topUp.isFirstTopup = true;
        await topUp.save({ session });

        result = {
          approved: true,
          topUp,
          isFirstTopup: true,
          creditAmount,
          totalCost,
          remainingBalance: creditAmount - totalCost,
          lineItems,
        };
        return;
      }

      const creditAmount = Math.round(topUp.amount * (topUp.creditMultiplierSnapshot || 2) * 100) / 100;
      const idempotencyKey = `${FRANCHISE_IDEMPOTENCY_PREFIX.TOPUP_CREDIT}-${topUp._id}`;

      await creditWallet({
        ownerType: OWNER_TYPE.FRANCHISE,
        ownerId: topUp.franchisePartnerId,
        amount: creditAmount,
        bucket: "available",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_WALLET_TOPUP_CREDIT,
        ledgerReference: String(topUp._id),
        ledgerDescription: `Franchise wallet top-up (${topUp.creditMultiplierSnapshot}x on ₹${topUp.amount})`,
        idempotencyKey,
        metadata: {
          adminId: adminId ? String(adminId) : null,
          depositedAmount: topUp.amount,
          multiplier: topUp.creditMultiplierSnapshot,
        },
        syncUserWalletBalance: false,
      });

      topUp.status = FRANCHISE_TOPUP_STATUS.APPROVED;
      topUp.approvedCreditAmount = creditAmount;
      topUp.reviewedAt = new Date();
      topUp.reviewedBy = adminId || null;
      topUp.adminRemarks = adminRemarks || "";
      topUp.creditLedgerRef = idempotencyKey;
      await topUp.save({ session });
      result = { approved: true, topUp, creditAmount };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function rejectFranchiseWalletTopUp({ topUpId, adminId, reason }) {
  const topUp = await FranchiseWalletTopUp.findById(topUpId);
  if (!topUp) {
    const err = new Error("Top-up not found");
    err.statusCode = 404;
    throw err;
  }
  topUp.status = FRANCHISE_TOPUP_STATUS.REJECTED;
  topUp.reviewedAt = new Date();
  topUp.reviewedBy = adminId || null;
  topUp.rejectionReason = reason || "";
  await topUp.save();
  return topUp;
}

export async function adjustFranchiseWallet({
  franchisePartnerId,
  amount,
  direction,
  reason,
  adminId,
}) {
  const session = await mongoose.startSession();
  try {
    let idempotencyKey;
    await session.withTransaction(async () => {
      idempotencyKey = `${FRANCHISE_IDEMPOTENCY_PREFIX.MANUAL_ADJUSTMENT}-${franchisePartnerId}-${Date.now()}`;
      const args = {
        ownerType: OWNER_TYPE.FRANCHISE,
        ownerId: franchisePartnerId,
        amount: Number(amount),
        bucket: "available",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_MANUAL_ADJUSTMENT,
        ledgerReference: idempotencyKey,
        ledgerDescription: `Manual adjustment: ${reason}`,
        idempotencyKey,
        metadata: { adminId: adminId ? String(adminId) : null, reason },
        syncUserWalletBalance: false,
      };
      if (String(direction).toUpperCase() === "CREDIT") {
        await creditWallet(args);
      } else {
        await debitWallet(args);
      }
    });
    return { idempotencyKey };
  } finally {
    await session.endSession();
  }
}

export async function listFranchiseTopUps({
  status,
  franchisePartnerId = null,
  page = 1,
  limit = 25,
} = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const filter = {};
  if (franchisePartnerId) filter.franchisePartnerId = franchisePartnerId;
  if (status && status !== "ALL") filter.status = status;
  else if (!status) filter.status = FRANCHISE_TOPUP_STATUS.PENDING_REVIEW;

  const [items, total] = await Promise.all([
    FranchiseWalletTopUp.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(safeLimit).lean(),
    FranchiseWalletTopUp.countDocuments(filter),
  ]);
  return { items, page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 };
}
