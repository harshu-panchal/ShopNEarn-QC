import mongoose from "mongoose";
import FranchiseWalletTopUp from "../../models/franchiseWalletTopUp.js";
import FranchisePartner from "../../models/franchisePartner.js";
import {
  FRANCHISE_IDEMPOTENCY_PREFIX,
  FRANCHISE_PAYMENT_MODE,
  FRANCHISE_TOPUP_STATUS,
} from "../../constants/franchise.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../../constants/finance.js";
import { creditWallet, debitWallet, getOrCreateWallet } from "../finance/walletService.js";
import { getFranchiseConfig } from "./franchiseConfigService.js";
import { getManualQrConfig } from "../mlm/mlmConfigService.js";

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

  const topUp = await FranchiseWalletTopUp.create({
    franchisePartnerId,
    userId,
    amount: normalizedAmount,
    creditMultiplierSnapshot: Number(cfg.walletCreditMultiplier) || 2,
    status: FRANCHISE_TOPUP_STATUS.CREATED,
    paymentMode: FRANCHISE_PAYMENT_MODE.MANUAL_QR,
    idempotencyKey: idempotencyKey || `fr-topup-${franchisePartnerId}-${Date.now()}`,
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

export async function approveFranchiseWalletTopUp({ topUpId, adminId, adminRemarks }) {
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
