import Joi from "joi";

/**
 * Customer-MLM-rebuild Phase 1: signup payload.
 *
 * Required:
 *   - name: customer full name
 *   - email: lowercased; uniqueness enforced at controller layer
 *   - phone: 7–24 chars, normalized to E.164 by the auth service
 *   - password: >=8 chars, must contain at least one letter and one digit
 *   - referralCode: sponsor's referral code (4–16 alphanum chars, uppercase)
 *   - leg: "L" or "R" — which leg under the sponsor the new member chose
 *
 * No optional fields. The customer cannot complete signup without all six.
 *
 * `confirmPassword` is intentionally NOT validated here — confirmation
 * is a client-side concern; the server only stores the canonical
 * password.
 */
export const sendSignupOtpSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  email: Joi.string().trim().lowercase().email({ minDomainSegments: 2 }).max(160).required(),
  phone: Joi.string().trim().min(7).max(24).required(),
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/[A-Za-z]/, { name: "letter" })
    .pattern(/\d/, { name: "digit" })
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters long",
      "string.pattern.name":
        "Password must include at least one letter and one digit",
    }),
  referralCode: Joi.string()
    .trim()
    .uppercase()
    .alphanum()
    .min(4)
    .max(16)
    .required(),
  leg: Joi.string().trim().uppercase().valid("L", "R").required(),
});

export const sendLoginOtpSchema = Joi.object({
  phone: Joi.string().trim().min(7).max(24).required(),
});

export const verifyOtpSchema = Joi.object({
  phone: Joi.string().trim().min(7).max(24).required(),
  otp: Joi.string().trim().pattern(/^\d{4,8}$/).required(),
});

/**
 * Customer-MLM-rebuild Phase 2: password-login payload.
 *
 * `identifier` is either an email address or a phone number; the
 * controller decides which field to query based on `@` presence.
 */
export const loginWithPasswordSchema = Joi.object({
  identifier: Joi.string().trim().min(3).max(160).required(),
  password: Joi.string().min(1).max(128).required(),
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
