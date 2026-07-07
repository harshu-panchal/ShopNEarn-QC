import mongoose from "mongoose";
import {
  ALL_PAYMENT_EVENT_SOURCES,
  ALL_PAYMENT_STATUSES,
  PAYMENT_STATUS,
} from "../constants/payment.js";
import {
  ALL_MLM_UPGRADE_PAYMENT_MODES,
  MLM_UPGRADE_PAYMENT_MODE,
} from "../constants/mlm.js";

const upgradePaymentStateChangeSchema = new mongoose.Schema(
  {
    fromStatus: { type: String, enum: ALL_PAYMENT_STATUSES, required: true },
    toStatus: { type: String, enum: ALL_PAYMENT_STATUSES, required: true },
    source: { type: String, enum: ALL_PAYMENT_EVENT_SOURCES, required: true },
    reason: { type: String, default: "" },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const mlmUpgradePaymentSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    paymentMode: {
      type: String,
      enum: ALL_MLM_UPGRADE_PAYMENT_MODES,
      required: true,
      index: true,
    },
    gatewayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      required: true,
      default: "INR",
    },
    status: {
      type: String,
      enum: ALL_PAYMENT_STATUSES,
      default: PAYMENT_STATUS.CREATED,
      index: true,
    },
    payAmountSnapshot: {
      type: Number,
      required: true,
      min: 0,
    },
    shoppingCreditSnapshot: {
      type: Number,
      required: true,
      min: 0,
    },
    upgradeApplied: {
      type: Boolean,
      default: false,
      index: true,
    },
    upgradeCompletedAt: {
      type: Date,
      default: null,
    },
    upgradeError: {
      type: String,
      default: null,
    },
    idempotencyKey: {
      type: String,
      default: undefined,
      index: true,
    },
    correlationId: {
      type: String,
      default: null,
      index: true,
    },
    capturedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    statusHistory: {
      type: [upgradePaymentStateChangeSchema],
      default: [],
    },
    manualPaymentDetails: {
      transactionId: {
        type: String,
        default: null,
        trim: true,
        uppercase: true,
        index: true,
      },
      screenshotUrl: { type: String, default: null },
      paidAmount: { type: Number, default: null },
      submittedAt: { type: Date, default: null },
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    adminRemarks: {
      type: String,
      default: null,
    },
    rawGatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

mlmUpgradePaymentSchema.index(
  { customer: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: "string" },
    },
  },
);
mlmUpgradePaymentSchema.index({ customer: 1, createdAt: -1 });
mlmUpgradePaymentSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model("MlmUpgradePayment", mlmUpgradePaymentSchema);
