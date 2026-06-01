import express from "express";
import {
    getWishlist,
    addToWishlist,
    removeFromWishlist,
    toggleWishlist
} from "../controller/wishlistController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
    addToWishlistSchema,
    toggleWishlistSchema,
    removeFromWishlistParamsSchema,
} from "../validation/wishlistValidation.js";

const router = express.Router();

router.use(verifyToken); // All wishlist routes require auth

// Validation wired in Phase 1 (audit-plan ticket P1-4). Schemas are
// in wishlistValidation.js; controllers continue to expect the same
// req.body / req.params shapes they did before.
router.get("/", getWishlist);
router.post("/add", validate(addToWishlistSchema), addToWishlist);
router.post("/toggle", validate(toggleWishlistSchema), toggleWishlist);
router.delete(
    "/remove/:productId",
    validate(removeFromWishlistParamsSchema, "params"),
    removeFromWishlist,
);

export default router;
