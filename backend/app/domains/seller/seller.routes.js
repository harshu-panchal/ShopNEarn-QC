/**
 * Re-export shim — see `app/domains/README.md`.
 * Canonical implementation lives at `app/routes/sellerAuth.js`.
 *
 * Other seller-facing routes are mounted from `routes/index.js` directly
 * onto domain-specific paths (`/seller/stats`, `/seller/wallet`, etc.) — see
 * that file for the full map.
 */
export { default } from "../../routes/sellerAuth.js";
