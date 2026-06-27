import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';
import MemberJoinedSubtitle from '@shared/components/mlm/MemberJoinedSubtitle';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDate = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATUS_FILTERS = ['pending', 'approved', 'paid', 'rejected', 'cancelled', ''];

const MlmWithdrawals = () => {
    const [items, setItems] = useState([]);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);
    const [actionId, setActionId] = useState(null);
    const [detailRow, setDetailRow] = useState(null);

    const load = async () => {
        setLoading(true);
        try {
            const params = { limit: 50 };
            if (status) params.status = status;
            const res = await adminMlmApi.listWithdrawals(params);
            const data = res.data?.result ?? res.data?.data;
            setItems(data?.items || []);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [status]);

    const handleApprove = async (row) => {
        const beneficiaryLabel = row.beneficiary?.method === 'upi'
            ? `UPI: ${row.beneficiary?.upiId || '-'}`
            : `A/c: ${row.beneficiary?.accountNumber || '-'} (${row.beneficiary?.ifsc || '-'})`;
        const reference = window.prompt(
            `Payout reference (UTR) for ${formatINR(row.netPayoutAmount)} to ${row.userId?.name || row.userId?.phone || row.userId}.\n\n` +
            `Review beneficiary before approving:\n${beneficiaryLabel}`
        );
        if (reference === null) return;
        setActionId(row._id);
        try {
            await adminMlmApi.approveWithdrawal(row._id, { payoutReference: reference });
            toast.success('Approved');
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Approve failed');
        } finally {
            setActionId(null);
        }
    };

    const handleReject = async (row) => {
        const reason = window.prompt(`Reason for rejecting ${formatINR(row.amount)}?`);
        if (!reason) return;
        setActionId(row._id);
        try {
            await adminMlmApi.rejectWithdrawal(row._id, { reason });
            toast.success('Rejected and wallet refunded');
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Reject failed');
        } finally {
            setActionId(null);
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">MLM Withdrawals</h1>
                <div className="flex gap-1 flex-wrap">
                    {STATUS_FILTERS.map((s) => (
                        <button
                            key={s || 'all'}
                            onClick={() => setStatus(s)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg uppercase tracking-wider ${
                                status === s ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700'
                            }`}
                        >
                            {s || 'All'}
                        </button>
                    ))}
                </div>
            </div>

            {/* 7-col table wrapped in overflow-x-auto so admins on
                phones/tablets can swipe instead of triggering column
                collisions. min-w-[820px] keeps each column comfortable
                on the desktop layout. */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
                        <tr>
                            <th className="text-left px-4 py-3">Requested</th>
                            <th className="text-left px-4 py-3">Customer</th>
                            <th className="text-right px-4 py-3">Amount</th>
                            <th className="text-right px-4 py-3">Net</th>
                            <th className="text-left px-4 py-3">Beneficiary</th>
                            <th className="text-left px-4 py-3">Status</th>
                            <th className="text-right px-4 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Loading...</td></tr>
                        ) : items.length === 0 ? (
                            <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No requests in this status.</td></tr>
                        ) : items.map((row) => (
                            <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                                <td className="px-4 py-3 text-xs">
                                    <p>{formatDate(row.createdAt)}</p>
                                </td>
                                <td className="px-4 py-3">
                                    <p className="font-semibold text-slate-900">{row.userId?.name || 'Unknown'}</p>
                                    <p className="text-xs text-slate-500">{row.userId?.phone || '-'}</p>
                                    <MemberJoinedSubtitle joinedAt={row.memberJoinedAt} className="text-[10px] text-slate-400 mt-0.5" />
                                </td>
                                <td className="px-4 py-3 text-right font-bold">{formatINR(row.amount)}</td>
                                <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatINR(row.netPayoutAmount)}</td>
                                <td className="px-4 py-3 text-xs">
                                    <p className="font-semibold uppercase">{row.beneficiary?.method}</p>
                                    {row.beneficiary?.method === 'upi' ? (
                                        <p className="text-slate-600">{row.beneficiary?.upiId}</p>
                                    ) : (
                                        <>
                                            <p className="text-slate-600">{row.beneficiary?.accountHolderName}</p>
                                            <p className="text-slate-500 text-[10px]">A/c {row.beneficiary?.accountNumber} · {row.beneficiary?.ifsc}</p>
                                        </>
                                    )}
                                    {row.beneficiary?.panNumber && (
                                        <p className="text-slate-400 text-[10px]">PAN {row.beneficiary.panNumber}</p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setDetailRow(row)}
                                        className="mt-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
                                    >
                                        View details
                                    </button>
                                </td>
                                <td className="px-4 py-3">
                                    <StatusPill status={row.status} />
                                    {row.payoutReference && (
                                        <p className="text-[10px] text-emerald-700 mt-1">UTR: {row.payoutReference}</p>
                                    )}
                                    {row.rejectionReason && (
                                        <p className="text-[10px] text-rose-600 mt-1">{row.rejectionReason}</p>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    {row.status === 'pending' && (
                                        <div className="flex gap-1 justify-end">
                                            <button
                                                onClick={() => handleApprove(row)}
                                                disabled={actionId === row._id}
                                                className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded disabled:opacity-50"
                                            >
                                                Approve
                                            </button>
                                            <button
                                                onClick={() => handleReject(row)}
                                                disabled={actionId === row._id}
                                                className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white rounded disabled:opacity-50"
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>
            </div>
            <BeneficiaryDetailsModal row={detailRow} onClose={() => setDetailRow(null)} />
        </div>
    );
};

const BeneficiaryDetailsModal = ({ row, onClose }) => {
    if (!row) return null;
    const beneficiary = row.beneficiary || {};
    const isUpi = beneficiary.method === 'upi';
    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <h2 className="text-base font-bold text-slate-900">Beneficiary details</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                    >
                        Close
                    </button>
                </div>

                <div className="px-5 py-4 space-y-3 text-sm">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Customer</p>
                        <p className="font-semibold text-slate-900">{row.userId?.name || 'Unknown'}</p>
                        <p className="text-slate-600">{row.userId?.phone || '-'}</p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Method</p>
                        <p className="font-semibold uppercase text-slate-900">{beneficiary.method || '-'}</p>
                    </div>
                    {isUpi ? (
                        <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500">UPI ID</p>
                            <p className="font-mono text-slate-900 break-all">{beneficiary.upiId || '-'}</p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500">Account holder</p>
                                <p className="text-slate-900">{beneficiary.accountHolderName || '-'}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500">Account number</p>
                                <p className="font-mono text-slate-900 break-all">{beneficiary.accountNumber || '-'}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500">IFSC</p>
                                <p className="font-mono text-slate-900">{beneficiary.ifsc || '-'}</p>
                            </div>
                        </>
                    )}
                    {beneficiary.panNumber ? (
                        <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500">PAN</p>
                            <p className="font-mono text-slate-900">{beneficiary.panNumber}</p>
                        </div>
                    ) : null}
                    <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Net payout</p>
                        <p className="font-bold text-emerald-700">{formatINR(row.netPayoutAmount)}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatusPill = ({ status }) => {
    const map = {
        pending: { label: 'Pending', icon: Clock, color: 'bg-amber-100 text-amber-700' },
        approved: { label: 'Approved', icon: CheckCircle2, color: 'bg-blue-100 text-blue-700' },
        paid: { label: 'Paid', icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-700' },
        rejected: { label: 'Rejected', icon: XCircle, color: 'bg-rose-100 text-rose-700' },
        cancelled: { label: 'Cancelled', icon: AlertCircle, color: 'bg-slate-100 text-slate-600' },
    };
    const cfg = map[status] || map.pending;
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cfg.color}`}>
            <Icon size={10} /> {cfg.label}
        </span>
    );
};

export default MlmWithdrawals;
