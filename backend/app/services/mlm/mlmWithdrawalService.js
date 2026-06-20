import mongoose from "mongoose";
import Payout from "../../models/payout.js";
import MlmWithdrawalRequest from "../../models/mlmWithdrawalRequest.js";
import { lookupMembershipJoinedAtByUserIds } from "../../utils/mlmMemberJoinedAt.js";
import MlmMembership from "../../models/mlmMembership.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
  PAYOUT_STATUS,
  PAYOUT_TYPE,
} from "../../constants/finance.js";
import {
  MLM_IDEMPOTENCY_PREFIX,
  MLM_WITHDRAWAL_METHOD,
  MLM_WITHDRAWAL_STATUS,
} from "../../constants/mlm.js";
import { roundCurrency } from "../../utils/money.js";
import {
  creditWallet,
  debitWallet,
} from "../finance/walletService.js";
import { createLedgerEntry } from "../finance/ledgerService.js";
import { computeWithdrawalCharges, getMinWithdrawalAmount } from "./mlmConfigService.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";

/**
 * mlmWithdrawalService — customer cash-out lifecycle.
 *
 *   createWithdrawalRequest()  : atomic debit + ledger triple + pending Payout
 *   approveWithdrawalRequest() : marks request paid + payout COMPLETED
 *   rejectWithdrawalRequest()  : reverses the debit + cancels the payout
 *   cancelWithdrawalRequest()  : same reversal, initiated by the customer
 *   listForCustomer() / listForAdmin()
 *
 * Money flow on create (single Mongoose session):
 *   - Debit earningsBalance by `amount` (gross)            -> LedgerEntry MLM_WITHDRAWAL_GROSS_DEBIT
 *   - Informational ledger row for admin charge             -> LedgerEntry MLM_WITHDRAWAL_ADMIN_CHARGE
 *   - Informational ledger row for GST on admin charge      -> LedgerEntry MLM_WITHDRAWAL_GST_CHARGE
 *   - Create Payout({ beneficiaryModel: "User",
 *                     payoutType: "CUSTOMER_WITHDRAWAL",
 *                     status: PENDING,
 *                     amount: netPayoutAmount })            -> LedgerEntry MLM_WITHDRAWAL_NET_PAYOUT_QUEUED
 *
 * The two charge rows do NOT touch any wallet — they purely record the
 * deduction for the customer's transaction history and accounting.
 */

