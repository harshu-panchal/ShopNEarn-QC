import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
    {
        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            // NOTE: customer model file (app/models/customer.js) registers
            // as mongoose.model("User", ...). The legacy "Customer" ref
            // here silently broke every populate() call. Fixed in Phase 1
            // (audit-plan critical finding C-1). Do not change without
            // updating the registered model name in customer.js too.
            ref: "User",
            required: true,
            unique: true,
        },
        items: [
            {
                productId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Product",
                    required: true,
                },
                // Distinguish product variants inside the cart.
                // We use variant SKU because Product.variants includes a sku field.
                // Empty string / null means "base product" (no variant selected).
                variantSku: {
                    type: String,
                    default: "",
                    trim: true,
                },
                quantity: {
                    type: Number,
                    required: true,
                    min: 1,
                    default: 1,
                },
            },
        ],
    },
    { timestamps: true }
);

const Cart = mongoose.model("Cart", cartSchema);
export default Cart;
