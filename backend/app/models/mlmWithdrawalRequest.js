import mongoose from "mongoose";
import {
  ALL_MLM_WITHDRAWAL_METHODS,
  ALL_MLM_WITHDRAWAL_STATUSES,
  MLM_WITHDRAWAL_STATUS,
} from "../constants/mlm.js";

/**
 * MlmWithdrawalRequest — customer-side cashout request.
 *
 * Lifecycle:
 *   pending   -> approved -> paid    (admin marks the manual UTR transfer done)
 *   pending   -> rejected            (admin denies; wallet debit reversed)
 *   pending   -> cancelled           (customer cancels; wallet debit reversed)
 *
 * Money flow on create (atomic, single session):
 *   1. Debit `earningsBalance` by `amount` (gross)         => LedgerEntry MLM_WITHDRAWAL_GROSS_DEBIT
 *   2. Write admin charge ledger row (informational)       => LedgerEntry MLM_WITHDRAWAL_ADMIN_CHARGE
 *   3. Write GST-on-admin-charge ledger row (informational) => LedgerEntry MLM_WITHDRAWAL_GST_CHARGE
 *   4. Create Payout({ beneficiaryModel: "User",
 *                      payoutType: "CUSTOMER_WITHDRAWAL",
 *                      status: PENDING,
 *                      amount: netPayoutAmount })          => LedgerEntry MLM_WITHDRAWAL_NET_PAYOUT_QUEUED
 *
 * Reverse on reject/cancel (atomic, single session):
 *   1. Credit `earningsBalance` by `amount` (gross)
 *   2. Cancel the Payout row
 *
 * `idempotencyKey` is stable across UI retries — defended at the
 * partial unique index below.
 */
const beneficiarySnapshotSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    ifsc: { type: String, trim: true, uppercase: true, default: "" },
    upiId: { type: String, trim: true, default: "" },
    panNumber: { type: String, trim: true, uppercase: true, default: "" },
    method: { type: String, enum: ALL_MLM_WITHDRAWAL_METHODS, required: true },
  },
  { _id: false },
);

const mlmWithdrawalRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmMembership",
      default: null,
      index: true,
    },

    amount: { type: Number, required: true, min: 0 }, // gross requested
    adminChargeAmount: { type: Number, required: true, min: 0 },
    adminChargePercent: { type: Number, required: true, min: 0, max: 100 },
    gstAmount: { type: Number, required: true, min: 0 },
    gstOnChargePercent: { type: Number, required: true, min: 0, max: 100 },
    netPayoutAmount: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ALL_MLM_WITHDRAWAL_STATUSES,
      default: MLM_WITHDRAWAL_STATUS.PENDING,
      index: true,
    },

    beneficiary: { type: beneficiarySnapshotSchema, required: true },

    // Audit fields
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    payoutReference: { type: String, trim: true, default: "" }, // UTR / external ref
    rejectionReason: { type: String, trim: true, default: "" },
    adminRemarks: { type: String, trim: true, default: "" },

    // Linked finance documents
    walletDebitLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
    },
    adminChargeLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
    },
    gstChargeLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
    },
    payoutId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payout",
      default: null,
      index: true,
    },

    idempotencyKey: { type: String, default: undefined },
    correlationId: { type: String, default: null, index: true },

    // Soft-delete (per soft-delete-cascade-pattern skill)
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true },
);

mlmWithdrawalRequestSchema.index({ userId: 1, createdAt: -1 });
mlmWithdrawalRequestSchema.index({ status: 1, createdAt: -1 });
mlmWithdrawalRequestSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
    name: "idx_mlm_withdrawal_idempotency",
  },
);

mlmWithdrawalRequestSchema.pre(/^find/, function preFindFilterSoftDeleted(next) {
  const conditions = this.getFilter() || {};
  if (conditions.__includeDeleted) {
    delete conditions.__includeDeleted;
    this.setQuery(conditions);
    return next();
  }
  if (!Object.prototype.hasOwnProperty.call(conditions, "deletedAt")) {
    this.where({ deletedAt: null });
  }
  next();
});

export default mongoose.model("MlmWithdrawalRequest", mlmWithdrawalRequestSchema);
