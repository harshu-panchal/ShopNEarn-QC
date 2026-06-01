import mongoose from "mongoose";
import {
  ALL_MLM_BONUS_TYPES,
  ALL_MLM_COMMISSION_EVENT_STATUSES,
  ALL_MLM_PLAN_TYPES,
  MLM_COMMISSION_EVENT_STATUS,
} from "../constants/mlm.js";

/**
 * MlmCommissionEvent — richer audit log than LedgerEntry for every MLM
 * bonus computation. Always paired 1:1 with a LedgerEntry inside the
 * same Mongoose session (per the `wallet-ledger-atomicity` skill).
 *
 * Why a separate collection?
 *   - LedgerEntry is generic (covers admin earnings, COD remittance,
 *     payouts) and doesn't carry MLM-specific dimensions like `level`,
 *     `ratePercent`, `sourceUserId`, or `sourceCommissionEventId`.
 *   - The mentor-royalty cascade needs to chain events
 *     (`sourceCommissionEventId` → parent event), which has no
 *     LedgerEntry analogue.
 *   - Return-clawback walks events for an order, not ledger rows.
 *
 * Idempotency: every event carries a stable `idempotencyKey` derived
 * from the trigger (e.g. `MLM-RB-<orderId>-L<level>-<userId>`). The
 * partial unique index below makes a duplicate insert a no-op.
 */
const mlmCommissionEventSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipientMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmMembership",
      default: null,
      index: true,
    },

    // Who/what triggered the bonus.
    sourceUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sourceOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    // For mentor-royalty cascades: the upstream bonus event whose
    // amount this royalty is computed from.
    sourceCommissionEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmCommissionEvent",
      default: null,
      index: true,
    },

    bonusType: {
      type: String,
      enum: ALL_MLM_BONUS_TYPES,
      required: true,
      index: true,
    },
    planType: {
      type: String,
      enum: ALL_MLM_PLAN_TYPES,
      required: true,
      index: true,
    },

    // 1-based: 1 = direct downline / L1, 6 = L6. null for events
    // that don't have a level (e.g. direct referral milestone bonus).
    level: { type: Number, default: null },

    baseAmount: { type: Number, default: 0, min: 0 },
    ratePercent: { type: Number, default: null },
    bonusAmount: { type: Number, default: 0, min: 0 },
    cappedAmount: { type: Number, default: 0, min: 0 }, // amount actually credited (after daily cap)
    rolloverAmount: { type: Number, default: 0, min: 0 }, // amount deferred to next day by cap

    walletBucket: {
      type: String,
      enum: ["pending", "available", "earnings", "shopping"],
      default: "pending",
    },

    ledgerEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LedgerEntry",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ALL_MLM_COMMISSION_EVENT_STATUSES,
      default: MLM_COMMISSION_EVENT_STATUS.CREDITED,
      index: true,
    },

    // MLM Phase 2: stamped by `returnWindowReleaseJob` when the bonus
    // graduates from `pending` to `earnings`. Absence means the bonus
    // is still held in pending awaiting return-window expiry.
    releasedAt: { type: Date, default: undefined, index: true },

    // MLM Phase 3: stamped by `clawbackBonusesOnReturn` when the
    // bonus is reversed due to a return claim. Carries the
    // proportional refund amount so partial returns are reconcilable.
    clawbackAt: { type: Date, default: undefined },
    clawbackAmount: { type: Number, default: 0, min: 0 },

    // MLM Phase 3: stamped by `mlmDailyCapRolloverJob` when the
    // capped_rollover amount has been re-credited the next day.
    // `rolloverIdempotencyKey` points at the new event so admins can
    // audit the carry-forward chain.
    rolledOverAt: { type: Date, default: undefined },
    rolloverIdempotencyKey: { type: String, default: undefined },

    // Stable replay-safe key (partial unique index below).
    idempotencyKey: { type: String, default: undefined },
    correlationId: { type: String, default: null, index: true },

    description: { type: String, trim: true, default: "" },
    meta: { type: Object, default: {} },
  },
  { timestamps: true },
);

mlmCommissionEventSchema.index({ recipientId: 1, createdAt: -1 });
mlmCommissionEventSchema.index({ sourceOrderId: 1, bonusType: 1 });
mlmCommissionEventSchema.index({ status: 1, createdAt: -1 });
mlmCommissionEventSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
    name: "idx_mlm_commission_event_idempotency",
  },
);

export default mongoose.model("MlmCommissionEvent", mlmCommissionEventSchema);
