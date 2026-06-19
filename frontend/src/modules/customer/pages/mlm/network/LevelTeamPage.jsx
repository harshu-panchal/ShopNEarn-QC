import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, ArrowLeft, ArrowRight, Filter } from 'lucide-react';
import { toast } from 'sonner';
import mlmApi from '../../../services/mlmApi';
import { useMlmDrawer } from '../MlmLayout';

const LevelTeamPage = () => {
    const navigate = useNavigate();
    const [team, setTeam] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState({ l1: 0, l2: 0, planA: 0, planB: 0, inactive: 0 });
    const [filter, setFilter] = useState('ALL');
    const [level, setLevel] = useState('ALL');
    const limit = 20;

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            try {
                const res = await mlmApi.getLevelTeam({ 
                    level: level !== 'ALL' ? level : undefined, 
                    page, 
                    limit,
                    filter: filter !== 'ALL' ? filter : undefined
                });
                const data = res.data?.result ?? res.data?.data ?? res.data;
                if (mounted) {
                    setTeam(data.items || []);
                    setTotalPages(data.totalPages || 1);
                    setTotal(data.totalMembers || 0);
                    setStats({
                        l1: data.l1Members || 0,
                        l2: data.l2Members || 0,
                        planA: data.activePlanA || 0,
                        planB: data.activePlanB || 0,
                        inactive: data.inactiveMembers || 0,
                    });
                }
            } catch (err) {
                toast.error(err?.response?.data?.message || 'Failed to load team');
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [page, level, filter]);

    const handleLevelChange = (e) => {
        setLevel(e.target.value);
        setPage(1); // Reset page on filter change
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
            <Header navigate={navigate} />
            <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-4 md:space-y-6">
                <div className="hidden md:flex items-end justify-between gap-4 pt-6 pb-4 border-b border-slate-200/80">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Level Team</h1>
                        <p className="text-sm text-slate-500 mt-1">View members in your sponsor network grouped by level.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter size={16} className="text-slate-400" />
                        <select
                            value={level || ''}
                            onChange={(e) => {
                                setLevel(e.target.value ? Number(e.target.value) : 'ALL');
                                setPage(1);
                            }}
                            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                            <option value="ALL">All Levels</option>
                            {[...Array(15)].map((_, i) => (
                                <option key={i + 1} value={i + 1}>Level {i + 1}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                    <button onClick={() => { setFilter('ALL'); setPage(1); }} className={`bg-white rounded-2xl border p-4 shadow-sm flex flex-col justify-center text-left transition-all ${filter === 'ALL' ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/10' : 'border-slate-200 hover:border-indigo-300'}`}>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Total Members</p>
                        <p className="text-2xl font-black text-slate-900">{loading ? '-' : total}</p>
                    </button>
                    <button onClick={() => { setFilter('L1'); setPage(1); }} className={`bg-white rounded-2xl border p-4 shadow-sm flex flex-col justify-center text-left transition-all ${filter === 'L1' ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/10' : 'border-slate-200 hover:border-indigo-300'}`}>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">L1 Members</p>
                        <p className="text-2xl font-black text-slate-900">{loading ? '-' : stats.l1}</p>
                    </button>
                    <button onClick={() => { setFilter('L2'); setPage(1); }} className={`bg-white rounded-2xl border p-4 shadow-sm flex flex-col justify-center text-left transition-all ${filter === 'L2' ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/10' : 'border-slate-200 hover:border-indigo-300'}`}>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">L2 Members</p>
                        <p className="text-2xl font-black text-slate-900">{loading ? '-' : stats.l2}</p>
                    </button>
                    <button onClick={() => { setFilter('planA'); setPage(1); }} className={`bg-emerald-50 rounded-2xl border p-4 shadow-sm flex flex-col justify-center text-left transition-all ${filter === 'planA' ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-100/50' : 'border-emerald-100 hover:border-emerald-300'}`}>
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">Active Plan A</p>
                        <p className="text-2xl font-black text-emerald-700">{loading ? '-' : stats.planA}</p>
                    </button>
                    <button onClick={() => { setFilter('planB'); setPage(1); }} className={`bg-indigo-50 rounded-2xl border p-4 shadow-sm flex flex-col justify-center text-left transition-all ${filter === 'planB' ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-100/50' : 'border-indigo-100 hover:border-indigo-300'}`}>
                        <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1">Active Plan B</p>
                        <p className="text-2xl font-black text-indigo-700">{loading ? '-' : stats.planB}</p>
                    </button>
                    <button onClick={() => { setFilter('inactive'); setPage(1); }} className={`bg-rose-50 rounded-2xl border p-4 shadow-sm flex flex-col justify-center text-left transition-all ${filter === 'inactive' ? 'border-rose-500 ring-1 ring-rose-500 bg-rose-100/50' : 'border-rose-100 hover:border-rose-300'}`}>
                        <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wider mb-1">Inactive</p>
                        <p className="text-2xl font-black text-rose-700">{loading ? '-' : stats.inactive}</p>
                    </button>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50/50">
                                    <th className="px-5 py-4 font-semibold text-slate-500 uppercase tracking-wider text-[11px]">Member</th>
                                    <th className="px-5 py-4 font-semibold text-slate-500 uppercase tracking-wider text-[11px]">Level</th>
                                    <th className="px-5 py-4 font-semibold text-slate-500 uppercase tracking-wider text-[11px]">Status</th>
                                    <th className="px-5 py-4 font-semibold text-slate-500 uppercase tracking-wider text-[11px] text-right">Joined</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="px-5 py-12 text-center text-slate-500">Loading team...</td>
                                    </tr>
                                ) : team.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-5 py-12 text-center text-slate-500">No members found at this level.</td>
                                    </tr>
                                ) : (
                                    team.map((row) => (
                                        <tr key={row.userId} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-5 py-4">
                                                <div className="font-semibold text-slate-900">{row.name || 'Unknown'}</div>
                                                <div className="text-xs text-slate-500 font-mono mt-0.5">{row.referralCode}</div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                                                    L{row.level}
                                                </div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {row.status === 'active' ? (row.planType === 'B' ? 'Plan B' : 'Plan A') : 'Member'}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-right text-slate-600">
                                                {row.joinedAt ? new Date(row.joinedAt).toLocaleDateString() : '—'}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {totalPages > 1 && (
                    <div className="flex items-center justify-between gap-4 mt-6">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm bg-white border border-slate-200 text-slate-700 disabled:opacity-50"
                        >
                            <ArrowLeft size={16} /> Prev
                        </button>
                        <span className="text-sm font-semibold text-slate-500">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm bg-white border border-slate-200 text-slate-700 disabled:opacity-50"
                        >
                            Next <ArrowRight size={16} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

function Header({ navigate }) {
    const { openDrawer } = useMlmDrawer();
    return (
        <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-2 border-b border-slate-200/60 flex items-center gap-3">
            <button
                onClick={openDrawer}
                className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-2"
                aria-label="Open navigation"
            >
                <Menu size={22} className="text-slate-800" />
            </button>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
                Level Team
            </h1>
        </div>
    );
}

export default LevelTeamPage;
