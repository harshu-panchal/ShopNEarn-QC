/**
 * Re-export shim — see `app/domains/README.md`.
 *
 * Finance has two HTTP controllers:
 *   - orderFinanceController.js  (per-order finance ops)
 *   - adminFinanceController.js  (admin-side wallet/payout/settlement)
 *
 * Both re-exported here so domain consumers find them under one path.
 */
export * from "../../controller/orderFinanceController.js";
export * from "../../controller/adminFinanceController.js";
