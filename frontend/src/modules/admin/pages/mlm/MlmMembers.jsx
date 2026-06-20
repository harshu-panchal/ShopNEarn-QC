import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminMlmApi } from '../../services/api/mlmApi';
import { formatMemberJoinedAt } from '@shared/utils/mlmMemberDisplay';
import MemberJoinedSubtitle from '@shared/components/mlm/MemberJoinedSubtitle';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Customer-MLM-rebuild Phase 10 — status filter values mirror the
// canonical MLM_MEMBERSHIP_STATUS enum so admins can isolate the new
// `registered_unpaid` bucket (members who signed up but haven't paid
// the joining fee yet) and operate on them in bulk.
const STATUS_FILTERS = [
    { value: '', label: 'All Statuses' },
    { value: 'active', label: 'Active' },
    { value: 'registered_unpaid', label: 'Registered (unpaid)' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'terminated', label: 'Terminated' },
];

const STATUS_BADGE = {
    active: 'bg-emerald-100 text-emerald-700',
    registered_unpaid: 'bg-amber-100 text-amber-700',
    suspended: 'bg-rose-100 text-rose-700',
    terminated: 'bg-slate-200 text-slate-700',
};

const STATUS_LABEL = {
    active: 'Active',
    registered_unpaid: 'Unpaid',
    suspended: 'Suspended',
    terminated: 'Terminated',
};

const LEG_BADGE = {
    L: 'bg-indigo-100 text-indigo-700',
    R: 'bg-emerald-100 text-emerald-700',
};

