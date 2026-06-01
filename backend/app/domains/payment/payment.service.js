/**
 * Aggregate barrel for payment-domain services.
 *
 * `paymentService.js` is the provider-agnostic orchestrator (refactored in
 * P3.3). All provider-specific code lives behind adapters in
 * `services/payment/providers/` and is selected at runtime by
 * `services/payment/providerRegistry.js` (P3.1, P3.2, P3.3).
 *
 * Domain consumers should fetch the registry and the orchestrator from
 * here rather than reaching into `services/`:
 *
 *   import {
 *     createPaymentOrderForOrderRef,
 *     getActivePaymentProvider,
 *   } from "@/domains/payment";
 */
export * from "../../services/paymentService.js";
export { getActivePaymentProvider } from "../../services/payment/providerRegistry.js";
export { PaymentProviderPort } from "../../services/payment/ports/paymentProviderPort.js";
