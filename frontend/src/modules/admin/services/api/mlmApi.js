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
    // Phase 7 (PO-request): admin-initiated "approve without payment".
    // Flips a REGISTERED_UNPAID member to ACTIVE / Plan A directly.
    // Optional body: { reason }. Idempotent on already-active rows.
    approveMember: (id, data) =>
        axiosInstance.post(`/admin/mlm/members/${id}/approve`, data || {}),

    /**
     * Genealogy redesign — admin places a brand-new member into a
     * specific empty L/R slot directly under the parent identified
     * by `parentMembershipId`. Mirrors the customer endpoint but
     * bypasses the downline-ownership check.
     *
     * Payload: { leg: "L"|"R", name, email, phone, password }
     */
    addChildMember: (parentMembershipId, data) =>
        axiosInstance.post(
            `/admin/mlm/members/${parentMembershipId}/add-child`,
            data,
        ),

    previewMoveBinary: (membershipId, data) =>
        axiosInstance.post(`/admin/mlm/members/${membershipId}/move-binary/preview`, data),

    moveBinary: (membershipId, data) =>
        axiosInstance.post(`/admin/mlm/members/${membershipId}/move-binary`, data),

    /**
     * Admin support tool (PO-request Jun 2026): mint a short-lived
     * customer JWT for the member identified by `membershipId`. The
     * admin frontend opens a new tab at `/auth/handoff#token=…` to
     * land pre-authenticated as the customer, sparing the support
     * team a manual ID + password copy-paste loop.
     *
     * Response: { token, expiresInSeconds, redirect, customer }
     * — see `issueImpersonationToken` in mlmAdminController for the
     * security model and audit-log handling.
     */
    issueImpersonationToken: (membershipId) =>
        axiosInstance.post(
            `/admin/mlm/members/${membershipId}/impersonation-token`,
        ),

    /**
     * Soft-delete a member. The backend tombstones the membership +
     * customer rows and restructures the binary tree (larger
     * subtree promoted into the vacant slot; the other child spills
     * down the same-leg chain; direct referrals re-parented to the
     * deleted member's sponsor). Optional body `{ reason }` is
     * surfaced into the auto-cancelled withdrawal receipts.
     */
    softDeleteMember: (membershipId, data) =>
        axiosInstance.post(
            `/admin/mlm/members/${membershipId}/soft-delete`,
            data || {},
        ),

    /**
     * Admin profile editor. Body can include any subset of
     * { userId, name, email, phone, password } — only provided
     * fields are updated. Uniqueness on userId/email/phone is
     * checked against ALL customers (including soft-deleted).
     */
    updateMemberProfile: (membershipId, data) =>
        axiosInstance.patch(
            `/admin/mlm/members/${membershipId}/profile`,
            data,
        ),

    /**
     * Flip an ACTIVE membership back to REGISTERED_UNPAID. Reverse
     * with the existing `approveMember` call. Optional body
     * `{ reason }` surfaced into the audit log.
     */
    deactivateMember: (membershipId, data) =>
        axiosInstance.post(
            `/admin/mlm/members/${membershipId}/deactivate`,
            data || {},
        ),

    listWithdrawals: (params) =>
        axiosInstance.get('/admin/mlm/withdrawals', { params }),
    approveWithdrawal: (id, data) =>
        axiosInstance.post(`/admin/mlm/withdrawals/${id}/approve`, data || {}),
    rejectWithdrawal: (id, data) =>
        axiosInstance.post(`/admin/mlm/withdrawals/${id}/reject`, data || {}),

    /* Manual-QR joining payment review queue */
    listJoiningReviews: (params) =>
        axiosInstance.get('/admin/mlm/joining-reviews', { params }),
    approveJoiningReview: (id, data) =>
        axiosInstance.post(
            `/admin/mlm/joining-reviews/${id}/approve`,
            data || {},
        ),
    rejectJoiningReview: (id, data) =>
        axiosInstance.post(
            `/admin/mlm/joining-reviews/${id}/reject`,
            data || {},
        ),

    // Renamed from getSettings/updateSettings to avoid a name collision
    // with adminSettingsApi inside the aggregate `adminApi` (the MLM slice
    // was spread last and was silently overriding the platform-settings
    // methods, causing every AdminSettings save to hit the MLM endpoint).
    getMlmSettings: () => axiosInstance.get('/admin/mlm/settings'),
    updateMlmSettings: (data) => axiosInstance.put('/admin/mlm/settings', data),

    listMaintenanceJobs: () => axiosInstance.get('/admin/mlm/maintenance/jobs'),
    runMaintenanceJob: (jobId, data) =>
        axiosInstance.post(`/admin/mlm/maintenance/jobs/${jobId}/run`, data, {
            timeout: 10 * 60 * 1000,
        }),

    listMilestoneRules: () => axiosInstance.get('/admin/mlm/milestone-rules'),
    createMilestoneRule: (data) => axiosInstance.post('/admin/mlm/milestone-rules', data),
    updateMilestoneRule: (id, data) => axiosInstance.put(`/admin/mlm/milestone-rules/${id}`, data),
    deleteMilestoneRule: (id) => axiosInstance.delete(`/admin/mlm/milestone-rules/${id}`),

    verifyMemberWallet: (id) => axiosInstance.get(`/admin/mlm/members/${id}/wallet-verification`),
};

export default adminMlmApi;
