/**
 * Payment domain barrel. See `app/domains/README.md`.
 *
 * The payment surface is the most domain-mature in the codebase: there is
 * already a provider-agnostic port, a provider registry, and a PhonePe
 * adapter (P3.1–P3.3). This barrel re-exports that surface as a single
 * import:
 *
 *   import { createPaymentOrderForOrderRef, getActivePaymentProvider } from "@/domains/payment";
 */
export * as paymentController from "./payment.controller.js";
export * from "./payment.service.js";
export * as paymentValidation from "./payment.validation.js";
export { default as paymentRoutes } from "./payment.routes.js";
