/**
 * Aggregate validation barrel for customer-facing endpoints. Re-exports the
 * per-area Joi schemas so a single import path serves every customer route.
 *
 *   import { customerValidation } from "@/domains/customer";
 *   customerValidation.sendSignupOtpSchema   // from customerAuthValidation
 *   customerValidation.addToCartSchema       // from cartValidation
 *   customerValidation.addAddressSchema      // from customerValidation
 */
export * from "../../validation/customerAuthValidation.js";
export * from "../../validation/customerValidation.js";
export * from "../../validation/cartValidation.js";
