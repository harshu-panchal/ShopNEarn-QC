import axiosInstance from '@core/api/axios';

/**
 * Admin user, seller, and reports endpoints.
 * Per-domain split (P4.5).
 */
export const adminUsersApi = {
    getStats: () => axiosInstance.get('/admin/stats'),
    getReports: () => axiosInstance.get('/admin/reports'),

    getUsers: (params) => axiosInstance.get('/admin/users', { params }),
    getUserById: (id) => axiosInstance.get(`/admin/users/${id}`),

    getSellers: (params) => axiosInstance.get('/admin/sellers', { params }),
    getActiveSellers: (params) =>
        axiosInstance.get('/admin/sellers/active', { params }),
    getSellerLocations: (params) =>
        axiosInstance.get('/admin/sellers/locations', { params }),
    getPendingSellers: (params) =>
        axiosInstance.get('/admin/sellers/pending', { params }),
    approveSeller: (id) => axiosInstance.patch(`/admin/sellers/approve/${id}`),
    rejectSeller: (id, data) =>
        axiosInstance.delete(`/admin/sellers/reject/${id}`, { data }),
    issueSellerImpersonationToken: (sellerId) =>
        axiosInstance.post(`/admin/sellers/${sellerId}/impersonation-token`),

    /** Sidebar "new since last visit" badge counts. `since` is a key→ISO map. */
    getNavBadges: (sinceByKey = {}) =>
        axiosInstance.get('/admin/nav-badges', {
            params: { since: JSON.stringify(sinceByKey || {}) },
        }),
};

export default adminUsersApi;
