/**
 * Joi schemas for customer-facing endpoints beyond auth (auth schemas live
 * in `customerAuthValidation.js`).
 *
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const objectIdLike = trimmedString.min(8).max(64);
const latitude = Joi.number().min(-90).max(90);
const longitude = Joi.number().min(-180).max(180);

export const updateProfileSchema = Joi.object({
  name: trimmedString.min(2).max(80).optional(),
  email: trimmedString.email().lowercase().max(200).optional(),
  avatarUrl: trimmedString.uri().max(2048).optional(),
  dateOfBirth: Joi.date().optional(),
  gender: trimmedString.valid("male", "female", "other", "prefer_not_say").optional(),
});

export const addAddressSchema = Joi.object({
  label: trimmedString.max(40).optional(),
  name: trimmedString.min(2).max(80).required(),
  phone: trimmedString.pattern(/^\+?\d{10,15}$/).required(),
  address: trimmedString.min(2).max(500).required(),
  landmark: trimmedString.max(200).allow("", null).optional(),
  city: trimmedString.max(120).optional(),
  state: trimmedString.max(120).optional(),
  pincode: trimmedString.pattern(/^\d{4,10}$/).optional(),
  location: Joi.object({
    type: trimmedString.valid("Point").default("Point"),
    coordinates: Joi.array().items(longitude, latitude).length(2).required(),
  }).optional(),
  isDefault: Joi.boolean().optional(),
});

export const updateAddressSchema = addAddressSchema.fork(
  ["name", "phone", "address"],
  (s) => s.optional(),
);

export const wishlistToggleSchema = Joi.object({
  productId: objectIdLike.required(),
});

export const submitReviewSchema = Joi.object({
  productId: objectIdLike.required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: trimmedString.max(2000).allow("", null).optional(),
  images: Joi.array().items(trimmedString.uri()).max(5).optional(),
});
