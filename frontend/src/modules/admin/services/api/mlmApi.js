import axiosInstance from '@core/api/axios';

/**
 * Admin MLM endpoints (members, withdrawals, settings, dashboard,
 * manual wallet adjustments).
 *
 * Phase 4 extends with milestone CRUD; Phase 5 with the verifier
 * + compensation tool detail endpoints.
 */
export const adminMlmApi = {
    getDashboard: () => axiosInstance.get('/admin/mlm/dashboard'),
    listMembers: (params) => axiosInstance.get('/admin/mlm/members', { params }),
    getMember: (id) => axiosInstance.get(`/admin/mlm/members/${id}`),
    getMemberDownline: (id, params) =>
        axiosInstance.get(`/admin/mlm/members/${id}/downline`, { params }),
    adjustMemberWallet: (id, data) =>
        axiosInstance.post(`/admin/mlm/members/${id}/adjust-wallet`, data),

    listWithdrawals: (params) =>
        axiosInstance.get('/admin/mlm/withdrawals', { params }),
    approveWithdrawal: (id, data) =>
        axiosInstance.post(`/admin/mlm/withdrawals/${id}/approve`, data || {}),
    rejectWithdrawal: (id, data) =>
        axiosInstance.post(`/admin/mlm/withdrawals/${id}/reject`, data || {}),

    // Renamed from getSettings/updateSettings to avoid a name collision
    // with adminSettingsApi inside the aggregate `adminApi` (the MLM slice
    // was spread last and was silently overriding the platform-settings
    // methods, causing every AdminSettings save to hit the MLM endpoint).
    getMlmSettings: () => axiosInstance.get('/admin/mlm/settings'),
    updateMlmSettings: (data) => axiosInstance.put('/admin/mlm/settings', data),

    listMilestoneRules: () => axiosInstance.get('/admin/mlm/milestone-rules'),
    createMilestoneRule: (data) => axiosInstance.post('/admin/mlm/milestone-rules', data),
    updateMilestoneRule: (id, data) => axiosInstance.put(`/admin/mlm/milestone-rules/${id}`, data),
    deleteMilestoneRule: (id) => axiosInstance.delete(`/admin/mlm/milestone-rules/${id}`),

    verifyMemberWallet: (id) => axiosInstance.get(`/admin/mlm/members/${id}/wallet-verification`),
};

export default adminMlmApi;
