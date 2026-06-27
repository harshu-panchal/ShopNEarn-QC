import mongoose from "mongoose";
import {
  ALL_FRANCHISE_PARTNER_STATUSES,
  FRANCHISE_PARTNER_STATUS,
} from "../constants/franchise.js";

const franchisePartnerSchema = new mongoose.Schema(
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
      trim: true,
      uppercase: true,
      index: true,
    },
    status: {
      type: String,
      enum: ALL_FRANCHISE_PARTNER_STATUSES,
      default: FRANCHISE_PARTNER_STATUS.PENDING_PAYMENT,
      index: true,
    },
    territoryPincodes: {
      type: [String],
      default: [],
      index: true,
    },
    address: { type: String, trim: true, default: "" },
    locality: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: undefined,
      },
    },
    hubSellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      default: null,
      index: true,
    },
    registrationPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchiseRegistrationPayment",
      default: null,
    },
    registeredAt: { type: Date, default: null },
    displayName: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    deletedAt: { type: Date, default: null },
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

franchisePartnerSchema.index({ territoryPincodes: 1, status: 1 });
franchisePartnerSchema.index({ location: "2dsphere" });

franchisePartnerSchema.pre(/^find/, function preFindFilterSoftDeleted(next) {
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

export default mongoose.model("FranchisePartner", franchisePartnerSchema);
