import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { FileText, RefreshCw, Plus } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDate = (d) =>
    d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const todayIst = () => {
    const now = new Date();
    const ist = new Date(now.getTime() + 330 * 60 * 1000);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const d = String(ist.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const StatusBadge = ({ status }) => {
    const cls =
        status === 'finalized'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-amber-100 text-amber-800';
    return (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cls}`}>
            {status || 'draft'}
        </span>
    );
};

const MlmPayoutReports = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await adminMlmApi.listPayoutReports({ limit: 60 });
            const data = res.data?.result ?? res.data?.data;
            setItems(data?.items || []);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load reports');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const handleGenerateToday = async () => {
        const date = todayIst();
        setGenerating(true);
        try {
            await adminMlmApi.generatePayoutReport(date, { force: false });
            toast.success(`Report generated for ${date}`);
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Generate failed');
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Payout Reports</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Daily IST reconciliation — pairs, earnings, referrals
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={load}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <button
                        type="button"
                        onClick={handleGenerateToday}
                        disabled={generating}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60"
                    >
                        <Plus size={14} /> Generate today
                    </button>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                        <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                            <tr>
                                <th className="text-left px-4 py-3">Date (IST)</th>
                                <th className="text-left px-4 py-3">Status</th>
                                <th className="text-right px-4 py-3">Pairs</th>
                                <th className="text-right px-4 py-3">Credited</th>
                                <th className="text-right px-4 py-3">Members</th>
                                <th className="text-right px-4 py-3">Referrals</th>
                                <th className="text-left px-4 py-3">Generated</th>
                                <th className="text-right px-4 py-3">View</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                                        Loading…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                                        No reports yet. Generate today or wait for the midnight job.
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => (
                                    <tr
                                        key={row.reportDate}
                                        className="border-b border-slate-100 hover:bg-slate-50"
                                    >
                                        <td className="px-4 py-3 font-semibold text-slate-900">
                                            {row.reportDate}
                                        </td>
                                        <td className="px-4 py-3">
                                            <StatusBadge status={row.status} />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {row.summary?.pairsMatched ?? 0}
                                        </td>
                                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                                            {formatINR(row.summary?.totalCredited)}
                                        </td>
                                        <td className="px-4 py-3 text-right">{row.memberCount ?? 0}</td>
                                        <td className="px-4 py-3 text-right">
                                            {row.summary?.newReferrals ?? 0}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">
                                            {formatDate(row.lastRegeneratedAt || row.generatedAt)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Link
                                                to={`/admin/mlm/payout-reports/${row.reportDate}`}
                                                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
                                            >
                                                <FileText size={14} /> Open
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default MlmPayoutReports;
