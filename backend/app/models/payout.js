import mongoose from "mongoose";
import { ALL_PAYOUT_STATUSES, ALL_PAYOUT_TYPES, CURRENCY, PAYOUT_TYPE } from "../constants/finance.js";

// Phase 5 P5-4: `beneficiaryId` was a bare ObjectId — `populate()` could
// not resolve the target document because Mongoose didn't know which
// collection to look in. The new `beneficiaryModel` discriminator paired
// with `refPath` lets `populate("beneficiaryId")` return the right doc.
//
// Backward compatibility: the field is OPTIONAL (no `required: true`) so
// historical rows that don't carry it still validate. The pre('save')
// hook below auto-derives the value from `payoutType` for any new write
// that forgets to set it. The migration script
// `backend/scripts/migrate-customer-to-user-discriminator.js` backfills
// `beneficiaryModel` on every existing row.
const PAYOUT_TYPE_TO_BENEFICIARY_MODEL = {
  [PAYOUT_TYPE.SELLER]: "Seller",
  [PAYOUT_TYPE.DELIVERY_PARTNER]: "Delivery",
  // MLM Phase 1: customer-side withdrawal beneficiary is the User document.
  [PAYOUT_TYPE.CUSTOMER_WITHDRAWAL]: "User",
};

const payoutSchema = new mongoose.Schema(
  {
    payoutType: {
      type: String,
      enum: ALL_PAYOUT_TYPES,
      required: true,
      index: true,
    },
    beneficiaryModel: {
      type: String,
      // MLM Phase 1: "User" added to support customer-side withdrawal
      // payouts (`payoutType: CUSTOMER_WITHDRAWAL`). Existing seller +
      // delivery rows are untouched; the pre('save') hook below derives
      // the right value from `payoutType` when callers omit it.
      enum: ["Seller", "Delivery", "User"],
      default: undefined,
    },
    beneficiaryId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      refPath: "beneficiaryModel",
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: CURRENCY,
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ALL_PAYOUT_STATUSES,
      default: "PENDING",
      index: true,
    },
    relatedOrderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    remarks: {
      type: String,
      trim: true,
    },
    // Phase 5 P5-5: `ref: "Admin"` lets `populate("createdBy")` resolve
    // the admin user that triggered the payout.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    failedReason: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true },
);

payoutSchema.index({ beneficiaryId: 1, payoutType: 1, status: 1 });
payoutSchema.index({ relatedOrderIds: 1 });

// Phase 5 P5-4: auto-derive `beneficiaryModel` from `payoutType` so
// new writes don't have to know about the discriminator field.
function deriveBeneficiaryModel(doc) {
  if (doc.beneficiaryModel) return;
  const mapped = PAYOUT_TYPE_TO_BENEFICIARY_MODEL[doc.payoutType];
  if (mapped) doc.beneficiaryModel = mapped;
}

payoutSchema.pre("save", function onSavePayout(next) {
  deriveBeneficiaryModel(this);
  next();
});

payoutSchema.pre("insertMany", function onInsertManyPayouts(next, docs) {
  if (Array.isArray(docs)) docs.forEach(deriveBeneficiaryModel);
  next();
});

function preUpdateDeriveBeneficiaryModel(next) {
  const update = this.getUpdate() || {};
  const set = update.$set || update;
  if (!set || typeof set !== "object") return next();
  if (set.payoutType && !set.beneficiaryModel) {
    const mapped = PAYOUT_TYPE_TO_BENEFICIARY_MODEL[set.payoutType];
    if (mapped) set.beneficiaryModel = mapped;
    if (update.$set) update.$set = set;
  }
  next();
}
payoutSchema.pre("findOneAndUpdate", preUpdateDeriveBeneficiaryModel);
payoutSchema.pre("updateOne", preUpdateDeriveBeneficiaryModel);
payoutSchema.pre("updateMany", preUpdateDeriveBeneficiaryModel);

export default mongoose.model("Payout", payoutSchema);
