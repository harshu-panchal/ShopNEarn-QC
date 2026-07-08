import axiosInstance from "@core/api/axios";

export const inventoryReportsApi = {
  getOverview: (params) => axiosInstance.get("/admin/inventory-reports/overview", { params }),
  getHub: (params) => axiosInstance.get("/admin/inventory-reports/hub", { params }),
  getSellers: (params) => axiosInstance.get("/admin/inventory-reports/sellers", { params }),
  getFranchise: (params) => axiosInstance.get("/admin/inventory-reports/franchise", { params }),
  getB2bPurchases: (params) =>
    axiosInstance.get("/admin/inventory-reports/b2b-purchases", { params }),
  getCustomerRetail: (params) =>
    axiosInstance.get("/admin/inventory-reports/customer-retail", { params }),
  getCustomers: (params) => axiosInstance.get("/admin/inventory-reports/customer", { params }),
  getReconciliation: (params) =>
    axiosInstance.get("/admin/inventory-reports/transfers/reconciliation", { params }),
  export: (params) =>
    axiosInstance.get("/admin/inventory-reports/export", {
      params,
      responseType: "blob",
    }),
};

export default inventoryReportsApi;
