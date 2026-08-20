import mongoose from "mongoose";
import { roundCurrency } from "../utils/money.js";

/**
 * MlmJoiningPlan — admin-managed catalog of joining packages a new
 * customer can choose from at MLM signup. Generalizes the old single
 * global `Setting.mlm.joiningPackagePrice` /
 * `joiningPackageShoppingWalletCredit` pair into an admin CRUD
 * collection (mirrors `MlmRewardMilestone`'s soft-delete pattern).
 *
 * A plan differs from another in price + shopping-wallet credit
 * (+ marketing copy) AND in `benefitBaseAmount` — the ₹ base used to
 * scale sponsor/referral/pair-matching bonuses for members who join
 * under this plan (see `mlmBinaryPairIncomeService.js` and
 * `mlmSignupBonusService.js`). `planType` (A/B) remains the sole
 * driver of *which* bonus mechanics apply; this only scales their size.
 * See `mlmJoiningPaymentService.initiateJoiningPayment` for how price/
 * credit/benefitBaseAmount are snapshotted onto `MlmJoiningPayment` at
 * intent time, and onward onto `MlmMembership` at activation — editing
 * a plan later never retroactively changes an already-joined member.
 */
const mlmJoiningPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },

    price: { type: Number, required: true, min: 0 },
    shoppingWalletCredit: { type: Number, required: true, min: 0 },

    // Admin-typed, independent of `price` — deliberate business
    // judgment input, not derived from it.
    planCharge: { type: Number, required: true, min: 0 },
    // Percentage of `planCharge` used to derive `benefitBaseAmount`.
    benefitPercent: { type: Number, required: true, min: 0 },
    // Derived + stored: roundCurrency(planCharge * benefitPercent / 100).
    // Recomputed in the pre("save") hook below whenever its inputs
    // change — never accepted directly from the client.
    benefitBaseAmount: { type: Number, required: true, min: 0, default: 0 },

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

mlmJoiningPlanSchema.pre("save", function computeBenefitBaseAmount(next) {
  if (this.isModified("planCharge") || this.isModified("benefitPercent") || this.isNew) {
    this.benefitBaseAmount = roundCurrency(
      (Number(this.planCharge) || 0) * (Number(this.benefitPercent) || 0) / 100,
    );
  }
  next();
});

// `updateJoiningPlan` uses `findByIdAndUpdate`, which bypasses the
// pre("save") hook above — recompute here too whenever the update
// touches either input, so `benefitBaseAmount` never goes stale.
mlmJoiningPlanSchema.pre("findOneAndUpdate", async function recomputeBenefitBaseAmountOnUpdate(next) {
  const update = this.getUpdate() || {};
  const set = update.$set || update;
  if (set.planCharge === undefined && set.benefitPercent === undefined) return next();

  const current = await this.model.findOne(this.getQuery()).lean();
  const planCharge = Number(set.planCharge !== undefined ? set.planCharge : current?.planCharge) || 0;
  const benefitPercent = Number(set.benefitPercent !== undefined ? set.benefitPercent : current?.benefitPercent) || 0;
  const benefitBaseAmount = roundCurrency((planCharge * benefitPercent) / 100);

  if (update.$set) {
    update.$set.benefitBaseAmount = benefitBaseAmount;
  } else {
    update.benefitBaseAmount = benefitBaseAmount;
  }
  this.setUpdate(update);
  next();
});

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
