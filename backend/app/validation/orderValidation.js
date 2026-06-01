/**
 * Joi schemas for order-related endpoints.
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

export const placeOrderSchema = Joi.object({
  addressId: trimmedString.min(1).required(),
  paymentMode: trimmedString.valid("ONLINE", "COD", "WALLET").required(),
  notes: trimmedString.max(500).allow("", null).optional(),
  couponCode: trimmedString.max(40).optional(),
  cartId: trimmedString.optional(),
  timeSlot: trimmedString.optional(),
});

export const cancelOrderSchema = Joi.object({
  reason: trimmedString.min(1).max(500).required(),
});

export const updateOrderStatusSchema = Joi.object({
  status: trimmedString
    .valid(
      "pending",
      "confirmed",
      "packed",
      "out_for_delivery",
      "delivered",
      "cancelled",
    )
    .required(),
  reason: trimmedString.max(500).optional(),
});

const returnItemSchema = Joi.object({
  itemIndex: Joi.number().integer().min(0).required(),
  quantity: Joi.number().integer().min(1).required(),
});

export const requestReturnSchema = Joi.object({
  items: Joi.array().items(returnItemSchema).min(1).required(),
  reason: trimmedString.min(1).max(500).required(),
  reasonDetail: trimmedString.max(2000).allow("").optional(),
  images: Joi.array().items(trimmedString.uri()).max(5).optional(),
  conditionAssurance: Joi.boolean().optional(),
});

export const rejectReturnSchema = Joi.object({
  reason: trimmedString.min(1).max(500).required(),
});

export const updateReturnQcSchema = Joi.object({
  qcStatus: trimmedString.valid("passed", "failed").required(),
  note: trimmedString.max(1000).optional(),
});

export const assignReturnDeliverySchema = Joi.object({
  deliveryBoyId: trimmedString.optional(),
});

export const acceptOrderSchema = Joi.object({}).unknown(false);

export const skipOrderSchema = Joi.object({
  reason: trimmedString.max(500).optional(),
});
