import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { FileText, RefreshCw, Plus, Trash2, Loader2 } from 'lucide-react';
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
    const [deletingDate, setDeletingDate] = useState(null);
    const [generateDate, setGenerateDate] = useState(todayIst());

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

    const handleGenerate = async (date, { force = false } = {}) => {
        if (!date) {
            toast.error('Select a date first');
            return;
        }

        const existing = items.find((row) => row.reportDate === date);
        let shouldForce = force;

        if (existing?.status === 'finalized' && !shouldForce) {
            const ok = window.confirm(
                `A finalized report already exists for ${date}. ` +
                'Regenerating will reset it to draft and recalculate from commission events. Continue?',
            );
            if (!ok) return;
            shouldForce = true;
        } else if (existing && !shouldForce) {
            const ok = window.confirm(
                `A report already exists for ${date}. Regenerate with fresh calculations?`,
            );
            if (!ok) return;
        }

        setGenerating(true);
        try {
            const res = await adminMlmApi.generatePayoutReport(date, { force: shouldForce });
            const payload = res.data?.result ?? res.data?.data ?? {};
            if (payload.skipped === 'FINALIZED') {
                toast.info(`Report for ${date} is finalized — use regenerate to refresh.`);
            } else {
                toast.success(`Report generated for ${date}`);
            }
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Generate failed');
        } finally {
            setGenerating(false);
        }
    };

    const handleDelete = async (row) => {
        const { reportDate, status } = row;
        const statusNote = status === 'finalized' ? ' (finalized)' : '';
        if (
            !window.confirm(
                `Delete the payout report for ${reportDate}${statusNote}? ` +
                'This only removes the report snapshot — wallets and commission events are not affected. ' +
                'You can regenerate it later.',
            )
        ) {
            return;
        }

        setDeletingDate(reportDate);
        try {
            await adminMlmApi.deletePayoutReport(reportDate);
            toast.success(`Report for ${reportDate} deleted`);
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Delete failed');
        } finally {
            setDeletingDate(null);
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
                <div className="flex flex-wrap gap-2 items-center">
                    <button
                        type="button"
                        onClick={load}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <input
                        type="date"
                        value={generateDate}
                        max={todayIst()}
                        onChange={(e) => setGenerateDate(e.target.value)}
                        className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-700"
                    />
                    <button
                        type="button"
                        onClick={() => handleGenerate(generateDate)}
                        disabled={generating || !generateDate}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60"
                    >
                        {generating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Generate
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const today = todayIst();
                            setGenerateDate(today);
                            handleGenerate(today);
                        }}
                        disabled={generating}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-60"
                    >
                        Today
                    </button>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[800px]">
                        <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                            <tr>
                                <th className="text-left px-4 py-3">Date (IST)</th>
                                <th className="text-left px-4 py-3">Status</th>
                                <th className="text-right px-4 py-3">Pairs</th>
                                <th className="text-right px-4 py-3">Credited</th>
                                <th className="text-right px-4 py-3">Members</th>
                                <th className="text-right px-4 py-3">Referrals</th>
                                <th className="text-left px-4 py-3">Generated</th>
                                <th className="text-right px-4 py-3">Actions</th>
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
                                        No reports yet. Pick a date and generate, or wait for the midnight job.
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
                                            <div className="inline-flex items-center gap-3">
                                                <Link
                                                    to={`/admin/mlm/payout-reports/${row.reportDate}`}
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
                                                >
                                                    <FileText size={14} /> Open
                                                </Link>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(row)}
                                                    disabled={deletingDate === row.reportDate}
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-800 disabled:opacity-50"
                                                    title="Delete this report"
                                                >
                                                    {deletingDate === row.reportDate ? (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    ) : (
                                                        <Trash2 size={14} />
                                                    )}
                                                    Delete
                                                </button>
                                            </div>
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
