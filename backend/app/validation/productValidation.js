/**
 * Joi schemas for product CRUD and moderation endpoints.
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const objectIdLike = trimmedString.min(8).max(64);

export const createProductSchema = Joi.object({
  name: trimmedString.min(1).max(200).required(),
  description: trimmedString.max(5000).optional(),
  price: Joi.number().min(0).required(),
  salePrice: Joi.number().min(0).optional(),
  stock: Joi.number().integer().min(0).required(),
  unit: trimmedString.optional(),
  category: objectIdLike.required(),
  subCategory: objectIdLike.optional(),
  mainImage: trimmedString.uri().optional(),
  images: Joi.array().items(trimmedString.uri()).max(10).optional(),
  isActive: Joi.boolean().optional(),
  variants: Joi.array()
    .items(
      Joi.object({
        slot: trimmedString.required(),
        price: Joi.number().min(0).required(),
        stock: Joi.number().integer().min(0).required(),
        unit: trimmedString.optional(),
      }),
    )
    .optional(),
  brand: trimmedString.max(100).optional(),
  tags: Joi.array().items(trimmedString.max(50)).max(20).optional(),
}).unknown(true); // images may arrive via multer in a different field

export const updateProductSchema = createProductSchema.fork(
  ["name", "price", "stock", "category"],
  (s) => s.optional(),
);

export const productModerationActionSchema = Joi.object({
  reason: trimmedString.max(1000).optional(),
  notes: trimmedString.max(1000).optional(),
});

export const updateStockSchema = Joi.object({
  stock: Joi.number().integer().min(0).required(),
  variantSlot: trimmedString.optional(),
});