async function runInSession(externalSession, fn) {
  if (externalSession) {
    return fn(externalSession);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

function validateBeneficiary(beneficiary) {
  if (!beneficiary || typeof beneficiary !== "object") {
    throw new Error("Beneficiary details are required");
  }
  const method = String(beneficiary.method || "").toLowerCase();
  if (![MLM_WITHDRAWAL_METHOD.BANK, MLM_WITHDRAWAL_METHOD.UPI].includes(method)) {
    throw new Error("Withdrawal method must be 'bank' or 'upi'");
  }
  if (method === MLM_WITHDRAWAL_METHOD.BANK) {
    if (!beneficiary.accountHolderName) throw new Error("Account holder name is required");
    if (!beneficiary.accountNumber) throw new Error("Account number is required");
    if (!beneficiary.ifsc) throw new Error("IFSC is required");
  } else if (method === MLM_WITHDRAWAL_METHOD.UPI) {
    if (!beneficiary.upiId) throw new Error("UPI ID is required");
  }
  return {
    accountHolderName: String(beneficiary.accountHolderName || "").trim(),
    accountNumber: String(beneficiary.accountNumber || "").trim(),
    ifsc: String(beneficiary.ifsc || "").trim().toUpperCase(),
    upiId: String(beneficiary.upiId || "").trim(),
    panNumber: String(beneficiary.panNumber || "").trim().toUpperCase(),
    method,
  };
}

/**
 * Create a withdrawal request for the customer.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {number} args.amount   - gross amount the customer wants to withdraw
 * @param {object} args.beneficiary  - validated by `validateBeneficiary`
 * @param {string} [args.idempotencyKey]  - if reused, replays return the existing request
 * @param {string|null} [args.correlationId]
 */
export async function createWithdrawalRequest({
  userId,
  amount,
  beneficiary,
  idempotencyKey,
  correlationId = null,
  session: externalSession,
}) {
  if (!userId) throw new Error("userId is required");
  const grossRequested = roundCurrency(amount);
  if (!grossRequested || grossRequested <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  const minAmount = await getMinWithdrawalAmount();
  if (grossRequested < minAmount) {
    throw new Error(`Minimum withdrawal amount is ${minAmount}`);
  }

  const beneficiarySnap = validateBeneficiary(beneficiary);
  const key = idempotencyKey || `${MLM_IDEMPOTENCY_PREFIX.WITHDRAWAL_GROSS}-${userId}-${Date.now()}`;

  return runInSession(externalSession, async (session) => {
    // Idempotency replay
    const existing = await MlmWithdrawalRequest.findOne(
      { idempotencyKey: key },
      null,
      { session },
    );
    if (existing) return existing;

    const membership = await MlmMembership.findOne({ userId }, null, { session });
    if (!membership) {
      throw new Error("Only MLM members can withdraw earnings");
    }

    const charges = await computeWithdrawalCharges(grossRequested);
    if (charges.net <= 0) {
      throw new Error("Net payout amount must be greater than 0 after charges");
    }

    // 1. Debit earningsBalance by gross. Throws if insufficient.
    const grossDebit = await debitWallet({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
      amount: grossRequested,
      bucket: "earnings",
      session,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_GROSS_DEBIT,
      ledgerReference: key,
      ledgerDescription: "MLM withdrawal request (gross debit)",
      idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.WITHDRAWAL_GROSS}-${key}`,
      correlationId,
      metadata: {
        mlmEvent: "WITHDRAWAL_REQUESTED",
        adminChargePercent: charges.adminChargePercent,
        gstOnChargePercent: charges.gstOnChargePercent,
      },
      syncUserWalletBalance: false,
    });

    // 2. Informational admin-charge ledger row (no wallet movement)
    const adminChargeLedger = await createLedgerEntry(
      {
        walletId: grossDebit.wallet._id,
        actorType: OWNER_TYPE.CUSTOMER,
        actorId: userId,
        type: LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_ADMIN_CHARGE,
        direction: "DEBIT",
        amount: charges.adminCharge,
        description: `MLM withdrawal admin charge ${charges.adminChargePercent}%`,
        reference: key,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.WITHDRAWAL_ADMIN_CHARGE}-${key}`,
        correlationId,
      },
      { session },
    );

    // 3. Informational GST ledger row (no wallet movement)
    const gstLedger = await createLedgerEntry(
      {
        walletId: grossDebit.wallet._id,
        actorType: OWNER_TYPE.CUSTOMER,
        actorId: userId,
        type: LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_GST_CHARGE,
        direction: "DEBIT",
        amount: charges.gst,
        description: `MLM withdrawal GST ${charges.gstOnChargePercent}% on admin charge`,
        reference: key,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.WITHDRAWAL_GST}-${key}`,
        correlationId,
      },
      { session },
    );

    // 4. Create the pending Payout row (admin processes this manually)
    const [payout] = await Payout.create(
      [
        {
          payoutType: PAYOUT_TYPE.CUSTOMER_WITHDRAWAL,
          beneficiaryModel: "User",
          beneficiaryId: userId,
          amount: charges.net,
          status: PAYOUT_STATUS.PENDING,
          remarks: `MLM customer withdrawal request`,
          metadata: {
            mlmRequestIdempotencyKey: key,
            grossAmount: charges.gross,
            adminCharge: charges.adminCharge,
            gst: charges.gst,
            beneficiary: beneficiarySnap,
          },
        },
      ],
      { session },
    );

    // 5. Paired ledger entry for the Payout queue event
    const payoutQueueLedger = await createLedgerEntry(
      {
        payoutId: payout._id,
        walletId: grossDebit.wallet._id,
        actorType: OWNER_TYPE.CUSTOMER,
        actorId: userId,
        type: LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_NET_PAYOUT_QUEUED,
        direction: "DEBIT",
        amount: charges.net,
        description: `MLM withdrawal net payout queued`,
        reference: key,
        idempotencyKey: `${MLM_IDEMPOTENCY_PREFIX.WITHDRAWAL_PAYOUT}-${key}`,
        correlationId,
      },
      { session },
    );

    // 6. Persist the withdrawal request row linking everything
    const [request] = await MlmWithdrawalRequest.create(
      [
        {
          userId,
          membershipId: membership._id,
          amount: charges.gross,
          adminChargeAmount: charges.adminCharge,
          adminChargePercent: charges.adminChargePercent,
          gstAmount: charges.gst,
          gstOnChargePercent: charges.gstOnChargePercent,
          netPayoutAmount: charges.net,
          status: MLM_WITHDRAWAL_STATUS.PENDING,
          beneficiary: beneficiarySnap,
          walletDebitLedgerId: grossDebit.ledgerEntry?._id || null,
          adminChargeLedgerId: adminChargeLedger?._id || null,
          gstChargeLedgerId: gstLedger?._id || null,
          payoutId: payout._id,
          idempotencyKey: key,
          correlationId,
        },
      ],
      { session },
    );

    // 7. Persist beneficiary on membership for re-use on the next request.
    membership.payoutBeneficiary = beneficiarySnap;
    await membership.save({ session });

    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.MLM_WITHDRAWAL_REQUESTED, {
        userId: String(userId),
        data: {
          requestId: String(request._id),
          amount: charges.gross,
          netAmount: charges.net,
        },
      });
    } catch (_) {
      /* non-fatal */
    }

    return request;
  });
}

/**
 * Admin approves a pending withdrawal request and records the UTR.
 * The Payout transitions PENDING -> COMPLETED and the request -> paid.
 */
export async function approveWithdrawalRequest({
  requestId,
  adminId,
  payoutReference,
  adminRemarks = "",
  session: externalSession,
}) {
  return runInSession(externalSession, async (session) => {
    const request = await MlmWithdrawalRequest.findById(requestId, null, { session });
    if (!request) throw new Error("Withdrawal request not found");
    if (request.status !== MLM_WITHDRAWAL_STATUS.PENDING) {
      throw new Error(`Cannot approve request in status: ${request.status}`);
    }

    const payout = request.payoutId
      ? await Payout.findById(request.payoutId, null, { session })
      : null;
    if (payout && payout.status === PAYOUT_STATUS.PENDING) {
      payout.status = PAYOUT_STATUS.COMPLETED;
      payout.processedAt = new Date();
      if (payoutReference) {
        payout.metadata = { ...(payout.metadata || {}), payoutReference };
      }
      if (adminId) payout.createdBy = adminId;
      await payout.save({ session });
    }

    request.status = MLM_WITHDRAWAL_STATUS.PAID;
    request.processedAt = new Date();
    request.processedBy = adminId || null;
    request.payoutReference = payoutReference || request.payoutReference;
    request.adminRemarks = adminRemarks || request.adminRemarks;
    request.updatedBy = adminId || null;
    await request.save({ session });

    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.MLM_WITHDRAWAL_APPROVED, {
        userId: String(request.userId),
        data: {
          requestId: String(request._id),
          amount: request.amount,
          netAmount: request.netPayoutAmount,
          payoutReference: request.payoutReference,
        },
      });
    } catch (_) {
      /* non-fatal */
    }

    return request;
  });
}

/**
 * Admin rejects a pending request. Reverses the gross debit
 * (credit earningsBalance back) and cancels the linked Payout.
 */
export async function rejectWithdrawalRequest({
  requestId,
  adminId,
  reason,
  session: externalSession,
}) {
  return runInSession(externalSession, async (session) => {
    const request = await MlmWithdrawalRequest.findById(requestId, null, { session });
    if (!request) throw new Error("Withdrawal request not found");
    if (request.status !== MLM_WITHDRAWAL_STATUS.PENDING) {
      throw new Error(`Cannot reject request in status: ${request.status}`);
    }

    await reverseWithdrawalDebit(request, { adminId, session });

    request.status = MLM_WITHDRAWAL_STATUS.REJECTED;
    request.processedAt = new Date();
    request.processedBy = adminId || null;
    request.rejectionReason = reason || "Rejected by admin";
    request.updatedBy = adminId || null;
    await request.save({ session });

    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.MLM_WITHDRAWAL_REJECTED, {
        userId: String(request.userId),
        data: {
          requestId: String(request._id),
          amount: request.amount,
          reason: request.rejectionReason,
        },
      });
    } catch (_) {
      /* non-fatal */
    }

    return request;
  });
}

/**
 * Customer cancels a pending request before the admin acts on it.
 * Same money-flow reversal as reject.
 */
export async function cancelWithdrawalRequestByCustomer({
  requestId,
  userId,
  session: externalSession,
}) {
  return runInSession(externalSession, async (session) => {
    const request = await MlmWithdrawalRequest.findOne(
      { _id: requestId, userId },
      null,
      { session },
    );
    if (!request) throw new Error("Withdrawal request not found");
    if (request.status !== MLM_WITHDRAWAL_STATUS.PENDING) {
      throw new Error(`Cannot cancel request in status: ${request.status}`);
    }

    await reverseWithdrawalDebit(request, { adminId: null, session });

    request.status = MLM_WITHDRAWAL_STATUS.CANCELLED;
    request.processedAt = new Date();
    await request.save({ session });

    return request;
  });
}

async function reverseWithdrawalDebit(request, { adminId, session }) {
  const key = request.idempotencyKey || `REVERSE-${request._id}`;
  // Reverse the gross debit by crediting `earningsBalance` back.
  await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: request.userId,
    amount: request.amount,
    bucket: "earnings",
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,
    ledgerReference: `REVERSE-${key}`,
    ledgerDescription: "MLM withdrawal request reversed",
    idempotencyKey: `REVERSE-${MLM_IDEMPOTENCY_PREFIX.WITHDRAWAL_GROSS}-${key}`,
    metadata: {
      mlmEvent: "WITHDRAWAL_REVERSED",
      requestId: String(request._id),
      adminId: adminId ? String(adminId) : null,
    },
    syncUserWalletBalance: false,
  });

  if (request.payoutId) {
    const payout = await Payout.findById(request.payoutId, null, { session });
    if (payout && payout.status === PAYOUT_STATUS.PENDING) {
      payout.status = PAYOUT_STATUS.CANCELLED;
      payout.cancelledAt = new Date();
      if (adminId) payout.createdBy = adminId;
      await payout.save({ session });
    }
  }
}

export async function listWithdrawalsForCustomer(userId, { page = 1, limit = 20, status } = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const query = { userId };
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    MlmWithdrawalRequest.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    MlmWithdrawalRequest.countDocuments(query),
  ]);

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

export async function listWithdrawalsForAdmin({ page = 1, limit = 25, status, q } = {}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);
  const skip = (safePage - 1) * safeLimit;
  const query = {};
  if (status) query.status = status;

  let cursor = MlmWithdrawalRequest.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(safeLimit)
    .populate("userId", "name phone email");

  const [itemsRaw, total] = await Promise.all([
    cursor.lean(),
    MlmWithdrawalRequest.countDocuments(query),
  ]);

  const filtered = q
    ? itemsRaw.filter((row) => {
        const u = row.userId || {};
        const text = `${u.name || ""} ${u.phone || ""} ${u.email || ""}`.toLowerCase();
        return text.includes(String(q).toLowerCase());
      })
    : itemsRaw;

  const userIds = filtered
    .map((row) => row.userId?._id || row.userId)
    .filter(Boolean);
  const joinedAtByUser = await lookupMembershipJoinedAtByUserIds(userIds);

  const items = filtered.map((row) => {
    const uid = String(row.userId?._id || row.userId || "");
    return {
      ...row,
      memberJoinedAt: joinedAtByUser.get(uid) || null,
    };
  });

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}
