import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, TrendingUp, ArrowDownLeft } from 'lucide-react';
import { toast } from 'sonner';
import { mlmApi } from '../../services/mlmApi';
import MemberJoinedSubtitle from "@shared/components/mlm/MemberJoinedSubtitle";

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDate = (d) => new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const bonusTypeLabel = (t) => {
    const map = {
        // Legacy direct-referral milestone (no longer credited; kept so
        // historical rows render with a friendly name).
        DIRECT_REFERRAL_MILESTONE: 'Matching Income',
        // Plan A binary pair-match bonus — current Plan A payout.
        BINARY_PAIR_MATCH: 'Pair Match Bonus',
        // First direct L+R pair payout is shown under pair-match.
        DIRECT_REFERRAL_ACTIVATION: 'Pair Match Bonus',
        DIRECT_REFERRAL_PER_ACTIVATION: 'Direct Referral Activation Income',
        REPURCHASE_BONUS: 'Repurchase Bonus',
        MENTOR_ROYALTY: 'Mentor Royalty',
        HOME_SHOPPING_SALES: 'Home Shopping Sales',
        HOME_SHOPPING_REFERRAL: 'Home Shopping Referral',
        HOME_SHOPPING_ROYALTY: 'Home Shopping Royalty',
        GIFT_VOUCHER_MILESTONE: 'Gift Voucher',
        MANUAL_ADJUSTMENT: 'Manual Adjustment',
    };
    return map[t] || t;
};

const getEarningReason = (row) => {
    const meta = row?.meta || {};
    const type = row?.bonusType;

    if (type === 'DIRECT_REFERRAL_ACTIVATION') {
        const left = Number(meta.leftDirectCount || 0);
        const right = Number(meta.rightDirectCount || 0);
        const directCount = Number(meta.directCount || 0);
        const pairIncome = Number(meta.pairIncome || row?.cappedAmount || 0);
        return `Reason: first direct L+R pair complete (L${left}:R${right}); ${directCount} active directs tier => ${formatINR(pairIncome)}.`;
    }

    if (type === 'BINARY_PAIR_MATCH') {
        const pairIndex = Number(meta.pairIndex || 0);
        const directCount = Number(meta.directCount || 0);
        const pairIncome = Number(meta.pairIncome || row?.cappedAmount || 0);
        return `Reason: team pair #${pairIndex || '?'} matched; ${directCount} active directs tier => ${formatINR(pairIncome)} per pair.`;
    }

    if (type === 'DIRECT_REFERRAL_PER_ACTIVATION') {
        return 'Reason: one direct referral activated Plan A.';
    }

    return null;
};

