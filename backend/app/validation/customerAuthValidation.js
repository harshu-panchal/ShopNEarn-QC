import Joi from "joi";

/**
 * Customer-MLM-rebuild Phase 1: signup payload.
 *
 * Required:
 *   - name: customer full name
 *   - email: lowercased. NOT unique (Phase 7 — multiple customers may
 *     share an email; login disambiguates via bcrypt password match).
 *   - phone: 7–24 chars, normalized to E.164 by the auth service.
 *     Phone IS unique — it is the canonical customer identity.
 *   - password: any non-empty string (PO-request: zero complexity rules)
 *   - referralCode: sponsor's referral code (4–16 alphanum chars, uppercase)
 *   - leg: "L" or "R" — which leg under the sponsor the new member chose
 *
 * No optional fields. The customer cannot complete signup without all six.
 *
 * Password validation history — originally enforced min 8 chars + letter
 * + digit. Removed entirely on PO request: signup friction was too high.
 * The only constraint kept is a 1024-char hard cap so an abusive client
 * cannot post arbitrarily large bodies. `confirmPassword` is no longer
 * collected by the UI; if a client still sends it, `stripUnknown` will
 * drop it before validation.
 */
export const sendSignupOtpSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  email: Joi.string().trim().lowercase().email({ minDomainSegments: 2 }).max(160).required(),
  phone: Joi.string().trim().min(7).max(24).required(),
  password: Joi.string().min(1).max(1024).required(),
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

/**
 * Customer-MLM-rebuild Phase 7 (PO-request): change-password payload.
 *
 * Authenticated endpoint. The session JWT identifies WHICH customer;
 * the body authorises the WRITE by proving knowledge of the current
 * password (bcrypt-compared against the stored hash).
 *
 * Like signup, `newPassword` has zero complexity rules — just a
 * non-empty string with a sane upper bound to prevent abuse.
 */
export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(1).max(1024).required(),
  newPassword: Joi.string().min(1).max(1024).required(),
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
