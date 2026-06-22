import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
    ArrowLeft,
    Download,
    Lock,
    Pencil,
    RefreshCw,
    Users,
    GitBranch,
    Wallet,
    UserPlus,
} from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const BONUS_LABELS = {
    BINARY_PAIR_MATCH: 'Pair Match',
    DIRECT_REFERRAL_ACTIVATION: 'First Direct Pair',
    REPURCHASE_BONUS: 'Repurchase',
    MENTOR_ROYALTY: 'Mentor Royalty',
    SIGNUP_BONUS_SELF: 'Signup (Self)',
    SIGNUP_BONUS_SPONSOR: 'Signup (Sponsor)',
    MANUAL_ADJUSTMENT: 'Manual',
};

const StatCard = ({ icon: Icon, label, value, sub }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase mb-1">
            <Icon size={14} /> {label}
        </div>
        <p className="text-xl font-bold text-slate-900">{value}</p>
        {sub ? <p className="text-xs text-slate-500 mt-1">{sub}</p> : null}
    </div>
);

const MlmPayoutReportDetail = () => {
    const { date } = useParams();
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [editLine, setEditLine] = useState(null);
    const [editTotal, setEditTotal] = useState('');
    const [editNote, setEditNote] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await adminMlmApi.getPayoutReport(date);
            setReport(res.data?.result ?? res.data?.data);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load report');
            setReport(null);
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        load();
    }, [load]);

    const isDraft = report?.status === 'draft';

    const filteredLines = useMemo(() => {
        const lines = report?.memberLineItems || [];
        const q = search.trim().toLowerCase();
        if (!q) return lines;
        return lines.filter(
            (row) =>
                (row.memberName || '').toLowerCase().includes(q)
                || (row.referralCode || '').toLowerCase().includes(q),
        );
    }, [report, search]);

    const handleRegenerate = async (force = false) => {
        if (force && !window.confirm('Force regenerate will reset preserved edits. Continue?')) return;
        setBusy(true);
        try {
            await adminMlmApi.generatePayoutReport(date, { force });
            toast.success('Report regenerated');
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Regenerate failed');
        } finally {
            setBusy(false);
        }
    };

    const handleExport = async () => {
        try {
            const res = await adminMlmApi.exportPayoutReport(date);
            const blob = new Blob([res.data], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mlm-payout-report-${date}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Export failed');
        }
    };

    const handleFinalize = async () => {
        if (!window.confirm('Finalize this report? Edits will be locked.')) return;
        setBusy(true);
        try {
            await adminMlmApi.finalizePayoutReport(date, {});
            toast.success('Report finalized');
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Finalize failed');
        } finally {
            setBusy(false);
        }
    };

    const openEdit = (line) => {
        setEditLine(line);
        setEditTotal(String(line.correctedTotal ?? line.autoTotal ?? 0));
        setEditNote(line.adminNote || '');
    };

    const saveEdit = async () => {
        if (!editLine) return;
        setBusy(true);
        try {
            await adminMlmApi.patchPayoutReportLineItem(date, editLine._id, {
                correctedTotal: Number(editTotal),
                adminNote: editNote,
            });
            toast.success('Line updated');
            setEditLine(null);
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    const applyCorrection = async () => {
        if (!editLine) return;
        const reason = window.prompt('Reason for wallet correction (required):');
        if (!reason?.trim()) return;
        setBusy(true);
        try {
            await adminMlmApi.patchPayoutReportLineItem(date, editLine._id, {
                correctedTotal: Number(editTotal),
                adminNote: editNote,
            });
            await adminMlmApi.applyPayoutReportCorrection(date, editLine._id, {
                reason: reason.trim(),
            });
            toast.success('Wallet correction applied');
            setEditLine(null);
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Correction failed');
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6 text-center text-slate-500">Loading report…</div>
        );
    }

    if (!report) {
        return (
            <div className="p-6 space-y-4">
                <Link to="/admin/mlm/payout-reports" className="text-sm text-indigo-600 inline-flex items-center gap-1">
                    <ArrowLeft size={14} /> Back
                </Link>
                <p className="text-slate-600">Report not found for {date}.</p>
                <button
                    type="button"
                    onClick={() => handleRegenerate(false)}
                    className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg"
                >
                    Generate now
                </button>
            </div>
        );
    }

    const s = report.summary || {};

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <Link
                        to="/admin/mlm/payout-reports"
                        className="text-xs text-indigo-600 inline-flex items-center gap-1 mb-2"
                    >
                        <ArrowLeft size={12} /> All reports
                    </Link>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                        Payout Report — {report.reportDate}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1 capitalize">
                        Status: {report.status}
                        {report.finalizedAt
                            ? ` · Finalized ${new Date(report.finalizedAt).toLocaleString('en-IN')}`
                            : ''}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => handleRegenerate(false)}
                        disabled={busy || !isDraft}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg disabled:opacity-50"
                    >
                        <RefreshCw size={14} /> Regenerate
                    </button>
                    <button
                        type="button"
                        onClick={handleExport}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg"
                    >
                        <Download size={14} /> CSV
                    </button>
                    {isDraft && (
                        <button
                            type="button"
                            onClick={handleFinalize}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg"
                        >
                            <Lock size={14} /> Finalize
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard icon={GitBranch} label="Pairs matched" value={s.pairsMatched ?? 0} sub={formatINR(s.pairIncomeTotal)} />
                <StatCard icon={Wallet} label="Total credited" value={formatINR(s.totalCredited)} sub={`${s.totalEvents ?? 0} events`} />
                <StatCard icon={UserPlus} label="New referrals" value={s.newReferrals ?? 0} sub={`${s.newActivations ?? 0} activations`} />
                <StatCard icon={Users} label="Withdrawals paid" value={s.withdrawalsPaid ?? 0} sub={formatINR(s.withdrawalsAmount)} />
            </div>

            {report.bonusBreakdown?.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 font-semibold text-slate-800 text-sm">
                        Bonus breakdown
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                            <tr>
                                <th className="text-left px-4 py-2">Type</th>
                                <th className="text-right px-4 py-2">Events</th>
                                <th className="text-right px-4 py-2">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.bonusBreakdown.map((row) => (
                                <tr key={row.bonusType} className="border-t border-slate-100">
                                    <td className="px-4 py-2">
                                        {BONUS_LABELS[row.bonusType] || row.bonusType}
                                    </td>
                                    <td className="px-4 py-2 text-right">{row.eventCount}</td>
                                    <td className="px-4 py-2 text-right font-semibold">
                                        {formatINR(row.amount)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 text-sm">Member earnings</span>
                    <input
                        type="search"
                        placeholder="Search name or code…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg w-48"
                    />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                            <tr>
                                <th className="text-left px-4 py-2">Member</th>
                                <th className="text-right px-4 py-2">Pairs</th>
                                <th className="text-right px-4 py-2">Auto</th>
                                <th className="text-right px-4 py-2">Corrected</th>
                                <th className="text-right px-4 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLines.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                                        No members earned on this day.
                                    </td>
                                </tr>
                            ) : (
                                filteredLines.map((row) => {
                                    const corrected = row.correctedTotal != null;
                                    const mismatch =
                                        corrected && row.correctedTotal !== row.autoTotal;
                                    return (
                                        <tr
                                            key={row._id}
                                            className={`border-t border-slate-100 ${mismatch ? 'bg-amber-50/60' : ''}`}
                                        >
                                            <td className="px-4 py-2">
                                                <p className="font-semibold text-slate-900">
                                                    {row.memberName || '—'}
                                                </p>
                                                <p className="text-xs text-slate-500">{row.referralCode}</p>
                                                {row.adminNote ? (
                                                    <p className="text-[10px] text-amber-700 mt-0.5">{row.adminNote}</p>
                                                ) : null}
                                            </td>
                                            <td className="px-4 py-2 text-right">{row.pairsMatched ?? 0}</td>
                                            <td className="px-4 py-2 text-right">{formatINR(row.autoTotal)}</td>
                                            <td className="px-4 py-2 text-right font-semibold">
                                                {corrected ? formatINR(row.correctedTotal) : '—'}
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                {isDraft && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(row)}
                                                        className="text-xs font-bold text-indigo-600 inline-flex items-center gap-1"
                                                    >
                                                        <Pencil size={12} /> Edit
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {editLine && (
                <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/40">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
                        <h3 className="font-bold text-slate-900">Edit line — {editLine.memberName}</h3>
                        <p className="text-xs text-slate-500">
                            Auto total: {formatINR(editLine.autoTotal)} · Code: {editLine.referralCode}
                        </p>
                        <label className="block text-xs font-semibold text-slate-600">
                            Corrected total (₹)
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editTotal}
                                onChange={(e) => setEditTotal(e.target.value)}
                                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="block text-xs font-semibold text-slate-600">
                            Admin note
                            <textarea
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                rows={2}
                                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </label>
                        <div className="flex flex-wrap gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => setEditLine(null)}
                                className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveEdit}
                                disabled={busy}
                                className="px-3 py-1.5 text-xs font-semibold bg-slate-800 text-white rounded-lg"
                            >
                                Save report only
                            </button>
                            <button
                                type="button"
                                onClick={applyCorrection}
                                disabled={busy}
                                className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg"
                            >
                                Save & apply to wallet
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MlmPayoutReportDetail;
