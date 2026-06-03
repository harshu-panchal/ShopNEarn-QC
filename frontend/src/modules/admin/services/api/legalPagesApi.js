import axiosInstance from '@core/api/axios';

/**
 * Admin endpoints for managing legal / informational page content
 * surfaced inside the customer, seller, and delivery apps.
 */
export const adminLegalPagesApi = {
    listLegalPages: (params) =>
        axiosInstance.get('/admin/legal-pages', { params }),
    getLegalPage: (id) => axiosInstance.get(`/admin/legal-pages/${id}`),
    createLegalPage: (data) =>
        axiosInstance.post('/admin/legal-pages', data),
    updateLegalPage: (id, data) =>
        axiosInstance.put(`/admin/legal-pages/${id}`, data),
    deleteLegalPage: (id) =>
        axiosInstance.delete(`/admin/legal-pages/${id}`),
    seedDefaultLegalPages: (app) =>
        axiosInstance.post('/admin/legal-pages/seed-defaults', { app }),
};

export default adminLegalPagesApi;