const MlmMembers = () => {
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [planType, setPlanType] = useState('');
    const [status, setStatus] = useState('');
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(false);
    // Per-row approval pending state so each Approve button shows
    // its own spinner and disables independently.
    const [approvingId, setApprovingId] = useState(null);

    const fetchMembers = async ({ signal } = {}) => {
        setLoading(true);
        try {
            const params = { page, limit: 25 };
            if (planType) params.planType = planType;
            if (status) params.status = status;
            if (q) params.q = q;
            const res = await adminMlmApi.listMembers(params);
            const data = res.data?.result ?? res.data?.data;
            if (signal?.aborted) return;
            setItems(data?.items || []);
            setTotalPages(data?.totalPages || 1);
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        fetchMembers({ signal: controller.signal });
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, planType, status, q]);

    const handleApprove = async (member) => {
        if (!member?._id) return;
        const memberName = member.userId?.name || 'this member';
        if (!window.confirm(`Approve ${memberName} for Plan A without payment? This will activate their membership immediately and release any held bonuses to their sponsor.`)) {
            return;
        }
        setApprovingId(member._id);
        try {
            const res = await adminMlmApi.approveMember(member._id);
            const result = res.data?.result ?? res.data?.data ?? {};
            if (result.skipped) {
                toast.info('Already active — no change made.');
            } else {
                const heldMsg = result.releasedHeldBonusCount > 0
                    ? ` ${result.releasedHeldBonusCount} held bonus${result.releasedHeldBonusCount === 1 ? '' : 'es'} released to sponsor.`
                    : '';
                toast.success(`${memberName} activated for Plan A.${heldMsg}`);
            }
            await fetchMembers();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to approve member');
        } finally {
            setApprovingId(null);
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">MLM Members</h1>
                <div className="flex gap-2 items-center flex-wrap w-full sm:w-auto">
                    <select
                        value={status}
                        onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                        className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm flex-1 sm:flex-initial min-w-0"
                    >
                        {STATUS_FILTERS.map((s) => (
                            <option key={s.value || 'all'} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                    <select
                        value={planType}
                        onChange={(e) => { setPlanType(e.target.value); setPage(1); }}
                        className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm flex-1 sm:flex-initial min-w-0"
                    >
                        <option value="">All Plans</option>
                        <option value="A">Plan A</option>
                        <option value="B">Plan B</option>
                    </select>
                    <div className="relative w-full sm:w-72">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={q}
                            onChange={(e) => { setQ(e.target.value); setPage(1); }}
                            placeholder="Search name, phone, email, code..."
                            className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-sm w-full"
                        />
                    </div>
                </div>
            </div>

            {/* Wide 11-column table is wrapped in an overflow-x-auto
                scroller so admins on tablets/phones can swipe sideways
                instead of having columns collide. */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                        <tr>
                            <th className="text-left px-4 py-3">Customer</th>
                            <th className="text-left px-4 py-3">Email</th>
                            <th className="text-left px-4 py-3">Code</th>
                            <th className="text-left px-4 py-3">Status</th>
                            <th className="text-left px-4 py-3">Leg</th>
                            <th className="text-left px-4 py-3">Sponsor</th>
                            <th className="text-right px-4 py-3">Directs</th>
                            <th className="text-right px-4 py-3">Lifetime</th>
                            <th className="text-left px-4 py-3">Joined</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">Loading...</td></tr>
                        ) : items.length === 0 ? (
                            <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500">No members match the current filters.</td></tr>
                        ) : items.map((m) => (
                            <tr key={m._id} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <p className="font-semibold text-slate-900">{m.userId?.name || 'Unknown'}</p>
                                    <p className="text-xs text-slate-500">{m.userId?.phone || '-'}</p>
                                    <MemberJoinedSubtitle joinedAt={m.joinedAt} className="text-[10px] text-slate-400 mt-0.5" />
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-600 truncate max-w-[180px]">
                                    {m.userId?.email || <span className="text-slate-400">—</span>}
                                </td>
                                <td className="px-4 py-3 font-mono font-bold text-xs">{m.referralCode}</td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${m.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                        {m.status === 'active' ? (m.planType === 'B' ? 'Plan B' : 'Plan A') : 'Member'}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    {m.position ? (
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${LEG_BADGE[m.position] || 'bg-slate-100 text-slate-600'}`}>
                                            {m.position === 'L' ? 'Left' : 'Right'}
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-slate-400">Root</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-xs">
                                    {m.sponsor ? (
                                        <>
                                            <p className="font-semibold text-slate-800 truncate max-w-[140px]">{m.sponsor.name || 'Unknown'}</p>
                                            <code className="text-[10px] text-slate-500">{m.sponsor.referralCode || '—'}</code>
                                            {m.sponsor.joinedAt && (
                                                <MemberJoinedSubtitle
                                                    joinedAt={m.sponsor.joinedAt}
                                                    className="text-[9px] text-slate-400"
                                                />
                                            )}
                                        </>
                                    ) : (
                                        <span className="text-slate-400">—</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold">{m.directReferralsCount || 0}</td>
                                <td className="px-4 py-3 text-right font-semibold">
                                    {formatINR((m.lifetimePlanAEarnings || 0) + (m.lifetimePlanBEarnings || 0))}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                                    {formatMemberJoinedAt(m.joinedAt)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <Link
                                            to={`/admin/mlm/members/${m._id}`}
                                            className="text-xs font-bold text-indigo-600 hover:underline"
                                        >
                                            View
                                        </Link>
                                        {m.status === 'registered_unpaid' && (
                                            <button
                                                type="button"
                                                onClick={() => handleApprove(m)}
                                                disabled={approvingId === m._id}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white transition-colors"
                                                title="Activate Plan A without payment"
                                            >
                                                {approvingId === m._id ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Check size={12} />
                                                )}
                                                {approvingId === m._id ? 'Approving' : 'Approve'}
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>
                {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs">
                        <button
                            disabled={page <= 1}
                            onClick={() => setPage(page - 1)}
                            className="font-bold text-slate-700 disabled:opacity-40"
                        >
                            Previous
                        </button>
                        <span className="text-slate-500">Page {page} of {totalPages}</span>
                        <button
                            disabled={page >= totalPages}
                            onClick={() => setPage(page + 1)}
                            className="font-bold text-slate-700 disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MlmMembers;
