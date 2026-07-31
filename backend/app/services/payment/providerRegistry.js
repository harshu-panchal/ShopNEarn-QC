/**
 * Payment provider registry.
 *
 * Selects the active payment provider adapter at runtime based on the
 * `PAYMENT_PROVIDER` environment variable. Defaults to Razorpay.
 *
 * Adding a new provider:
 *   1. Implement a class extending `PaymentProviderPort` in
 *      `./providers/<name>.adapter.js`.
 *   2. Register it in the switch below.
 *   3. Deploy with `PAYMENT_PROVIDER=<name>` to opt-in.
 */

import { RazorpayAdapter } from "./providers/razorpay.adapter.js";

let _provider = null;
let _providerName = null;

function resolveProviderName() {
  return String(process.env.PAYMENT_PROVIDER || "razorpay")
    .toLowerCase()
    .trim();
}

function buildProvider(name) {
  switch (name) {
    case "razorpay":
      return new RazorpayAdapter();
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
