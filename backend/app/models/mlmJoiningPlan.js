import mongoose from "mongoose";

/**
 * MlmJoiningPlan — admin-managed catalog of joining packages a new
 * customer can choose from at MLM signup. Generalizes the old single
 * global `Setting.mlm.joiningPackagePrice` /
 * `joiningPackageShoppingWalletCredit` pair into an admin CRUD
 * collection (mirrors `MlmRewardMilestone`'s soft-delete pattern).
 *
 * Deliberately narrow scope: a plan differs from another ONLY in
 * price + shopping-wallet credit (+ marketing copy). It does NOT carry
 * its own commission-engine configuration — every joining plan still
 * produces a standard Plan A member with identical bonus mechanics.
 * See `mlmJoiningPaymentService.initiateJoiningPayment` for how price/
 * credit are snapshotted onto `MlmJoiningPayment` at intent time.
 */
const mlmJoiningPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },

    price: { type: Number, required: true, min: 0 },
    shoppingWalletCredit: { type: Number, required: true, min: 0 },

    // Display order on the customer-facing picker (ascending).
    sortOrder: { type: Number, default: 0 },

    active: { type: Boolean, default: true, index: true },

    deletedAt: { type: Date, default: null, index: true },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    createdBy: {
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

mlmJoiningPlanSchema.index({ active: 1, sortOrder: 1 });

mlmJoiningPlanSchema.pre(/^find/, function preFindFilterSoftDeleted(next) {
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

export default mongoose.model("MlmJoiningPlan", mlmJoiningPlanSchema);
