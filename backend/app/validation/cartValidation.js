/**
 * Joi schemas for cart endpoints.
 *
 * Part of refactor P5.2 (add missing validation schemas). Schemas here are
 * the canonical source of truth — controllers should swap their inline
 * validation for these progressively via the shared `validate` middleware
 * factory at `app/middleware/validate.js`.
 *
 * Adoption is opt-in: introducing the schema does not break any current
 * call-site, and controllers continue using inline validation until they
 * are migrated one by one.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const objectIdLike = trimmedString.min(8).max(64);

// Field name, Phase 1 (audit-plan ticket P1-4 pre-wiring fix):
// the schemas in this file originally used `variantSlot`, but the cart
// controller (`addToCart`, `updateQuantity`, `removeFromCart`) and the
// Cart schema (`cart.js`) both use `variantSku`. With `stripUnknown:
// true` on the shared `validate()` middleware, wiring the original
// schemas would have silently dropped every variant on add/update.
// These files were not wired into any route before this PR, so no
// production traffic actually sent the legacy key — the rename is
// purely internal.
const variantSkuField = trimmedString.max(64).optional();

/** POST /cart/add — add an item to the customer's cart. */
export const addToCartSchema = Joi.object({
  productId: objectIdLike.required(),
  quantity: Joi.number().integer().min(1).max(99).required(),
  variantSku: variantSkuField,
});

/** PUT /cart/update — update quantity (and optionally variantSku) for an existing line item. */
export const updateCartItemSchema = Joi.object({
  productId: objectIdLike.required(),
  quantity: Joi.number().integer().min(0).max(99).required(),
  variantSku: variantSkuField,
});

/** DELETE /cart/remove/:productId — variantSku is read from `req.query`. */
export const removeCartItemQuerySchema = Joi.object({
  variantSku: variantSkuField,
});

/** POST /cart/merge — used when an anonymous cart is merged into a user cart on login. */
export const mergeCartSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        productId: objectIdLike.required(),
        quantity: Joi.number().integer().min(1).max(99).required(),
        variantSku: variantSkuField,
      }),
    )
    .min(1)
    .required(),
});

/**
 * Backwards-compatible alias for the historical export name. The new
 * canonical export is `removeCartItemQuerySchema`. No call site uses
 * the old name in this repo today (the schema was never wired); kept
 * for one release to absorb any external consumer.
 * @deprecated Use removeCartItemQuerySchema.
 */
export const removeCartItemSchema = removeCartItemQuerySchema;
