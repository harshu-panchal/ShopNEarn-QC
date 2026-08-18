import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Package, Pencil } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

/**
 * Admin Joining Plans — CRUD on `MlmJoiningPlan`.
 *
 * Generalizes the old single global `joiningPackagePrice` /
 * `joiningPackageShoppingWalletCredit` pair into a catalog of named
 * packages a new customer picks from at signup. Deliberately narrow:
 * a plan differs from another ONLY in price + shopping-wallet credit
 * (+ marketing copy) — it does not carry its own bonus-engine config.
 */
const blankRow = () => ({
  name: '',
  description: '',
  price: 2999,
  shoppingWalletCredit: 5000,
  sortOrder: 0,
  active: true,
});

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const MlmJoiningPlans = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminMlmApi.listJoiningPlans();
      setRows((res.data?.result ?? res.data?.data)?.items || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load joining plans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving('new');
    try {
      await adminMlmApi.createJoiningPlan(draft);
      toast.success('Joining plan created');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Create failed');
    } finally {
      setSaving(null);
    }
  };

  const handleSaveEdit = async (row) => {
    if (!editDraft) return;
    setSaving(row._id);
    try {
      await adminMlmApi.updateJoiningPlan(row._id, editDraft);
      toast.success('Updated');
      setEditingId(null);
      setEditDraft(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Update failed');
    } finally {
      setSaving(null);
    }
  };

  const handleToggleActive = async (row) => {
    setSaving(row._id);
    try {
      await adminMlmApi.updateJoiningPlan(row._id, { active: !row.active });
      toast.success(row.active ? 'Deactivated' : 'Activated');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Update failed');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete joining plan "${row.name}"?`)) return;
    setSaving(row._id);
    try {
      await adminMlmApi.deleteJoiningPlan(row._id);
      toast.success('Deleted');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    } finally {
      setSaving(null);
    }
  };

  const startEdit = (row) => {
    setEditingId(row._id);
    setEditDraft({
      name: row.name,
      description: row.description || '',
      price: row.price,
      shoppingWalletCredit: row.shoppingWalletCredit,
      sortOrder: row.sortOrder || 0,
    });
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-5xl">
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-indigo-600" />
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Joining Plans</h1>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft(blankRow())}
            className="flex items-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase rounded-lg"
          >
            <Plus size={14} /> New Plan
          </button>
        )}
      </div>

      <p className="text-sm text-slate-600">
        Packages a new customer can choose from at MLM signup. Every plan produces an
        identical Plan A membership — only price and shopping-wallet credit differ.
        At least one plan must stay active for signup to work.
      </p>

      {draft && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase text-indigo-700">New Joining Plan</h3>
            <button onClick={() => setDraft(null)} className="text-slate-400 hover:text-slate-700">
              <X size={16} />
            </button>
          </div>
          <PlanForm row={draft} onChange={setDraft} />
          <button
            onClick={handleCreate}
            disabled={saving === 'new'}
            className="mt-3 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:bg-slate-300 flex items-center gap-1"
          >
            <Save size={14} /> {saving === 'new' ? 'Creating...' : 'Create Plan'}
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
              <tr>
                <th className="text-left px-3 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">Price</th>
                <th className="text-left px-3 py-2.5">Shopping Credit</th>
                <th className="text-left px-3 py-2.5">Sort</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No joining plans defined yet.</td></tr>
              ) : rows.map((row) => (
                editingId === row._id ? (
                  <tr key={row._id} className="border-b border-slate-100 bg-indigo-50/30">
                    <td colSpan={6} className="px-3 py-3">
                      <PlanForm row={editDraft} onChange={setEditDraft} />
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => handleSaveEdit(row)}
                          disabled={saving === row._id}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:bg-slate-300 flex items-center gap-1"
                        >
                          <Save size={14} /> {saving === row._id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditDraft(null); }}
                          className="px-4 py-1.5 border border-slate-200 text-slate-600 text-xs font-bold rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-semibold">
                      {row.name || '—'}
                      {row.description && (
                        <p className="text-xs text-slate-500 font-normal mt-0.5">{row.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{formatINR(row.price)}</td>
                    <td className="px-3 py-2.5">{formatINR(row.shoppingWalletCredit)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{row.sortOrder || 0}</td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => handleToggleActive(row)}
                        disabled={saving === row._id}
                        className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                          row.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {row.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEdit(row)}
                          disabled={saving === row._id}
                          className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          disabled={saving === row._id}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const PlanForm = ({ row, onChange }) => {
  const upd = (patch) => onChange({ ...row, ...patch });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Field label="Name">
        <input
          type="text"
          value={row.name || ''}
          onChange={(e) => upd({ name: e.target.value })}
          placeholder="e.g. Starter"
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Price (₹)">
        <input
          type="number"
          min={0}
          value={row.price}
          onChange={(e) => upd({ price: Number(e.target.value) })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Shopping Wallet Credit (₹)">
        <input
          type="number"
          min={0}
          value={row.shoppingWalletCredit}
          onChange={(e) => upd({ shoppingWalletCredit: Number(e.target.value) })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Sort Order">
        <input
          type="number"
          value={row.sortOrder}
          onChange={(e) => upd({ sortOrder: Number(e.target.value) })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Description (shown to customer)">
        <input
          type="text"
          value={row.description || ''}
          onChange={(e) => upd({ description: e.target.value })}
          placeholder="Optional marketing copy"
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
    </div>
  );
};

const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-[10px] uppercase font-bold text-slate-600 block mb-0.5">{label}</span>
    {children}
  </label>
);

export default MlmJoiningPlans;
