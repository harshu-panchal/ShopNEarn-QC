/**
 * Payment provider registry.
 *
 * Selects the active payment provider adapter at runtime based on the
 * `PAYMENT_PROVIDER` environment variable. Defaults to PhonePe to match
 * the prior hardcoded behaviour exactly (rollback = no-op).
 *
 * Adding a new provider:
 *   1. Implement a class extending `PaymentProviderPort` in
 *      `./providers/<name>.adapter.js`.
 *   2. Register it in the switch below.
 *   3. Deploy with `PAYMENT_PROVIDER=<name>` to opt-in (default stays
 *      PhonePe so existing traffic continues unchanged).
 *
 * Rollback is a single env-var flip — no code change.
 */

import { PhonePeAdapter } from "./providers/phonepe.adapter.js";

let _provider = null;
let _providerName = null;

function resolveProviderName() {
  return String(process.env.PAYMENT_PROVIDER || "phonepe").toLowerCase().trim();
}

function buildProvider(name) {
  switch (name) {
    case "phonepe":
      return new PhonePeAdapter();
    // future: case "razorpay": return new RazorpayAdapter();
    // future: case "stripe":   return new StripeAdapter();
    default:
      throw new Error(`Unknown payment provider: ${name}`);
  }
}

/**
 * Returns the active provider singleton. Re-resolves when the env var
 * changes (used in tests).
 */
export function getActivePaymentProvider() {
  const desired = resolveProviderName();
  if (_provider && _providerName === desired) {
    return _provider;
  }
  _provider = buildProvider(desired);
  _providerName = desired;
  return _provider;
}

/**
 * Test helper. Allows test code to swap the provider in for a fake.
 */
export function __setActivePaymentProviderForTests(provider, name = "test") {
  _provider = provider;
  _providerName = name;
}

/**
 * Test helper. Forces the next `getActivePaymentProvider()` call to rebuild.
 */
export function __resetPaymentProviderForTests() {
  _provider = null;
  _providerName = null;
}
