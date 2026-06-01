import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, ChevronDown, Users, ShieldCheck, AlertTriangle } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDate = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const MlmMemberDetail = () => {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [downlineTree, setDownlineTree] = useState(null);
    const [downlineDepth, setDownlineDepth] = useState(3);
    const [downlineLoading, setDownlineLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [adjustForm, setAdjustForm] = useState({ direction: 'CREDIT', amount: '', bucket: 'earnings', reason: '' });
    const [adjusting, setAdjusting] = useState(false);
    const [verification, setVerification] = useState(null);
    const [verifying, setVerifying] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await adminMlmApi.getMember(id);
            setData(res.data?.result ?? res.data?.data);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load member');
        } finally {
            setLoading(false);
        }
    };

    const loadDownline = async (depth) => {
        setDownlineLoading(true);
        try {
            const res = await adminMlmApi.getMemberDownline(id, { depth });
            const d = res.data?.result ?? res.data?.data;
            setDownlineTree(d?.tree || null);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load downline');
        } finally {
            setDownlineLoading(false);
        }
    };

    useEffect(() => { load(); }, [id]);
    useEffect(() => { loadDownline(downlineDepth); }, [id, downlineDepth]);

    const handleAdjust = async (e) => {
        e.preventDefault();
        if (!adjustForm.amount || Number(adjustForm.amount) <= 0) {
            toast.error('Enter a valid amount');
            return;
        }
        if (!adjustForm.reason.trim()) {
            toast.error('Reason is required');
            return;
        }
        setAdjusting(true);
        try {
            await adminMlmApi.adjustMemberWallet(id, {
                direction: adjustForm.direction,
                amount: Number(adjustForm.amount),
                bucket: adjustForm.bucket,
                reason: adjustForm.reason.trim(),
            });
            toast.success('Wallet adjusted');
            setAdjustForm({ direction: 'CREDIT', amount: '', bucket: 'earnings', reason: '' });
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Adjustment failed');
        } finally {
            setAdjusting(false);
        }
    };

    const handleVerify = async () => {
        setVerifying(true);
        try {
            const res = await adminMlmApi.verifyMemberWallet(id);
            setVerification(res.data?.result ?? res.data?.data);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Verification failed');
        } finally {
            setVerifying(false);
        }
    };

    if (loading) return <div className="p-6 text-slate-500">Loading...</div>;
    if (!data) return <div className="p-6 text-slate-500">Not found</div>;

    const m = data.membership;
    const u = m.userId || {};

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <Link to="/admin/mlm/members" className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-full">
                    <ChevronLeft size={20} />
                </Link>
                <h1 className="text-2xl font-bold text-slate-900">{u.name || 'Member'}</h1>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.planType === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                    Plan {m.planType}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Membership">
                    <Row label="Referral Code" value={<code className="font-bold">{m.referralCode}</code>} />
                    <Row label="Status" value={m.status} />
                    <Row label="Phone" value={u.phone} />
                    <Row label="Email" value={u.email || '-'} />
                    <Row label="Joined" value={formatDate(m.joinedAt)} />
                    {m.planBJoinedAt && <Row label="Plan B Since" value={formatDate(m.planBJoinedAt)} />}
                </Card>

                <Card title="Network">
                    <Row label="Direct Referrals" value={m.directReferralsCount || 0} />
                    <Row label="Total Downline" value={m.totalDownlineCount || 0} />
                    <Row label="Lifetime (Plan A)" value={formatINR(m.lifetimePlanAEarnings)} />
                    <Row label="Lifetime (Plan B)" value={formatINR(m.lifetimePlanBEarnings)} />
                    <Row label="Today's Cap Used" value={formatINR(m.dailyCapTracker?.usedAmount || 0)} />
                </Card>

                <Card title="Manual Wallet Adjustment">
                    <form onSubmit={handleAdjust} className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={adjustForm.direction}
                                onChange={(e) => setAdjustForm({ ...adjustForm, direction: e.target.value })}
                                className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                            >
                                <option value="CREDIT">Credit</option>
                                <option value="DEBIT">Debit</option>
                            </select>
                            <select
                                value={adjustForm.bucket}
                                onChange={(e) => setAdjustForm({ ...adjustForm, bucket: e.target.value })}
                                className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                            >
                                <option value="earnings">Earnings</option>
                                <option value="shopping">Shopping</option>
                                <option value="pending">Pending</option>
                                <option value="available">Available (legacy)</option>
                            </select>
                        </div>
                        <input
                            type="number"
                            value={adjustForm.amount}
                            onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })}
                            placeholder="Amount"
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                        <textarea
                            value={adjustForm.reason}
                            onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                            placeholder="Reason (required)"
                            rows={2}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                        <button
                            type="submit"
                            disabled={adjusting}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold uppercase tracking-wider py-2 rounded-lg"
                        >
                            {adjusting ? 'Applying...' : 'Apply Adjustment'}
                        </button>
                    </form>
                </Card>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                        <ShieldCheck size={16} /> Wallet ↔ Ledger Verification
                    </h3>
                    <button
                        onClick={handleVerify}
                        disabled={verifying}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-[11px] font-bold uppercase tracking-wider rounded-lg"
                    >
                        {verifying ? 'Verifying...' : 'Run Verification'}
                    </button>
                </div>
                {!verification ? (
                    <p className="text-xs text-slate-500">Run an on-demand reconciliation. Compares wallet bucket balances to the ledger journal. No data is modified.</p>
                ) : (
                    <div className="space-y-2">
                        <div
                            className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                                Math.abs(verification.drift) > 0.01
                                    ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                        >
                            {Math.abs(verification.drift) > 0.01 ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
                            <span className="font-bold">
                                {Math.abs(verification.drift) > 0.01
                                    ? `Drift detected: ${formatINR(verification.drift)}`
                                    : 'Wallet matches ledger'}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div className="bg-slate-50 rounded p-2"><p className="text-slate-500">Actual net</p><p className="font-bold">{formatINR(verification.actualNet)}</p></div>
                            <div className="bg-slate-50 rounded p-2"><p className="text-slate-500">Expected net</p><p className="font-bold">{formatINR(verification.expectedNet)}</p></div>
                            <div className="bg-slate-50 rounded p-2"><p className="text-slate-500">Ledger credits</p><p className="font-bold">{formatINR(verification.ledger?.credit)} <span className="text-slate-400">({verification.ledger?.creditEntries})</span></p></div>
                            <div className="bg-slate-50 rounded p-2"><p className="text-slate-500">Ledger debits</p><p className="font-bold">{formatINR(verification.ledger?.debit)} <span className="text-slate-400">({verification.ledger?.debitEntries})</span></p></div>
                            {verification.breakdown && Object.entries(verification.breakdown).map(([k, v]) => (
                                <div key={k} className="bg-slate-50 rounded p-2">
                                    <p className="text-slate-500 capitalize">{k}</p>
                                    <p className="font-bold">{formatINR(v)}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title={`Commission History (last 50)`}>
                    {data.commissionHistory.length === 0 ? (
                        <p className="text-sm text-slate-500">No commissions yet.</p>
                    ) : (
                        <ul className="divide-y divide-slate-100 text-sm">
                            {data.commissionHistory.map((row) => (
                                <li key={row._id} className="py-2 flex items-center justify-between">
                                    <div>
                                        <p className="font-semibold text-slate-800">{row.bonusType}{row.level ? ` L${row.level}` : ''}</p>
                                        <p className="text-[11px] text-slate-500">{formatDate(row.createdAt)} · {row.status}</p>
                                    </div>
                                    <span className="font-bold text-emerald-700">+{formatINR(row.cappedAmount)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                <Card title="Withdrawals">
                    {data.withdrawals.length === 0 ? (
                        <p className="text-sm text-slate-500">No withdrawals yet.</p>
                    ) : (
                        <ul className="divide-y divide-slate-100 text-sm">
                            {data.withdrawals.map((row) => (
                                <li key={row._id} className="py-2 flex items-center justify-between">
                                    <div>
                                        <p className="font-semibold text-slate-800">{formatINR(row.amount)} <span className="text-xs text-slate-500">(net {formatINR(row.netPayoutAmount)})</span></p>
                                        <p className="text-[11px] text-slate-500">{formatDate(row.createdAt)} · {row.status}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            <Card title="Direct Referrals">
                {data.directReferrals.length === 0 ? (
                    <p className="text-sm text-slate-500">No direct referrals.</p>
                ) : (
                    <ul className="divide-y divide-slate-100 text-sm">
                        {data.directReferrals.map((row) => (
                            <li key={row._id} className="py-2 flex items-center justify-between">
                                <div>
                                    <p className="font-semibold text-slate-800">{row.userId?.name || 'Unknown'} <span className="text-xs text-slate-500">· {row.userId?.phone || ''}</span></p>
                                    <p className="text-[11px] text-slate-500">{row.referralCode} · Plan {row.planType}</p>
                                </div>
                                <Link to={`/admin/mlm/members/${row._id}`} className="text-xs font-bold text-indigo-600">View</Link>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                        <Users size={16} /> Downline Tree
                    </h3>
                    <div className="flex items-center gap-1">
                        {[2, 3, 4, 5, 6].map((d) => (
                            <button
                                key={d}
                                onClick={() => setDownlineDepth(d)}
                                className={`px-2 py-1 text-[10px] font-bold rounded ${
                                    downlineDepth === d ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                L{d}
                            </button>
                        ))}
                    </div>
                </div>
                {downlineLoading ? (
                    <p className="text-sm text-slate-500">Loading tree...</p>
                ) : downlineTree ? (
                    <div className="overflow-x-auto">
                        <TreeNode node={downlineTree} isRoot />
                    </div>
                ) : (
                    <p className="text-sm text-slate-500">No downline data.</p>
                )}
            </div>
        </div>
    );
};

const TreeNode = ({ node, isRoot = false }) => {
    const [expanded, setExpanded] = useState(true);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    return (
        <div className={isRoot ? '' : 'ml-5 border-l border-slate-200 pl-4 mt-1.5'}>
            <div className="flex items-center gap-2 py-1.5">
                {hasChildren ? (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-100"
                    >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                ) : (
                    <span className="w-5 h-5" />
                )}
                <div className={`flex items-center gap-2 ${isRoot ? 'bg-indigo-50 px-2.5 py-1.5 rounded-lg' : ''}`}>
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${node.planType === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{node.planType}</span>
                    <Link to={`/admin/mlm/members/${node._id}`} className="text-sm font-semibold text-slate-900 hover:underline">
                        {node.name || 'Unknown'}
                    </Link>
                    <code className="text-[10px] text-slate-500">{node.referralCode}</code>
                    <span className="text-[10px] text-slate-500">· {node.directReferralsCount} directs · ₹{((node.lifetimePlanAEarnings || 0) + (node.lifetimePlanBEarnings || 0)).toLocaleString('en-IN')}</span>
                </div>
            </div>
            {expanded && hasChildren && (
                <div>
                    {node.children.map((child) => (
                        <TreeNode key={child._id} node={child} />
                    ))}
                </div>
            )}
        </div>
    );
};

const Card = ({ title, children }) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">{title}</h3>
        {children}
    </div>
);

const Row = ({ label, value }) => (
    <div className="flex items-center justify-between py-1 text-sm">
        <span className="text-slate-500">{label}</span>
        <span className="font-semibold text-slate-900 text-right">{value}</span>
    </div>
);

export default MlmMemberDetail;
