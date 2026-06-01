/**
 * Joi schemas for delivery-partner-facing endpoints.
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const latitude = Joi.number().min(-90).max(90);
const longitude = Joi.number().min(-180).max(180);

export const updateLocationSchema = Joi.object({
  lat: latitude.required(),
  lng: longitude.required(),
  accuracy: Joi.number().min(0).optional(),
  heading: Joi.number().min(0).max(360).optional(),
  speed: Joi.number().min(0).optional(),
});

export const goOnlineSchema = Joi.object({
  lat: latitude.optional(),
  lng: longitude.optional(),
}).unknown(false);

export const completeDeliverySchema = Joi.object({
  otp: trimmedString.length(6).pattern(/^\d+$/).optional(),
  proofImageUrl: trimmedString.uri().optional(),
  notes: trimmedString.max(500).optional(),
});

export const submitCodCashSchema = Joi.object({
  amount: Joi.number().min(0).required(),
  notes: trimmedString.max(500).optional(),
});

export const withdrawalRequestSchema = Joi.object({
  amount: Joi.number().min(1).required(),
  notes: trimmedString.max(500).optional(),
});

export const updateProfileSchema = Joi.object({
  name: trimmedString.min(2).max(100).optional(),
  phone: trimmedString
    .pattern(/^\+?\d{10,15}$/)
    .optional(),
  vehicleType: trimmedString
    .valid("bike", "scooter", "bicycle", "car", "other")
    .optional(),
  vehicleNumber: trimmedString.max(20).optional(),
});
