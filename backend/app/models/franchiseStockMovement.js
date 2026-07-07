import mongoose from "mongoose";
import { ALL_FRANCHISE_STOCK_TYPES } from "../constants/inventory.js";

const franchiseStockMovementSchema = new mongoose.Schema(
  {
    franchisePartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchisePartner",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ALL_FRANCHISE_STOCK_TYPES,
      required: true,
      index: true,
    },
    /** Positive = incoming, negative = outgoing */
    quantity: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    transferGroupId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    variantSku: {
      type: String,
      trim: true,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

franchiseStockMovementSchema.index(
  { franchisePartnerId: 1, productId: 1, createdAt: -1 },
);
franchiseStockMovementSchema.index({ franchisePartnerId: 1, createdAt: -1 });

export default mongoose.model(
  "FranchiseStockMovement",
  franchiseStockMovementSchema,
);
