/**
 * Joi schemas for seller-facing endpoints (registration, profile, payouts).
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const phone = trimmedString.pattern(/^\+?\d{10,15}$/);

export const sellerSignupSchema = Joi.object({
  name: trimmedString.min(2).max(100).required(),
  email: trimmedString.email().lowercase().required(),
  password: trimmedString.min(8).max(128).required(),
  phone: phone.required(),
  shopName: trimmedString.min(2).max(200).required(),
  address: trimmedString.max(500).optional(),
});

export const sellerLoginSchema = Joi.object({
  email: trimmedString.email().lowercase().required(),
  password: trimmedString.min(1).required(),
});

export const sellerProfileUpdateSchema = Joi.object({
  name: trimmedString.min(2).max(100).optional(),
  phone: phone.optional(),
  shopName: trimmedString.min(2).max(200).optional(),
  address: trimmedString.max(500).optional(),
  shopBio: trimmedString.max(2000).optional(),
  serviceRadius: Joi.number().min(0).max(100).optional(),
});

export const sellerPasswordChangeSchema = Joi.object({
  currentPassword: trimmedString.min(1).required(),
  newPassword: trimmedString.min(8).max(128).required(),
});

export const withdrawalRequestSchema = Joi.object({
  amount: Joi.number().min(1).required(),
  bankAccountId: trimmedString.optional(),
  notes: trimmedString.max(500).optional(),
});

export const sellerOnboardingSchema = Joi.object({
  shopName: trimmedString.min(2).max(200).required(),
  address: trimmedString.min(2).max(500).required(),
  phone: phone.required(),
  documentUrls: Joi.array().items(trimmedString.uri()).max(10).optional(),
  bankAccount: Joi.object({
    accountNumber: trimmedString
      .pattern(/^\d{9,18}$/)
      .required(),
    ifsc: trimmedString
      .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .required(),
    accountHolderName: trimmedString.min(2).max(100).required(),
  }).optional(),
});
