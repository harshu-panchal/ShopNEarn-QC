import mongoose from "mongoose";
import {
  ALL_FRANCHISE_PAYMENT_MODES,
  ALL_FRANCHISE_TOPUP_STATUSES,
  FRANCHISE_PAYMENT_MODE,
  FRANCHISE_TOPUP_STATUS,
} from "../constants/franchise.js";

const franchiseWalletTopUpSchema = new mongoose.Schema(
  {
    franchisePartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchisePartner",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 1 },
    creditMultiplierSnapshot: { type: Number, required: true, min: 1 },
    approvedCreditAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ALL_FRANCHISE_TOPUP_STATUSES,
      default: FRANCHISE_TOPUP_STATUS.CREATED,
      index: true,
    },
    paymentMode: {
      type: String,
      enum: ALL_FRANCHISE_PAYMENT_MODES,
      default: FRANCHISE_PAYMENT_MODE.MANUAL_QR,
    },
    gatewayOrderId: { type: String, default: null, index: true },
    manualPaymentDetails: {
      transactionId: { type: String, default: "" },
      screenshotUrl: { type: String, default: "" },
      paidAmount: { type: Number, default: null },
      submittedAt: { type: Date, default: null },
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    adminRemarks: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
    creditLedgerRef: { type: String, default: "" },
    idempotencyKey: { type: String, default: undefined },
  },
  { timestamps: true },
);

franchiseWalletTopUpSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);

export default mongoose.model("FranchiseWalletTopUp", franchiseWalletTopUpSchema);
