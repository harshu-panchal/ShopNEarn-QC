import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const MlmMembers = () => {
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [planType, setPlanType] = useState('');
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            try {
                const params = { page, limit: 25 };
                if (planType) params.planType = planType;
                if (q) params.q = q;
                const res = await adminMlmApi.listMembers(params);
                const data = res.data?.result ?? res.data?.data;
                if (mounted) {
                    setItems(data?.items || []);
                    setTotalPages(data?.totalPages || 1);
                }
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [page, planType, q]);

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-900">MLM Members</h1>
                <div className="flex gap-2 items-center">
                    <select
                        value={planType}
                        onChange={(e) => { setPlanType(e.target.value); setPage(1); }}
                        className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                    >
                        <option value="">All Plans</option>
                        <option value="A">Plan A</option>
                        <option value="B">Plan B</option>
                    </select>
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={q}
                            onChange={(e) => { setQ(e.target.value); setPage(1); }}
                            placeholder="Search name, phone, code..."
                            className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-sm w-64"
                        />
                    </div>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                        <tr>
                            <th className="text-left px-4 py-3">Customer</th>
                            <th className="text-left px-4 py-3">Referral Code</th>
                            <th className="text-left px-4 py-3">Plan</th>
                            <th className="text-right px-4 py-3">Directs</th>
                            <th className="text-right px-4 py-3">Lifetime</th>
                            <th className="text-left px-4 py-3">Joined</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Loading...</td></tr>
                        ) : items.length === 0 ? (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No members yet.</td></tr>
                        ) : items.map((m) => (
                            <tr key={m._id} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <p className="font-semibold text-slate-900">{m.userId?.name || 'Unknown'}</p>
                                    <p className="text-xs text-slate-500">{m.userId?.phone || '-'}</p>
                                </td>
                                <td className="px-4 py-3 font-mono font-bold">{m.referralCode}</td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.planType === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                        Plan {m.planType}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right font-semibold">{m.directReferralsCount || 0}</td>
                                <td className="px-4 py-3 text-right font-semibold">
                                    {formatINR((m.lifetimePlanAEarnings || 0) + (m.lifetimePlanBEarnings || 0))}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-600">
                                    {new Date(m.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <Link to={`/admin/mlm/members/${m._id}`} className="text-xs font-bold text-indigo-600 hover:underline">View</Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
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
