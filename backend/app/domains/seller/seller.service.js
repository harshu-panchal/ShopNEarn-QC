/**
 * Aggregate barrel for seller-domain services.
 *
 * Includes verification (OTP-based signup), the stats/cache helpers that
 * back the seller dashboard, and the cache-fronted seller stats reader
 * extracted in P6.2.
 */
export * from "../../services/sellerVerificationService.js";
export * from "../../services/dashboardSummaryService.js";
export {
  getSellerStats as getSellerStatsCached,
  default as sellerStatsService,
} from "../../services/seller/sellerStatsService.js";
