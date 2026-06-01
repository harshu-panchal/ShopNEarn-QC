import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Award } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

/**
 * Admin Milestone Rules — Phase 4.
 *
 * CRUD on `MlmRewardMilestone`. Every milestone defines a (type,
 * threshold, plan) trigger and a (rewardType, rewardAmount, couponId)
 * payout. Evaluated by `mlmRewardService.evaluateMilestonesAfterCommission`
 * after every commission credit.
 */
const MILESTONE_TYPES = [
  { value: 'LIFETIME_EARNINGS', label: 'Lifetime Earnings (all)' },
  { value: 'LIFETIME_PLAN_A_EARNINGS', label: 'Lifetime Plan A Earnings' },
  { value: 'LIFETIME_PLAN_B_EARNINGS', label: 'Lifetime Plan B Earnings' },
  { value: 'DIRECT_REFERRALS_COUNT', label: 'Direct Referrals Count' },
  { value: 'TOTAL_DOWNLINE_COUNT', label: 'Total Downline Count' },
];
const REWARD_TYPES = [
  { value: 'SHOPPING_CREDIT', label: 'Shopping Credit (₹)' },
  { value: 'EARNING_CREDIT', label: 'Earning Credit (₹, pending bucket)' },
  { value: 'COUPON', label: 'Coupon Issuance (manual)' },
];

const blankRow = () => ({
  name: '',
  milestoneType: 'LIFETIME_EARNINGS',
  threshold: 1000,
  rewardType: 'SHOPPING_CREDIT',
  rewardAmount: 100,
  couponId: '',
  planRequired: 'ANY',
  active: true,
});

const MlmMilestoneRules = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [draft, setDraft] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminMlmApi.listMilestoneRules();
      setRows((res.data?.result ?? res.data?.data)?.items || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load milestones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!draft) return;
    setSaving('new');
    try {
      await adminMlmApi.createMilestoneRule(draft);
      toast.success('Milestone created');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Create failed');
    } finally {
      setSaving(null);
    }
  };

  const handleEdit = async (row, patch) => {
    setSaving(row._id);
    try {
      await adminMlmApi.updateMilestoneRule(row._id, patch);
      toast.success('Updated');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Update failed');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete milestone "${row.name || row.milestoneType}"?`)) return;
    setSaving(row._id);
    try {
      await adminMlmApi.deleteMilestoneRule(row._id);
      toast.success('Deleted');
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award size={20} className="text-amber-600" />
          <h1 className="text-2xl font-bold text-slate-900">Milestone Rules</h1>
        </div>
        {!draft && (
          <button
            onClick={() => setDraft(blankRow())}
            className="flex items-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase rounded-lg"
          >
            <Plus size={14} /> New Milestone
          </button>
        )}
      </div>

      <p className="text-sm text-slate-600">
        Milestones fire automatically after every commission credit. A
        member can be awarded each milestone only once (idempotent).
      </p>

      {draft && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase text-indigo-700">New Milestone</h3>
            <button onClick={() => setDraft(null)} className="text-slate-400 hover:text-slate-700">
              <X size={16} />
            </button>
          </div>
          <MilestoneForm row={draft} onChange={setDraft} />
          <button
            onClick={handleCreate}
            disabled={saving === 'new'}
            className="mt-3 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:bg-slate-300 flex items-center gap-1"
          >
            <Save size={14} /> {saving === 'new' ? 'Creating...' : 'Create Rule'}
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
            <tr>
              <th className="text-left px-3 py-2.5">Name</th>
              <th className="text-left px-3 py-2.5">Trigger</th>
              <th className="text-left px-3 py-2.5">Reward</th>
              <th className="text-left px-3 py-2.5">Plan</th>
              <th className="text-left px-3 py-2.5">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No milestones defined.</td></tr>
            ) : rows.map((row) => (
              <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2.5 font-semibold">{row.name || '—'}</td>
                <td className="px-3 py-2.5 text-xs">
                  {MILESTONE_TYPES.find((t) => t.value === row.milestoneType)?.label || row.milestoneType}
                  <br />
                  <code className="text-slate-500">≥ {Number(row.threshold).toLocaleString('en-IN')}</code>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {REWARD_TYPES.find((t) => t.value === row.rewardType)?.label || row.rewardType}
                  <br />
                  <code className="text-slate-500">₹{Number(row.rewardAmount || 0).toLocaleString('en-IN')}</code>
                </td>
                <td className="px-3 py-2.5">{row.planRequired || 'ANY'}</td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => handleEdit(row, { active: !row.active })}
                    disabled={saving === row._id}
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                      row.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {row.active ? 'Active' : 'Paused'}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => handleDelete(row)}
                    disabled={saving === row._id}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const MilestoneForm = ({ row, onChange }) => {
  const upd = (patch) => onChange({ ...row, ...patch });
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Field label="Name">
        <input
          type="text"
          value={row.name || ''}
          onChange={(e) => upd({ name: e.target.value })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Trigger Type">
        <select
          value={row.milestoneType}
          onChange={(e) => upd({ milestoneType: e.target.value })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        >
          {MILESTONE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="Threshold">
        <input
          type="number"
          value={row.threshold}
          onChange={(e) => upd({ threshold: Number(e.target.value) })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Reward Type">
        <select
          value={row.rewardType}
          onChange={(e) => upd({ rewardType: e.target.value })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        >
          {REWARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="Reward Amount (₹)">
        <input
          type="number"
          value={row.rewardAmount}
          onChange={(e) => upd({ rewardAmount: Number(e.target.value) })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Plan Required">
        <select
          value={row.planRequired || 'ANY'}
          onChange={(e) => upd({ planRequired: e.target.value })}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="ANY">Any plan</option>
          <option value="A">Plan A only</option>
          <option value="B">Plan B only</option>
        </select>
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

export default MlmMilestoneRules;
