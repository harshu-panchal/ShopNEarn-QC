import axiosInstance from '@core/api/axios';

/**
 * Admin RBAC management endpoints.
 */
export const adminRbacApi = {
  getPermissions: () => axiosInstance.get('/admin/rbac/permissions'),
  listRoles: () => axiosInstance.get('/admin/rbac/roles'),
  getRole: (id) => axiosInstance.get(`/admin/rbac/roles/${id}`),
  createRole: (data) => axiosInstance.post('/admin/rbac/roles', data),
  updateRole: (id, data) => axiosInstance.put(`/admin/rbac/roles/${id}`, data),
  deleteRole: (id) => axiosInstance.delete(`/admin/rbac/roles/${id}`),

  listAdmins: (params = {}) => axiosInstance.get('/admin/rbac/admins', { params }),
  createAdmin: (data) => axiosInstance.post('/admin/rbac/admins', data),
  updateAdmin: (id, data) => axiosInstance.put(`/admin/rbac/admins/${id}`, data),
  assignAdminRole: (id, roleId) =>
    axiosInstance.patch(`/admin/rbac/admins/${id}/role`, { roleId }),
  resetAdminPassword: (id, password) =>
    axiosInstance.patch(`/admin/rbac/admins/${id}/password`, { password }),
  deactivateAdmin: (id) => axiosInstance.patch(`/admin/rbac/admins/${id}/deactivate`),

  listAuditLogs: (params = {}) =>
    axiosInstance.get('/admin/rbac/audit-logs', { params }),
};

export default adminRbacApi;
