import mongoose from "mongoose";

const franchiseStockLedgerSchema = new mongoose.Schema(
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
    variantSku: { type: String, default: "" },
    variantName: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 0 },
    sourceTopUpId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchiseWalletTopUp",
      default: null,
    },
    sourceStockOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

franchiseStockLedgerSchema.index(
  { franchisePartnerId: 1, productId: 1, variantSku: 1 },
  { unique: true },
);

export default mongoose.model("FranchiseStockLedger", franchiseStockLedgerSchema);
