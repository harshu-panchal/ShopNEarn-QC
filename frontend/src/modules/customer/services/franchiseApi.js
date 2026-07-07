import axiosInstance from "@core/api/axios";

export const franchiseApi = {
  getMe: () => axiosInstance.get("/customer/franchise/me"),
  initiateRegistration: (data) =>
    axiosInstance.post("/customer/franchise/register/initiate", data || {}),
  submitRegistrationProof: (data) =>
    axiosInstance.post("/customer/franchise/register/submit-proof", data),
  getRegistrationPayment: (paymentId) =>
    axiosInstance.get(`/customer/franchise/register/payment/${paymentId}`),
  getCatalog: (params) => axiosInstance.get("/customer/franchise/catalog", { params }),
  requestTopUp: (data) => axiosInstance.post("/customer/franchise/wallet/topup", data),
  submitTopUpProof: (data) => axiosInstance.post("/customer/franchise/wallet/submit-proof", data),
  listTopUps: () => axiosInstance.get("/customer/franchise/wallet/topups"),
  listTransactions: (params) =>
    axiosInstance.get("/customer/franchise/wallet/transactions", { params }),
  purchaseStock: (data) => axiosInstance.post("/customer/franchise/stock/purchase", data),
  getStock: () => axiosInstance.get("/customer/franchise/stock"),
  getInventorySummary: () => axiosInstance.get("/customer/franchise/inventory/summary"),
  getInventoryMovements: (params) =>
    axiosInstance.get("/customer/franchise/inventory/movements", { params }),
  adjustInventory: (data) => axiosInstance.post("/customer/franchise/inventory/adjust", data),
  listOrders: (params) => axiosInstance.get("/customer/franchise/orders", { params }),
  acceptOrder: (orderId) => axiosInstance.patch(`/customer/franchise/orders/${orderId}/accept`),
  rejectOrder: (orderId, data) =>
    axiosInstance.patch(`/customer/franchise/orders/${orderId}/reject`, data || {}),
  fulfillOrder: (orderId) => axiosInstance.patch(`/customer/franchise/orders/${orderId}/fulfill`),
  createShipment: (orderId, data) =>
    axiosInstance.post(`/customer/franchise/orders/${orderId}/shipment`, data || {}),
};

export const adminFranchiseApi = {
  getDashboard: () => axiosInstance.get("/admin/franchise/dashboard"),
  getSettings: () => axiosInstance.get("/admin/franchise/settings"),
  updateSettings: (data) => axiosInstance.put("/admin/franchise/settings", data),
  markHubSeller: (sellerId) => axiosInstance.post(`/admin/franchise/hub-seller/${sellerId}`),
  issueHubImpersonationToken: () =>
    axiosInstance.post("/admin/franchise/hub-seller/impersonation-token"),
  listRegistrations: (params) => axiosInstance.get("/admin/franchise/registrations", { params }),
  approveRegistration: (id, data) =>
    axiosInstance.post(`/admin/franchise/registrations/${id}/approve`, data || {}),
  rejectRegistration: (id, data) =>
    axiosInstance.post(`/admin/franchise/registrations/${id}/reject`, data || {}),
  listTopUps: (params) => axiosInstance.get("/admin/franchise/topups", { params }),
  approveTopUp: (id, data) => axiosInstance.post(`/admin/franchise/topups/${id}/approve`, data || {}),
  rejectTopUp: (id, data) => axiosInstance.post(`/admin/franchise/topups/${id}/reject`, data || {}),
  listPartners: (params) => axiosInstance.get("/admin/franchise/partners", { params }),
  getPartner: (id) => axiosInstance.get(`/admin/franchise/partners/${id}`),
  patchTerritory: (id, data) => axiosInstance.patch(`/admin/franchise/partners/${id}/territory`, data),
  adjustWallet: (id, data) => axiosInstance.post(`/admin/franchise/partners/${id}/adjust-wallet`, data),
  listDispatchOrders: (params) => axiosInstance.get("/admin/franchise/orders", { params }),
  assignOrderDelivery: (orderId, data) =>
    axiosInstance.post(`/admin/franchise/orders/${orderId}/assign-delivery`, data),
};

export default franchiseApi;