const MlmEarningsPage = () => {
    const navigate = useNavigate();
    const [summary, setSummary] = useState(null);
    const [history, setHistory] = useState({ items: [], page: 1, totalPages: 1 });
    const [filter, setFilter] = useState('');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const params = { page, limit: 20 };
                if (filter) params.bonusType = filter;
                const [s, h] = await Promise.all([
                    mlmApi.getEarningsSummary(),
                    mlmApi.getEarningsHistory(params),
                ]);
                if (mounted) {
                    setSummary(s.data?.result ?? s.data?.data);
                    setHistory(h.data?.result ?? h.data?.data);
                }
            } catch (err) {
                toast.error(err?.response?.data?.message || 'Failed to load earnings');
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [page, filter]);

    return (
        <div className="min-h-screen bg-slate-50 pb-24">
            <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Earnings</h1>
            </div>

            <div className="max-w-2xl mx-auto px-4 space-y-4">
                {summary && (
                    <div className="bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-2xl p-5">
                        <p className="text-xs font-bold uppercase tracking-widest opacity-80">Lifetime Earnings</p>
                        <h2 className="text-3xl font-black mt-1">{formatINR(summary.lifetimeEarnings)}</h2>
                        <div className="grid grid-cols-2 gap-3 mt-4">
                            <div className="bg-white/10 rounded-xl px-3 py-2">
                                <p className="text-[10px] opacity-80 uppercase font-bold">Plan A</p>
                                <p className="text-sm font-black">{formatINR(summary.lifetimePlanAEarnings)}</p>
                            </div>
                            <div className="bg-white/10 rounded-xl px-3 py-2">
                                <p className="text-[10px] opacity-80 uppercase font-bold">Plan B</p>
                                <p className="text-sm font-black">{formatINR(summary.lifetimePlanBEarnings)}</p>
                            </div>
                        </div>
                        {summary.dailyCapTracker?.usedAmount > 0 && (
                            <p className="text-[11px] opacity-80 mt-3">
                                Today: {formatINR(summary.dailyCapTracker.usedAmount)} of daily cap used
                            </p>
                        )}
                    </div>
                )}

                {/* By-type breakdown */}
                {summary?.byType?.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-4">
                        <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                            <TrendingUp size={16} /> By Bonus Type
                        </h3>
                        <div className="space-y-2">
                            {summary.byType.map((row) => (
                                <div key={row.bonusType} className="flex items-center justify-between text-sm">
                                    <span className="text-slate-700">{bonusTypeLabel(row.bonusType)}</span>
                                    <span className="font-bold text-slate-900">
                                        {formatINR(row.total)}
                                        <span className="text-xs font-normal text-slate-500 ml-1">({row.count})</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Filter */}
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {['', 'DIRECT_REFERRAL_MILESTONE', 'BINARY_PAIR_MATCH', 'REPURCHASE_BONUS', 'MENTOR_ROYALTY'].map((t) => (
                        <button
                            key={t || 'all'}
                            onClick={() => { setFilter(t); setPage(1); }}
                            className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                                filter === t ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700'
                            }`}
                        >
                            {t ? bonusTypeLabel(t) : 'All'}
                        </button>
                    ))}
                </div>

                {/* History */}
                <div className="bg-white rounded-2xl border border-slate-200">
                    <div className="px-5 py-4 border-b border-slate-100">
                        <h3 className="text-base font-bold text-slate-900">History</h3>
                    </div>
                    {loading ? (
                        <div className="px-5 py-10 text-center text-sm text-slate-500">Loading...</div>
                    ) : history.items.length === 0 ? (
                        <div className="px-5 py-10 text-center text-sm text-slate-500">
                            No earnings yet. Start referring friends to earn your first bonus.
                        </div>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {history.items.map((row) => (
                                <li key={row._id} className="px-5 py-3 flex items-center justify-between">
                                    <div className="flex items-start gap-3">
                                        <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                            <ArrowDownLeft size={18} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900">
                                                {bonusTypeLabel(row.bonusType)}
                                                {row.level ? <span className="text-xs text-slate-500 ml-1">L{row.level}</span> : null}
                                            </p>
                                            <p className="text-[11px] text-slate-500">{formatDate(row.earnedAt || row.createdAt)}</p>
                                            {row.sourceUserId?.joinedAt && (
                                                <MemberJoinedSubtitle
                                                    joinedAt={row.sourceUserId.joinedAt}
                                                    className="text-[10px] text-slate-500"
                                                />
                                            )}
                                            {row.sourceUserId?.planAJoinedAt && (
                                                <p className="text-[10px] text-slate-500">
                                                    Plan A activated on {formatDate(row.sourceUserId.planAJoinedAt)}
                                                </p>
                                            )}
                                            {getEarningReason(row) && (
                                                <p className="text-[11px] text-slate-500 mt-0.5">
                                                    {getEarningReason(row)}
                                                </p>
                                            )}
                                            {row.status === 'capped_rollover' && (
                                                <p className="text-[10px] text-amber-600 font-semibold mt-0.5">
                                                    Rolled over: {formatINR(row.rolloverAmount)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-emerald-700">+ {formatINR(row.cappedAmount)}</p>
                                        {row.cappedAmount < row.bonusAmount && (
                                            <p className="text-[10px] text-slate-400">of {formatINR(row.bonusAmount)}</p>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {history.totalPages > 1 && (
                        <div className="px-5 py-3 flex items-center justify-between border-t border-slate-100 text-xs">
                            <button
                                disabled={page <= 1}
                                onClick={() => setPage(page - 1)}
                                className="font-bold text-slate-700 disabled:opacity-40"
                            >
                                Previous
                            </button>
                            <span className="text-slate-500">{page} / {history.totalPages}</span>
                            <button
                                disabled={page >= history.totalPages}
                                onClick={() => setPage(page + 1)}
                                className="font-bold text-slate-700 disabled:opacity-40"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MlmEarningsPage;
