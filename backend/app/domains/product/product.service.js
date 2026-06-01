/**
 * Aggregate barrel for product-domain services.
 *
 * Product-specific services live alongside one another under
 * `app/services/` until a dedicated `app/services/product/` folder is created
 * (a future Phase 5 follow-up). This barrel lets domain consumers fetch them
 * via a single import:
 *
 *   import { enqueueProductIndex, getProductApprovalConfig } from "@/domains/product";
 */
export * from "../../services/searchSyncService.js";
export * from "../../services/productModerationService.js";
export * from "../../services/searchService.js";
