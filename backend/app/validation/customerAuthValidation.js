import Joi from "joi";

export const sendSignupOtpSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  phone: Joi.string().trim().min(7).max(24).required(),
  // MLM Phase 1: optional sponsor referral code captured at signup.
  // Persisted on `Customer.pendingSponsorReferralCode` until the
  // joining-package activation hook consumes it to wire the sponsor
  // edge on the new MlmMembership.
  referralCode: Joi.string()
    .trim()
    .uppercase()
    .alphanum()
    .min(4)
    .max(16)
    .optional()
    .allow("", null),
});

export const sendLoginOtpSchema = Joi.object({
  phone: Joi.string().trim().min(7).max(24).required(),
});

export const verifyOtpSchema = Joi.object({
  phone: Joi.string().trim().min(7).max(24).required(),
  otp: Joi.string().trim().pattern(/^\d{4,8}$/).required(),
});

export function validateSchema(schema, payload) {
  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (!error) return value;
  const err = new Error(error.details.map((item) => item.message).join("; "));
  err.statusCode = 400;
  throw err;
}
