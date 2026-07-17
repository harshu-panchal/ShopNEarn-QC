import React, { useCallback, useEffect, useState } from 'react';
import Card from '@shared/components/ui/Card';
import Button from '@shared/components/ui/Button';
import Badge from '@shared/components/ui/Badge';
import { useToast } from '@shared/components/ui/Toast';
import { adminRbacApi } from '../../services/api/rbacApi';
import PermissionGate from '../../rbac/PermissionGate';
import { Loader2, Plus, UserCog } from 'lucide-react';

const emptyCreate = {
  name: '',
  email: '',
  phone: '',
  password: '',
  roleId: '',
};

const AdminUserManagement = () => {
  const { showToast } = useToast();
  const [admins, setAdmins] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyCreate);
  const [assigningId, setAssigningId] = useState(null);
  const [assignRoleId, setAssignRoleId] = useState('');
  const [resetId, setResetId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [adminsRes, rolesRes] = await Promise.all([
        adminRbacApi.listAdmins(),
        adminRbacApi.listRoles(),
      ]);
      setAdmins(adminsRes.data?.result?.items || []);
      setRoles((rolesRes.data?.result?.items || []).filter((r) => r.isActive !== false));
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to load admins', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password || !form.roleId) {
      showToast('Name, email, password, and role are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminRbacApi.createAdmin({
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
        roleId: form.roleId,
      });
      showToast('Admin created', 'success');
      setShowCreate(false);
      setForm(emptyCreate);
      await load();
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to create admin', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async (adminId) => {
    if (!assignRoleId) {
      showToast('Select a role', 'error');
      return;
    }
    try {
      await adminRbacApi.assignAdminRole(adminId, assignRoleId);
      showToast('Role assigned. The admin must sign in again.', 'success');
      setAssigningId(null);
      setAssignRoleId('');
      await load();
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to assign role', 'error');
    }
  };

  const handleDeactivate = async (admin) => {
    if (!window.confirm(`Deactivate ${admin.email}?`)) return;
    try {
      await adminRbacApi.deactivateAdmin(admin._id);
      showToast('Admin deactivated', 'success');
      await load();
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to deactivate admin', 'error');
    }
  };

  const handleReactivate = async (admin) => {
    try {
      await adminRbacApi.updateAdmin(admin._id, { isActive: true });
      showToast('Admin reactivated', 'success');
      await load();
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to reactivate admin', 'error');
    }
  };

  const handleResetPassword = async (adminId) => {
    if (!resetPassword || resetPassword.length < 10) {
      showToast('Password must be at least 10 characters with upper, lower, and number', 'error');
      return;
    }
    try {
      await adminRbacApi.resetAdminPassword(adminId, resetPassword);
      showToast('Password reset. The admin must sign in again.', 'success');
      setResetId(null);
      setResetPassword('');
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to reset password', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="ds-h1 flex items-center gap-2">
            <UserCog className="h-7 w-7 text-primary" />
            Admin Users
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Create admin accounts and assign a single role to each user.
          </p>
        </div>
        <PermissionGate permission="rbac:create">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Admin
          </Button>
        </PermissionGate>
      </div>

      <Card className="overflow-hidden border-none shadow-xl ring-1 ring-slate-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="ds-table-header-cell">Admin</th>
                <th className="ds-table-header-cell">Role</th>
                <th className="ds-table-header-cell">Status</th>
                <th className="ds-table-header-cell">Last Login</th>
                <th className="ds-table-header-cell">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {admins.map((admin) => (
                <tr key={admin._id}>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900">{admin.name}</p>
                    <p className="text-xs text-slate-500">{admin.email}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    {admin.adminRole?.name || '—'}
                    {admin.isSuperAdmin && (
                      <Badge variant="info" className="ml-2">
                        Super
                      </Badge>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={admin.isActive ? 'success' : 'error'}>
                      {admin.isActive ? 'Active' : 'Disabled'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {admin.lastLogin
                      ? new Date(admin.lastLogin).toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-2 text-sm">
                      <PermissionGate permission="rbac:assign">
                        {assigningId === admin._id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              className="rounded-lg border border-slate-200 px-2 py-1"
                              value={assignRoleId}
                              onChange={(e) => setAssignRoleId(e.target.value)}
                            >
                              <option value="">Select role</option>
                              {roles.map((role) => (
                                <option key={role._id} value={role._id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="text-primary-600 font-medium"
                              onClick={() => handleAssign(admin._id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="text-slate-500"
                              onClick={() => {
                                setAssigningId(null);
                                setAssignRoleId('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-primary-600 font-medium text-left"
                            onClick={() => {
                              setAssigningId(admin._id);
                              setAssignRoleId(admin.roleId || admin.adminRole?._id || '');
                            }}
                          >
                            Change Role
                          </button>
                        )}
                      </PermissionGate>

                      <PermissionGate permission="rbac:update">
                        {resetId === admin._id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="password"
                              className="rounded-lg border border-slate-200 px-2 py-1"
                              placeholder="New password"
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="text-primary-600 font-medium"
                              onClick={() => handleResetPassword(admin._id)}
                            >
                              Reset
                            </button>
                            <button
                              type="button"
                              className="text-slate-500"
                              onClick={() => {
                                setResetId(null);
                                setResetPassword('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-amber-600 font-medium text-left"
                            onClick={() => setResetId(admin._id)}
                          >
                            Reset Password
                          </button>
                        )}

                        {admin.isActive ? (
                          <button
                            type="button"
                            className="text-rose-600 font-medium text-left"
                            onClick={() => handleDeactivate(admin)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-emerald-600 font-medium text-left"
                            onClick={() => handleReactivate(admin)}
                          >
                            Reactivate
                          </button>
                        )}
                      </PermissionGate>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showCreate && (
        <Card className="border-none shadow-xl ring-1 ring-slate-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Create Admin</h2>
            <button
              type="button"
              className="text-sm text-slate-500"
              onClick={() => setShowCreate(false)}
            >
              Close
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Phone (optional)
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.phone}
                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700 md:col-span-2">
              Role
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.roleId}
                onChange={(e) => setForm((prev) => ({ ...prev, roleId: e.target.value }))}
              >
                <option value="">Select role</option>
                {roles.map((role) => (
                  <option key={role._id} value={role._id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Admin
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

export default AdminUserManagement;
