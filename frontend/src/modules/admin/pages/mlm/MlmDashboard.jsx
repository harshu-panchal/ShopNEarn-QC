import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Wallet, Send, AlertCircle, Award, TrendingUp, Clock, RotateCcw } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const MlmDashboard = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const res = await adminMlmApi.getDashboard();
                if (mounted) setData(res.data?.result ?? res.data?.data);
            } catch (err) {
                if (mounted) setError(err?.response?.data?.message || err.message);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, []);

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">MLM Program</h1>
                    <p className="text-sm text-slate-500 mt-1">Customer rewards & withdrawal queue</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Link
                        to="/admin/mlm/members"
                        className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                        Members
                    </Link>
                    <Link
                        to="/admin/mlm/withdrawals"
                        className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                        Withdrawals
                    </Link>
                    <Link
                        to="/admin/mlm/settings"
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                        Settings
                    </Link>
                </div>
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
                    <AlertCircle size={18} /> {error}
                </div>
            )}

            {loading ? (
                <div className="text-slate-500 text-sm">Loading...</div>
            ) : data ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <Kpi label="Total Members" value={data.totalMembers} icon={Users} color="bg-indigo-50 text-indigo-600" />
                        <Kpi label="Active Plan A" value={data.planACount} icon={Award} color="bg-violet-50 text-violet-600" />
                        <Kpi label="Active Plan B" value={data.planBCount} icon={Award} color="bg-amber-50 text-amber-600" />
                        <Kpi label="Lifetime Payouts" value={formatINR(data.totalLifetimePayouts)} icon={Wallet} color="bg-emerald-50 text-emerald-600" />
                        <Kpi label="Pending Withdrawals" value={data.pendingWithdrawals} icon={Send} color="bg-orange-50 text-orange-600" />
                        <Kpi label="Pending Amount" value={formatINR(data.pendingWithdrawalsAmount)} icon={Wallet} color="bg-rose-50 text-rose-600" />
                    </div>

                    {/* Today / Cap / Clawback strip — Phase 3 */}
                    {(data.today || data.capRollover || data.clawback) && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <Section title="Today" icon={TrendingUp} color="text-emerald-600 bg-emerald-50">
                                <Row label="Credited" value={formatINR(data.today?.creditedToday)} />
                                <Row label="Events" value={data.today?.creditedEventsToday || 0} />
                                <Row label="Cap Used (sum)" value={formatINR(data.today?.capUsedToday)} />
                                <Row label="Members Hitting Cap" value={data.today?.activeMembersHittingCap || 0} />
                            </Section>
                            <Section title="Daily-Cap Rollover" icon={Clock} color="text-amber-600 bg-amber-50">
                                <Row label="Pending Amount" value={formatINR(data.capRollover?.pendingAmount)} />
                                <Row label="Pending Events" value={data.capRollover?.pendingEvents || 0} />
                                <p className="text-[11px] text-slate-500 mt-2">
                                    Rolled over at IST midnight. Auto re-credited subject to next day's cap.
                                </p>
                            </Section>
                            <Section title="Return Clawback (30d)" icon={RotateCcw} color="text-rose-600 bg-rose-50">
                                <Row label="Total Reversed" value={formatINR(data.clawback?.last30Days)} />
                                <Row label="Events" value={data.clawback?.events || 0} />
                                <p className="text-[11px] text-slate-500 mt-2">
                                    Auto-triggered from order returns. Reconciled inside refund transaction.
                                </p>
                            </Section>
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
};

const Section = ({ title, icon: Icon, color, children }) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon size={16} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{title}</h3>
        </div>
        {children}
    </div>
);

const Row = ({ label, value }) => (
    <div className="flex items-center justify-between py-1 text-sm">
        <span className="text-slate-500">{label}</span>
        <span className="font-bold text-slate-900">{value}</span>
    </div>
);

const Kpi = ({ label, value, icon: Icon, color }) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
            <Icon size={20} className="sm:hidden" />
            <Icon size={22} className="hidden sm:block" />
        </div>
        <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-wide truncate">{label}</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 truncate">{value}</p>
        </div>
    </div>
);

export default MlmDashboard;
