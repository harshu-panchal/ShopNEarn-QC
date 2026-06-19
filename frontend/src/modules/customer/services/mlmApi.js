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
  updateMembership: (data) => {
    invalidateCache("/customer/mlm/membership");
    return axiosInstance.put("/customer/mlm/membership", data);
  },
  uploadMedia: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return axiosInstance.post("/media/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
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

  // Customer-MLM-rebuild Phase 5 — Main dashboard one-shot payload.
  getDashboardOverview: () =>
    getWithDedupe("/customer/mlm/dashboard-overview", {}, { ttl: 5000 }),

  // Customer-MLM-rebuild Phase 5 — Genealogy section endpoints.
  getGenealogyTree: (params) =>
    getWithDedupe("/customer/mlm/genealogy/tree", params || {}, { ttl: 5000 }),
  getBinaryGenealogy: () =>
    getWithDedupe("/customer/mlm/genealogy/binary", {}, { ttl: 5000 }),
  getMatchingReport: (params) =>
    getWithDedupe("/customer/mlm/genealogy/matching-report", params, { ttl: 3000 }),
  getDirectSponsor: () =>
    getWithDedupe("/customer/mlm/genealogy/direct-sponsor", {}, { ttl: 30000 }),
  getTreeLayout: () =>
    getWithDedupe("/customer/mlm/genealogy/tree-layout", {}, { ttl: 1500 }),
  saveTreeLayout: (overrides) => {
    invalidateCache("/customer/mlm/genealogy/tree-layout");
    return axiosInstance.put("/customer/mlm/genealogy/tree-layout", {
      overrides,
    });
  },

  // Customer-MLM-rebuild Phase 5 — Payouts > Wallet History (new feed).
  getWalletHistory: (params) =>
    getWithDedupe("/customer/mlm/payouts/wallet-history", params, { ttl: 2000 }),

  /**
   * Genealogy redesign — places a brand-new member into a specific
   * empty L/R slot under a filled parent that sits in the caller's
   * downline (or is the caller themselves). Used by the
   * `GenealogyTreeCanvas` Add Member modal that opens when the
   * user taps a blue empty slot.
   *
   * Payload:
   *   { parentMembershipId, leg: "L"|"R", name, email, phone, password }
   *
   * The backend creates an `isVerified=true` Customer (OTP is
   * skipped — the actor vouches for the account) plus a
   * `MlmMembership` row with `status=REGISTERED_UNPAID`, and emails
   * the new member's login credentials + referral code.
   *
   * Invalidates tree-related caches so subsequent reads pick up
   * the new node without a hard refresh.
   */
  addMemberAtSlot: (payload) => {
    invalidateCache("/customer/mlm/genealogy/tree");
    invalidateCache("/customer/mlm/genealogy/binary");
    invalidateCache("/customer/mlm/dashboard-overview");
    invalidateCache("/customer/mlm/membership");
    return axiosInstance.post("/customer/mlm/genealogy/add-member", payload);
  },
  // Network section
  getLegTeam: (params) =>
    getWithDedupe("/customer/mlm/network/leg-team", params, { ttl: 2000 }),
  getLevelTeam: (params) =>
    getWithDedupe("/customer/mlm/network/level-team", params, { ttl: 2000 }),
};

export default mlmApi;
