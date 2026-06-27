import mongoose from "mongoose";
import {
  ALL_PAYMENT_EVENT_SOURCES,
  ALL_PAYMENT_GATEWAYS,
  ALL_PAYMENT_STATUSES,
  PAYMENT_STATUS,
} from "../constants/payment.js";
import {
  ALL_FRANCHISE_PAYMENT_MODES,
  FRANCHISE_PAYMENT_MODE,
} from "../constants/franchise.js";

const stateChangeSchema = new mongoose.Schema(
  {
    fromStatus: { type: String, enum: ALL_PAYMENT_STATUSES, required: true },
    toStatus: { type: String, enum: ALL_PAYMENT_STATUSES, required: true },
    source: { type: String, enum: ALL_PAYMENT_EVENT_SOURCES, required: true },
    reason: { type: String, default: "" },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const franchiseRegistrationPaymentSchema = new mongoose.Schema(
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
      default: "PHONEPE",
      index: true,
    },
    paymentMode: {
      type: String,
      enum: ALL_FRANCHISE_PAYMENT_MODES,
      default: FRANCHISE_PAYMENT_MODE.MANUAL_QR,
      index: true,
    },
    gatewayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    gatewayPaymentId: { type: String, default: null, index: true },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ALL_PAYMENT_STATUSES,
      default: PAYMENT_STATUS.CREATED,
      index: true,
    },
    registrationPriceSnapshot: { type: Number, required: true, min: 0 },
    territoryPincodesSnapshot: { type: [String], default: [] },
    addressSnapshot: {
      address: { type: String, default: "" },
      locality: { type: String, default: "" },
      pincode: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    activationApplied: { type: Boolean, default: false, index: true },
    activationCompletedAt: { type: Date, default: null },
    activationError: { type: String, default: null },
    franchisePartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchisePartner",
      default: null,
    },
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
    failureReason: { type: String, default: "" },
    capturedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    rawGatewayResponse: { type: Object, default: {} },
    statusHistory: { type: [stateChangeSchema], default: [] },
    idempotencyKey: { type: String, default: undefined },
    correlationId: { type: String, default: null },
  },
  { timestamps: true },
);

franchiseRegistrationPaymentSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);

export default mongoose.model(
  "FranchiseRegistrationPayment",
  franchiseRegistrationPaymentSchema,
);
