import mongoose from "mongoose";
import {
  ALL_MLM_MEMBERSHIP_STATUSES,
  ALL_MLM_PLAN_TYPES,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../constants/mlm.js";

/**
 * MlmMembership — one row per customer who has joined the MLM program.
 *
 * Created by `mlmActivationService.activateMembershipFromJoiningPayment`
 * when a customer's `MlmJoiningPayment` is CAPTURED. NEVER auto-created
 * for non-MLM customers — a missing membership row is the canonical
 * signal for "not an MLM member".
 *
 * Fields are denormalised aggressively (sponsorChain[], counters,
 * lifetime earnings) so the most common reads — upline chain walk,
 * downline count, dashboard summary — never need to scan or aggregate.
 * Authoritative bonus history lives in MlmCommissionEvent.
 */
const dailyCapTrackerSchema = new mongoose.Schema(
  {
    date: { type: String, default: null }, // ISO date "YYYY-MM-DD" in IST
    usedAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const beneficiarySchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    ifsc: { type: String, trim: true, uppercase: true, default: "" },
    upiId: { type: String, trim: true, default: "" },
    panNumber: { type: String, trim: true, uppercase: true, default: "" },
    method: { type: String, enum: ["bank", "upi", null], default: null },
  },
  { _id: false },
);

const mlmMembershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    referralCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    planType: {
      type: String,
      enum: ALL_MLM_PLAN_TYPES,
      default: MLM_PLAN_TYPE.A,
      index: true,
    },

    status: {
      type: String,
      enum: ALL_MLM_MEMBERSHIP_STATUSES,
      default: MLM_MEMBERSHIP_STATUS.ACTIVE,
      index: true,
    },

    joinedAt: { type: Date, default: Date.now },
    planAJoinedAt: { type: Date, default: Date.now },
    planBJoinedAt: { type: Date, default: null },

    // Sponsor (unilevel) edge.
    sponsorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sponsorMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmMembership",
      default: null,
    },
    /**
     * Denormalised upline chain — index 0 = direct sponsor, index 1 =
     * sponsor's sponsor, etc. Capped at `Setting.mlm.sponsorChainMaxDepth`
     * (default 10). Used for fast upline walks during commission
     * computation (avoids recursive DB hops).
     */
    sponsorChain: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      default: [],
    },

    // Binary tree (Plan A genealogy — no matching bonus, just structure).
    binaryParentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    binaryParentMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmMembership",
      default: null,
    },
    binaryPosition: {
      type: String,
      enum: ["L", "R", null],
      default: null,
    },
    binaryLeftChildId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    binaryRightChildId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Denormalised counters (eventually-consistent with the source data).
    directReferralsCount: { type: Number, default: 0 },
    totalDownlineCount: { type: Number, default: 0 },

    // Plan A binary pair bonus — counters of THIS member's own direct
    // referrals partitioned by which leg (L/R) of THIS member's binary
    // tree they were placed in. Bumped by `incrementSponsorLegDirectCount`
    // inside the same session as `assignSponsor`. The pair bonus engine
    // pays at every increment of `min(leftLegDirectCount, rightLegDirectCount)`.
    //
    // Note: these count A's *direct referrals only* (people for whom
    // `sponsorId === A.userId`). Spillover from A's upline does NOT
    // bump these counters — it bumps `totalDownlineCount` instead.
    leftLegDirectCount: { type: Number, default: 0 },
    rightLegDirectCount: { type: Number, default: 0 },
    // `pairsCompleted` mirrors `min(leftLegDirectCount, rightLegDirectCount)`
    // and only ever moves forward. Used for fast read paths.
    pairsCompleted: { type: Number, default: 0 },
    // Last pair index for which a `BINARY_PAIR_MATCH` event was credited.
    // Drives idempotent multi-pair catch-up: if multiple directs join in
    // the same window, the engine can fire bonuses for every pair from
    // `lastPaidPairIndex + 1` up to current `pairsCompleted`.
    lastPaidPairIndex: { type: Number, default: 0 },

    // Lifetime totals — drive Plan A => Plan B auto-upgrade trigger.
    lifetimePlanAEarnings: { type: Number, default: 0 },
    lifetimePlanBEarnings: { type: Number, default: 0 },

    // Daily cap usage (resets at IST midnight via mlmDailyCapRolloverJob).
    dailyCapTracker: { type: dailyCapTrackerSchema, default: () => ({}) },

    // Plan B benefits flags
    homeShoppingUnlocked: { type: Boolean, default: false },
    homeShoppingClaimed: { type: Boolean, default: false },
    homeShoppingClaimedAt: { type: Date, default: null },

    // Withdrawal beneficiary (re-used across requests; captured at first
    // request and edited on subsequent ones).
    payoutBeneficiary: { type: beneficiarySchema, default: () => ({}) },

    // Customer-MLM-rebuild Phase 1: running total of pair-match bonus
    // amount currently HELD on behalf of THIS member's sponsor because
    // THIS member is still `REGISTERED_UNPAID`. Bumped every time a
    // `HELD_AWAITING_DOWNLINE_ACTIVATION` event is emitted; cleared
    // (set back to 0) by `releaseHeldPairBonusesForDownlineActivation`
    // when THIS member activates. Used by the admin "Held pair-bonus
    // for upline" panel and the support / release-now override.
    heldPairBonusForSponsor: { type: Number, default: 0, min: 0 },

    // Customer-MLM-rebuild Phase 1: per-user cosmetic node coordinates
    // for the customer-facing Tree View. Keys are stringified MongoDB
    // ObjectIds of downline membership rows; values are `{x, y}` pixel
    // offsets persisted from `react-flow`'s `onNodeDragStop`. Never
    // affects the underlying binary tree structure — purely visual.
    treeLayoutOverrides: {
      type: Map,
      of: new mongoose.Schema(
        {
          x: { type: Number, required: true },
          y: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: () => new Map(),
    },

    // Soft-delete (per soft-delete-cascade-pattern skill)
    deletedAt: { type: Date, default: null, index: true },
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

    meta: { type: Object, default: {} },
  },
  { timestamps: true },
);

// Composite indexes for common queries.
mlmMembershipSchema.index({ sponsorId: 1, planType: 1 });
mlmMembershipSchema.index({ status: 1, planType: 1, deletedAt: 1 });
mlmMembershipSchema.index({ binaryParentId: 1, binaryPosition: 1 });

// Soft-delete auto-filter (admin reads with `.find({ __includeDeleted: true })`
// can opt in explicitly via `MlmMembership.find(...).setOptions({...})`).
mlmMembershipSchema.pre(/^find/, function preFindFilterSoftDeleted(next) {
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

export default mongoose.model("MlmMembership", mlmMembershipSchema);
