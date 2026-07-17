import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Card from '@shared/components/ui/Card';
import Button from '@shared/components/ui/Button';
import Badge from '@shared/components/ui/Badge';
import { useToast } from '@shared/components/ui/Toast';
import { adminRbacApi } from '../../services/api/rbacApi';
import PermissionGate from '../../rbac/PermissionGate';
import { Loader2, Plus, Save, Shield, Trash2 } from 'lucide-react';

const emptyForm = {
  name: '',
  key: '',
  description: '',
  permissions: [],
  isActive: true,
};

const RoleManagement = () => {
  const { showToast } = useToast();
  const [roles, setRoles] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        adminRbacApi.listRoles(),
        adminRbacApi.getPermissions(),
      ]);
      setRoles(rolesRes.data?.result?.items || []);
      setGroups(permsRes.data?.result?.groups || []);
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to load roles', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedSet = useMemo(() => new Set(form.permissions || []), [form.permissions]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (role) => {
    setEditingId(role._id);
    setForm({
      name: role.name || '',
      key: role.key || '',
      description: role.description || '',
      permissions: [...(role.permissions || [])],
      isActive: role.isActive !== false,
    });
    setShowForm(true);
  };

  const togglePermission = (key) => {
    setForm((prev) => {
      const next = new Set(prev.permissions || []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, permissions: [...next] };
    });
  };

  const toggleGroup = (group) => {
    const keys = (group.permissions || []).map((p) => p.key);
    const allSelected = keys.every((key) => selectedSet.has(key));
    setForm((prev) => {
      const next = new Set(prev.permissions || []);
      keys.forEach((key) => {
        if (allSelected) next.delete(key);
        else next.add(key);
      });
      return { ...prev, permissions: [...next] };
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      showToast('Role name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await adminRbacApi.updateRole(editingId, {
          name: form.name,
          description: form.description,
          permissions: form.permissions,
          isActive: form.isActive,
        });
        showToast('Role updated', 'success');
      } else {
        await adminRbacApi.createRole({
          name: form.name,
          key: form.key || undefined,
          description: form.description,
          permissions: form.permissions,
          isActive: form.isActive,
        });
        showToast('Role created', 'success');
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to save role', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    if (role.isSystem) {
      showToast('System roles cannot be deleted', 'error');
      return;
    }
    if (!window.confirm(`Deactivate role "${role.name}"?`)) return;
    try {
      await adminRbacApi.deleteRole(role._id);
      showToast('Role deactivated', 'success');
      await load();
    } catch (error) {
      showToast(error?.response?.data?.message || 'Failed to delete role', 'error');
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
            <Shield className="h-7 w-7 text-primary" />
            Roles & Permissions
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Create custom admin roles and assign module/action permissions.
          </p>
        </div>
        <PermissionGate permission="rbac:create">
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Role
          </Button>
        </PermissionGate>
      </div>

      <Card className="overflow-hidden border-none shadow-xl ring-1 ring-slate-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="ds-table-header-cell">Role</th>
                <th className="ds-table-header-cell">Key</th>
                <th className="ds-table-header-cell">Permissions</th>
                <th className="ds-table-header-cell">Status</th>
                <th className="ds-table-header-cell">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roles.map((role) => (
                <tr key={role._id}>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900">{role.name}</p>
                    <p className="text-xs text-slate-500">{role.description || '—'}</p>
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-slate-600">{role.key}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {(role.permissions || []).length}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      {role.isSystem && <Badge variant="info">System</Badge>}
                      <Badge variant={role.isActive ? 'success' : 'error'}>
                        {role.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-3">
                      <PermissionGate permission="rbac:update">
                        <button
                          type="button"
                          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                          onClick={() => openEdit(role)}
                        >
                          Edit
                        </button>
                      </PermissionGate>
                      <PermissionGate permission="rbac:delete">
                        {!role.isSystem && (
                          <button
                            type="button"
                            className="text-rose-600 hover:text-rose-700 text-sm font-medium inline-flex items-center gap-1"
                            onClick={() => handleDelete(role)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Deactivate
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

      {showForm && (
        <Card className="border-none shadow-xl ring-1 ring-slate-100 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              {editingId ? 'Edit Role' : 'Create Role'}
            </h2>
            <button
              type="button"
              className="text-sm text-slate-500 hover:text-slate-800"
              onClick={() => setShowForm(false)}
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
              Key {editingId ? '(immutable)' : '(optional)'}
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                value={form.key}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))}
                placeholder="support_admin"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700 md:col-span-2">
              Description
              <textarea
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </label>
            {editingId && (
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, isActive: e.target.checked }))
                  }
                />
                Active
              </label>
            )}
          </div>

          <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
            {groups.map((group) => {
              const keys = (group.permissions || []).map((p) => p.key);
              const allSelected = keys.length > 0 && keys.every((key) => selectedSet.has(key));
              return (
                <div key={group.module} className="rounded-xl border border-slate-100 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 capitalize">{group.label}</h3>
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary"
                      onClick={() => toggleGroup(group)}
                    >
                      {allSelected ? 'Clear group' : 'Select group'}
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(group.permissions || []).map((perm) => (
                      <label
                        key={perm.key}
                        className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selectedSet.has(perm.key)}
                          onChange={() => togglePermission(perm.key)}
                        />
                        <span>
                          <span className="font-medium text-slate-800">{perm.label}</span>
                          <span className="block font-mono text-[11px] text-slate-400">
                            {perm.key}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Role
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

export default RoleManagement;
