/**
 * Re-export shim — see `app/domains/README.md`.
 *
 * The seller HTTP surface is currently split across three controllers:
 *   - sellerController.js        (nearby sellers, public-facing endpoints)
 *   - sellerAuthController.js    (signup, login, OTP)
 *   - sellerStatsController.js   (dashboard stats, earnings)
 *
 * All three are re-exported here so domain consumers can find them through a
 * single import path.
 */
export * from "../../controller/sellerController.js";
export * from "../../controller/sellerAuthController.js";
export * from "../../controller/sellerStatsController.js";
