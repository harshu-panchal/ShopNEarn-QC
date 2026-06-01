import mongoose from "mongoose";
import {
  ALL_MLM_MILESTONE_REWARD_TYPES,
  ALL_MLM_MILESTONE_TYPES,
  ALL_MLM_PLAN_TYPES,
} from "../constants/mlm.js";

/**
 * MlmRewardMilestone — admin-editable rule table for milestone-driven
 * rewards (Phase 4: gift voucher / shopping credit / earning credit
 * on direct-referral-count or lifetime-earning thresholds).
 *
 * Evaluated post-commit by `mlmRewardService.evaluateMilestonesAfterCommission`
 * after every membership counter change. Idempotency is enforced by
 * a uniqueness check on (userId, milestoneId) — implemented via a
 * MlmMembershipMilestoneApplied record (added in Phase 4) or
 * stored in `MlmMembership.meta.appliedMilestones`.
 *
 * Phase 1 model only — no rules are populated by default. Admin
 * creates rows via the AdminSettings / dedicated milestones page
 * once Phase 4 ships the evaluator.
 */
const mlmRewardMilestoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },

    milestoneType: {
      type: String,
      enum: ALL_MLM_MILESTONE_TYPES,
      required: true,
      index: true,
    },
    threshold: { type: Number, required: true, min: 0 },

    rewardType: {
      type: String,
      enum: ALL_MLM_MILESTONE_REWARD_TYPES,
      required: true,
    },
    rewardAmount: { type: Number, default: 0, min: 0 },
    rewardCouponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
    },

    planRequired: {
      type: String,
      enum: [...ALL_MLM_PLAN_TYPES, "any"],
      default: "any",
    },

    active: { type: Boolean, default: true, index: true },

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
  },
  { timestamps: true },
);

mlmRewardMilestoneSchema.index({ milestoneType: 1, threshold: 1, active: 1 });

mlmRewardMilestoneSchema.pre(/^find/, function preFindFilterSoftDeleted(next) {
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

export default mongoose.model("MlmRewardMilestone", mlmRewardMilestoneSchema);
