/**
 * Joi schemas for wishlist endpoints.
 *
 * Introduced in Phase 1 (audit-plan ticket P1-4) so wishlist routes can
 * use the shared `validate()` middleware instead of relying on the
 * controller to handle missing / malformed payloads. Field names match
 * the wishlistController and the Wishlist model (`customerId`, `products`).
 *
 * Adoption is opt-in via the route definition; the schemas themselves
 * impose no behavior change until wired in `wishlistRoutes.js`.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const objectIdLike = trimmedString.min(8).max(64);

/**
 * POST /wishlist/add - add a product to the customer's wishlist.
 * The controller reads { productId } from req.body.
 */
export const addToWishlistSchema = Joi.object({
  productId: objectIdLike.required(),
});

/**
 * POST /wishlist/toggle - add the product if absent, otherwise remove it.
 * Same body shape as addToWishlist.
 */
export const toggleWishlistSchema = Joi.object({
  productId: objectIdLike.required(),
});

/**
 * DELETE /wishlist/remove/:productId - validates the URL param.
 * Wired via `validate(removeFromWishlistParamsSchema, "params")`.
 */
export const removeFromWishlistParamsSchema = Joi.object({
  productId: objectIdLike.required(),
});
