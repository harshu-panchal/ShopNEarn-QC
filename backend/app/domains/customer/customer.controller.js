/**
 * Re-export shim — see `app/domains/README.md`.
 *
 * The customer HTTP surface is split across:
 *   - customerAuthController.js  (OTP signup/login, profile bootstrap)
 *   - cartController.js          (cart CRUD)
 *   - wishlistController.js      (wishlist CRUD)
 *
 * Re-exported here under one namespace for domain-style imports.
 */
export * from "../../controller/customerAuthController.js";
export * from "../../controller/cartController.js";
export * from "../../controller/wishlistController.js";
