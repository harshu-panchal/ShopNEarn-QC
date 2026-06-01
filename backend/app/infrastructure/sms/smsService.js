/**
 * Forward-compat shim for `app/services/smsIndiaHubService.js`.
 *
 * Renamed to the provider-neutral `smsService.js` at the new path so that
 * future provider swaps (e.g. Twilio, MSG91) only change the adapter
 * implementation, not every importer.
 *
 * See app/infrastructure/README.md for the migration plan.
 */
export * from "../../services/smsIndiaHubService.js";
