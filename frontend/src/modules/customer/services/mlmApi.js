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
   * One-click MLM joining. Server creates the joining-package payment
   * row and returns a redirect target. The shape of the redirect
   * depends on `paymentMode`:
   *   - `phonepe`     -> redirectUrl is the gateway checkout page.
   *   - `manual_qr`   -> redirectUrl is the in-app
   *                       `/mlm/manual-payment/:paymentId` page.
   *
   * Response shape:
   *   { paymentId, merchantOrderId, redirectUrl, paymentMode,
   *     manualQr?: { imageUrl, upiId, merchantName, instructions },
   *     duplicate }
   */
  initiateJoin: () => {
    invalidateCache("/customer/mlm/membership");
    return axiosInstance.post("/customer/mlm/join/initiate");
  },

  /**
   * Manual-QR flow: read the latest known state of a joining payment.
   * Polled by `ManualPaymentPage` so it can transition between form
   * mode (CREATED), under-review card (PENDING_REVIEW), success card
   * (CAPTURED), and rejection card (FAILED) without a full reload.
   */
  getJoiningPayment: (paymentId) =>
    getWithDedupe(
      `/customer/mlm/join/payment/${paymentId}`,
      {},
      { ttl: 1500 },
    ),

  /**
   * Manual-QR flow: submit transaction id + screenshot URL after the
   * customer pays via UPI. Server transitions the row to
   * PENDING_REVIEW and notifies admins for review.
   */
  submitJoiningProof: (payload) => {
    invalidateCache("/customer/mlm/membership");
    invalidateCache("/customer/mlm/join/payment");
    return axiosInstance.post("/customer/mlm/join/submit-proof", payload);
  },
};

export default mlmApi;
