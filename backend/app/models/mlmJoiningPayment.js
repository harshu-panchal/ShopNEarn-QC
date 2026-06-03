import mongoose from "mongoose";
import {
  ALL_PAYMENT_EVENT_SOURCES,
  ALL_PAYMENT_GATEWAYS,
  ALL_PAYMENT_STATUSES,
  PAYMENT_STATUS,
} from "../constants/payment.js";
import { ALL_MLM_PAYMENT_MODES, MLM_PAYMENT_MODE } from "../constants/mlm.js";

/**
 * MlmJoiningPayment — owns the full intent-pay-activate lifecycle for
 * a customer joining the MLM rewards program.
 *
 * Why a separate collection (vs. extending `Payment`):
 *   - A joining payment has no fulfilment, no seller, no checkout
 *     group, no cancel-and-restock semantics. It is a one-off
 *     subscription purchase that triggers Plan A activation.
 *   - It carries activation-specific state (`activationApplied`,
 *     `sponsorReferralCodeSnapshot`, `shoppingCreditSnapshot`) that
 *     would create dead columns on the order-shaped Payment model.
 *   - Keeping the two collections separate means the order webhook
 *     surface is bit-for-bit untouched by this refactor; the joining
 *     flow is fully isolated.
 *
 * Snapshots:
 *   `joiningPriceSnapshot` and `shoppingCreditSnapshot` are captured
 *   at INTENT time and never mutate. If an admin edits
 *   `Setting.mlm.joiningPackage*` between intent and capture, the
 *   captured customer still gets exactly what they paid for and were
 *   promised on the dashboard.
 */
const joiningPaymentStateChangeSchema = new mongoose.Schema(
  {
    fromStatus: { type: String, enum: ALL_PAYMENT_STATUSES, required: true },
    toStatus: { type: String, enum: ALL_PAYMENT_STATUSES, required: true },
    source: { type: String, enum: ALL_PAYMENT_EVENT_SOURCES, required: true },
    reason: { type: String, default: "" },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const mlmJoiningPaymentSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    gatewayName: {
      type: String,
      enum: ALL_PAYMENT_GATEWAYS,
      required: true,
      default: "PHONEPE",
      index: true,
    },
    // Snapshot of `Setting.mlm.joiningPaymentMode` at intent time so a
    // mid-flight admin toggle never reroutes an open payment from one
    // flow to the other. The PhonePe code path treats every legacy row
    // (where this field is missing) as `phonepe` for back-compat.
    paymentMode: {
      type: String,
      enum: ALL_MLM_PAYMENT_MODES,
      default: MLM_PAYMENT_MODE.PHONEPE,
      index: true,
    },
    gatewayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    gatewayPaymentId: {
      type: String,
      default: null,
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
    joiningPriceSnapshot: {
      type: Number,
      required: true,
      min: 0,
    },
    shoppingCreditSnapshot: {
      type: Number,
      required: true,
      min: 0,
    },
    sponsorReferralCodeSnapshot: {
      type: String,
      default: null,
    },
    activationApplied: {
      type: Boolean,
      default: false,
      index: true,
    },
    activationCompletedAt: {
      type: Date,
      default: null,
    },
    activationError: {
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
    rawGatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    failureReason: {
      type: String,
      default: null,
    },
    capturedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    statusHistory: {
      type: [joiningPaymentStateChangeSchema],
      default: [],
    },
    // Manual-QR flow only — out-of-band proof submitted by the customer
    // through `/mlm/manual-payment/:paymentId`. Stays null for the
    // PhonePe gateway code path.
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
    // Manual-QR flow only — admin who actioned the review and when.
    // Untouched for PhonePe payments (those auto-capture via webhook).
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
  },
  { timestamps: true },
);

mlmJoiningPaymentSchema.index(
  { customer: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: "string" },
    },
  },
);
mlmJoiningPaymentSchema.index({ customer: 1, createdAt: -1 });
mlmJoiningPaymentSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model("MlmJoiningPayment", mlmJoiningPaymentSchema);
