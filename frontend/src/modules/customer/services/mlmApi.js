import axiosInstance from "@core/api/axios";
import { getWithDedupe, invalidateCache } from "@core/api/dedupe";

/**
 * Customer-side MLM API client.
 *
 * Backed by `/api/customer/mlm/*`. Read endpoints are dedupe-cached
 * with short TTLs so the dashboard can poll without spamming the
 * server; write endpoints invalidate the relevant cache keys.
 */
export const mlmApi = {
  getMembership: () => getWithDedupe("/customer/mlm/membership", {}, { ttl: 5000 }),
  getReferralCode: () => getWithDedupe("/customer/mlm/referral-code", {}, { ttl: 30000 }),
  getDirectReferrals: (params) => getWithDedupe("/customer/mlm/direct-referrals", params, { ttl: 5000 }),
  getUpline: (params) => getWithDedupe("/customer/mlm/upline", params, { ttl: 30000 }),
  getEarningsSummary: () => getWithDedupe("/customer/mlm/earnings-summary", {}, { ttl: 5000 }),
  getEarningsHistory: (params) => getWithDedupe("/customer/mlm/earnings-history", params, { ttl: 2000 }),

  requestWithdrawal: (data) => {
    invalidateCache("/customer/mlm/withdrawals");
    invalidateCache("/customer/mlm/membership");
    invalidateCache("/customer/mlm/earnings-summary");
    return axiosInstance.post("/customer/mlm/withdrawals", data);
  },
  listWithdrawals: (params) => getWithDedupe("/customer/mlm/withdrawals", params, { ttl: 2000 }),
  cancelWithdrawal: (id) => {
    invalidateCache("/customer/mlm/withdrawals");
    invalidateCache("/customer/mlm/membership");
    return axiosInstance.patch(`/customer/mlm/withdrawals/${id}/cancel`);
  },

  claimHomeShopping: () => {
    invalidateCache("/customer/mlm/membership");
    return axiosInstance.post("/customer/mlm/home-shopping/claim");
  },

  /**
   * One-click MLM joining. Server creates the joining-package order on
   * the customer's behalf and returns a payment-gateway redirect URL.
   * The caller is expected to redirect the browser to `result.redirectUrl`
   * so PhonePe handles the payment sheet. Activation fires through the
   * existing webhook chain on payment capture.
   *
   * Response shape:
   *   { orderId, publicOrderId, paymentId, redirectUrl, duplicate }
   */
  initiateJoin: () => {
    invalidateCache("/customer/mlm/membership");
    return axiosInstance.post("/customer/mlm/join/initiate");
  },
};

export default mlmApi;
