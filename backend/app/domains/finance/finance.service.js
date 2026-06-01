/**
 * Aggregate barrel for finance-domain services.
 *
 * The finance module is the most mature in the codebase — it has been
 * domain-scoped under `app/services/finance/` since well before Phase 5.
 * This barrel re-exports the public surface for domain consumers:
 *
 *   import {
 *     creditWallet,
 *     processPayout,
 *     freezeFinancialSnapshot,
 *     generateOrderPaymentBreakdown,
 *   } from "@/domains/finance";
 */
export * from "../../services/finance/walletService.js";
export * from "../../services/finance/payoutService.js";
export * from "../../services/finance/orderFinanceService.js";
export * from "../../services/finance/pricingService.js";
export * from "../../services/finance/ledgerService.js";
export * from "../../services/finance/auditLogService.js";
export * from "../../services/finance/financeSettingsService.js";
export * from "../../services/finance/statementService.js";
