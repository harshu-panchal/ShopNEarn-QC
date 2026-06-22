import mongoose from "mongoose";

export const MLM_DAILY_PAYOUT_REPORT_STATUS = {
  DRAFT: "draft",
  FINALIZED: "finalized",
};
export const ALL_MLM_DAILY_PAYOUT_REPORT_STATUSES = Object.values(
  MLM_DAILY_PAYOUT_REPORT_STATUS,
);

const bonusBreakdownSchema = new mongoose.Schema(
  {
    bonusType: { type: String, required: true },
    eventCount: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0 },
  },
  { _id: false },
);

const lineItemAdjustmentSchema = new mongoose.Schema(
  {
    direction: { type: String, enum: ["CREDIT", "DEBIT"], required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    appliedAt: { type: Date, default: Date.now },
    ledgerRef: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
  },
  { _id: true },
);

const memberLineItemSchema = new mongoose.Schema(
  {
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmMembership",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referralCode: { type: String, default: "" },
    memberName: { type: String, default: "" },
    pairsMatched: { type: Number, default: 0, min: 0 },
    bonusByType: { type: Map, of: Number, default: () => new Map() },
    autoTotal: { type: Number, default: 0 },
    correctedTotal: { type: Number, default: null },
    adminNote: { type: String, default: "" },
    sourceEventIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "MlmCommissionEvent" },
    ],
    adjustments: [lineItemAdjustmentSchema],
  },
  { _id: true },
);

const summarySchema = new mongoose.Schema(
  {
    totalCredited: { type: Number, default: 0 },
    totalEvents: { type: Number, default: 0, min: 0 },
    pairsMatched: { type: Number, default: 0, min: 0 },
    pairIncomeTotal: { type: Number, default: 0 },
    newReferrals: { type: Number, default: 0, min: 0 },
    newActivations: { type: Number, default: 0, min: 0 },
    withdrawalsApproved: { type: Number, default: 0, min: 0 },
    withdrawalsPaid: { type: Number, default: 0, min: 0 },
    withdrawalsAmount: { type: Number, default: 0 },
    cappedRolloverTotal: { type: Number, default: 0 },
    clawbackTotal: { type: Number, default: 0 },
  },
  { _id: false },
);

const generationMetaSchema = new mongoose.Schema(
  {
    version: { type: String, default: "1" },
    eventCountScanned: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
  },
  { _id: false },
);

const mlmDailyPayoutReportSchema = new mongoose.Schema(
  {
    reportDate: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    status: {
      type: String,
      enum: ALL_MLM_DAILY_PAYOUT_REPORT_STATUSES,
      default: MLM_DAILY_PAYOUT_REPORT_STATUS.DRAFT,
      index: true,
    },
    generatedAt: { type: Date, default: Date.now },
    lastRegeneratedAt: { type: Date, default: Date.now },
    finalizedAt: { type: Date, default: null },
    finalizedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    summary: { type: summarySchema, default: () => ({}) },
    bonusBreakdown: [bonusBreakdownSchema],
    memberLineItems: [memberLineItemSchema],
    adminNotes: { type: String, default: "" },
    generationMeta: { type: generationMetaSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    collection: "mlmdailypayoutreports",
  },
);

mlmDailyPayoutReportSchema.index({ status: 1, reportDate: -1 });

export default mongoose.model(
  "MlmDailyPayoutReport",
  mlmDailyPayoutReportSchema,
);
