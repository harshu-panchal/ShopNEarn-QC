import express from "express";
import {
    getCart,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart
} from "../controller/cartController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
    addToCartSchema,
    updateCartItemSchema,
    removeCartItemQuerySchema,
} from "../validation/cartValidation.js";

const router = express.Router();

router.use(verifyToken); // All cart routes require auth

// Validation middleware wired in Phase 1 (audit-plan ticket P1-4).
// Schemas in cartValidation.js were updated in the same phase to use
// the canonical `variantSku` field name (was `variantSlot`).
router.get("/", getCart);
router.post("/add", validate(addToCartSchema), addToCart);
router.put("/update", validate(updateCartItemSchema), updateQuantity);
router.delete(
    "/remove/:productId",
    validate(removeCartItemQuerySchema, "query"),
    removeFromCart,
);
router.delete("/clear", clearCart);

export default router;
