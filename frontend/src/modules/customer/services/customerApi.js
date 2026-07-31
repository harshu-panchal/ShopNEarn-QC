import axiosInstance from "@core/api/axios";
import { getWithDedupe, invalidateCache } from "@core/api/dedupe";

export const customerApi = {
  sendLoginOtp: (data) => axiosInstance.post("/customer/send-login-otp", data),
  sendSignupOtp: (data) =>
    axiosInstance.post("/customer/send-signup-otp", data),
  verifyOtp: (data) => axiosInstance.post("/customer/verify-otp", data),
  // Public — preview a sponsor's display name from their referral
  // code. Returns { valid, sponsorName, referralCode, reason? }.
  // Used by the signup form to confirm the user is enrolling under
  // the right person before they request an OTP.
  lookupReferralCode: (code) =>
    axiosInstance.get("/customer/lookup-referral", { params: { code } }),
  // Customer-MLM-rebuild Phase 2: email-or-phone + password login.
  // Body: { identifier, password }
  loginWithPassword: (data) =>
    axiosInstance.post("/customer/login-password", data),
  sendForgotPasswordOtp: (data) =>
    axiosInstance.post("/customer/forgot-password/send-otp", data),
  verifyForgotPasswordOtp: (data) =>
    axiosInstance.post("/customer/forgot-password/verify-otp", data),
  resetForgotPassword: (data) =>
    axiosInstance.post("/customer/forgot-password/reset", data),
  getProfile: () => getWithDedupe("/customer/profile", {}, { ttl: 5000 }), // Short cache for profile
  updateProfile: (data) => axiosInstance.put("/customer/profile", data),
  // Phase 7 (PO-request): in-app credential reveal. Returns
  // { email, phone, password, hasStoredPassword }. Skips the dedupe
  // cache so the customer always sees the latest values immediately
  // after any change.
  getCredentials: () => axiosInstance.get("/customer/credentials"),
  // Phase 7 (PO-request): change-password.
  // Body: { currentPassword, newPassword }
  changePassword: (data) =>
    axiosInstance.post("/customer/change-password", data),
  getWalletTransactions: (params) =>
    getWithDedupe("/customer/transactions", params),
  getCategories: (params) =>
    getWithDedupe("/categories", params, { ttl: 60 * 1000 }), // 1 min for categories
  getProducts: (params, options) => getWithDedupe("/products", params, options),
  getProductById: (id, params) => getWithDedupe(`/products/${id}`, params),

  // Sellers & Location
  getNearbySellers: (params) => getWithDedupe("/seller/nearby", params),

  // Cart
  getCart: () => getWithDedupe("/cart", {}, { ttl: 2000 }), // Very short cache for cart
  addToCart: (data) => {
    invalidateCache("/cart"); // Invalidate cart cache
    return axiosInstance.post("/cart/add", data);
  },
  updateCartQuantity: (data) => {
    invalidateCache("/cart");
    return axiosInstance.put("/cart/update", data);
  },
  removeFromCart: (productId, variantSku = "") => {
    invalidateCache("/cart");
    const params = {};
    const normalizedVariantSku = String(variantSku || "").trim();
    if (normalizedVariantSku) params.variantSku = normalizedVariantSku;
    return axiosInstance.delete(`/cart/remove/${productId}`, { params });
  },
  clearCart: () => {
    invalidateCache("/cart");
    return axiosInstance.delete("/cart/clear");
  },

  // Wishlist
  getWishlist: (params) => getWithDedupe("/wishlist", params, { ttl: 5000 }),
  addToWishlist: (data) => {
    invalidateCache("/wishlist");
    return axiosInstance.post("/wishlist/add", data);
  },
  toggleWishlist: (data) => {
    invalidateCache("/wishlist");
    return axiosInstance.post("/wishlist/toggle", data);
  },
  removeFromWishlist: (productId) => {
    invalidateCache("/wishlist");
    return axiosInstance.delete(`/wishlist/remove/${productId}`);
  },

  // Orders
  // Explicit timeout so checkout never waits forever if the server blocks (e.g. Redis/Bull).
  checkoutPreview: (data) =>
    axiosInstance.post("/orders/checkout/preview", data, { timeout: 120000 }),
  createOrder: (data) =>
    axiosInstance.post("/orders", data, { timeout: 120000 }),
  verifyOnlineOrderPayment: (orderId, data) =>
    axiosInstance.post(`/orders/${orderId}/payment/verify-online`, data),
  markOrderDelivered: (orderId, data) =>
    axiosInstance.post(`/orders/${orderId}/delivered`, data || {}),
  markOrderCodCollected: (orderId, data) =>
    axiosInstance.post(`/orders/${orderId}/cod/mark-collected`, data || {}),
  reconcileOrderCod: (orderId, data) =>
    axiosInstance.post(`/orders/${orderId}/cod/reconcile`, data),
  placeOrder: (data) =>
    axiosInstance.post("/orders/place", data, { timeout: 120000 }),
  getMyOrders: () => getWithDedupe("/orders/my-orders"),
  getPurchaseReports: (params) =>
    axiosInstance.get("/orders/purchase-reports", { params }),
  exportPurchaseReports: (params) =>
    axiosInstance.get("/orders/purchase-reports/export", {
      params,
      responseType: "blob",
    }),
  /**
   * Order details must reflect live workflow, but we still dedupe in-flight requests to avoid
   * network spam when multiple effects/events trigger refresh simultaneously.
   * ttl=0 means "no caching" (only in-flight dedupe).
   */
  getOrderDetails: (orderId) =>
    getWithDedupe(
      `/orders/details/${encodeURIComponent(String(orderId ?? "").trim())}`,
      {},
      { ttl: 0 },
    ),
  getOrderRoute: (orderId, params) =>
    axiosInstance.get(`/orders/workflow/${orderId}/route`, { params }),
  cancelOrder: (orderId, data) =>
    axiosInstance.put(`/orders/cancel/${orderId}`, data),
  requestReturn: (orderId, data) =>
    axiosInstance.post(`/orders/${orderId}/returns`, data),
  getReturnDetails: (orderId) =>
    axiosInstance.get(`/orders/${encodeURIComponent(String(orderId ?? "").trim())}/returns`),

  // Payments
  createPaymentOrder: (data) =>
    axiosInstance.post("/payments/create-order", data),
  verifyPaymentStatus: (id) => axiosInstance.get(`/payments/status/${id}`),
  verifyPaymentCallback: (data) =>
    axiosInstance.post("/payments/verify-callback", data),

  // Support & Reviews
  getProductReviews: (productId) =>
    getWithDedupe(`/reviews/product/${productId}`),
  submitReview: (data) => axiosInstance.post("/reviews/submit", data),
  createTicket: (data) => axiosInstance.post("/tickets/create", data),
  getMyTickets: () => getWithDedupe("/tickets/my-tickets"),
  replyTicket: (ticketId, text, options = {}) => {
    const {
      mediaUrl = "",
      mediaType = "",
      mimeType = "",
    } = options || {};

    return axiosInstance.post(`/tickets/reply/${encodeURIComponent(String(ticketId))}`, {
      text,
      isAdmin: false,
      mediaUrl,
      mediaType,
      mimeType,
    });
  },

  // Hero config (separate hero banners + categories per page; fallback to home)
  getHeroConfig: (params) =>
    getWithDedupe("/experience/hero", params, { ttl: 60 * 1000 }),

  // Public offers
  getOffers: () => getWithDedupe("/offers"),
  // Offer sections (category → products, banner + side image)
  getOfferSections: (params) => getWithDedupe("/offer-sections", params),

  // Coupons
  validateCoupon: (data) => axiosInstance.post("/coupons/validate", data),
  getActiveCoupons: () => getWithDedupe("/coupons", { status: "active" }),

  // Maps (server-side geocoding)
  geocodeAddress: (address, params = {}) =>
    axiosInstance.get("/maps/geocode", { params: { address, ...params } }),
  geocodePlaceId: (placeId, params = {}) =>
    axiosInstance.get("/maps/geocode", { params: { placeId, ...params } }),

  // Push (FCM) test
  testPushNotification: () => axiosInstance.post("/push/test"),
  getTestPushNotificationStatus: (orderId) =>
    axiosInstance.get(`/push/test-status/${encodeURIComponent(String(orderId || "").trim())}`),

  // In-app notifications (franchise partner + customer)
  getNotifications: () => axiosInstance.get("/notifications"),
  markNotificationRead: (id) => axiosInstance.put(`/notifications/${id}/read`),
  markAllNotificationsRead: () => axiosInstance.put("/notifications/mark-all-read"),
};
