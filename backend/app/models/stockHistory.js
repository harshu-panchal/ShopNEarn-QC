import mongoose from "mongoose";
import { ALL_HUB_STOCK_TYPES } from "../constants/inventory.js";

const stockHistorySchema = new mongoose.Schema(
    {
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
        },
        seller: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Seller",
            required: true,
        },
        type: {
            type: String,
            enum: ALL_HUB_STOCK_TYPES,
            required: true,
        },
        quantity: {
            type: Number, // Positive for restock, negative for sale/correction
            required: true,
        },
        note: {
            type: String,
            trim: true,
        },
        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
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
        idempotencyKey: {
            type: String,
            trim: true,
            default: null,
        },
    },
    { timestamps: true }
);

stockHistorySchema.index({ product: 1, seller: 1, createdAt: -1 });
stockHistorySchema.index({ order: 1 });
stockHistorySchema.index({ type: 1 });
stockHistorySchema.index({ seller: 1, type: 1, createdAt: -1 });
stockHistorySchema.index(
    { idempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            idempotencyKey: { $type: "string" },
        },
    },
);

export default mongoose.model("StockHistory", stockHistorySchema);
