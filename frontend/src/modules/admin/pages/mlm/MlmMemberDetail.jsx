import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, ChevronDown, Users, ShieldCheck, AlertTriangle, ArrowDownLeft, ArrowDownRight, GitBranch, UserPlus } from 'lucide-react';
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
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                            <GitBranch size={16} /> Binary Downline Tree
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            Plan A placement chain — left and right legs that drive pair-match earnings.
                        </p>
                    </div>
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
                    <BinaryDownlineView root={downlineTree} />
                ) : (
                    <p className="text-sm text-slate-500">No downline data.</p>
                )}
            </div>
        </div>
    );
};

/**
 * Two-column binary tree view: root at top, then a Left Leg column
 * and a Right Leg column rendered side by side. Each column is its
 * own indented sub-tree so deeper L4-L6 expansions remain readable
 * without horizontal blowup.
 */
const BinaryDownlineView = ({ root }) => {
    const leftCount = root.leftLegDirectCount || 0;
    const rightCount = root.rightLegDirectCount || 0;
    const pairs = root.pairsCompleted || 0;

    return (
        <div className="space-y-4">
            <div className="bg-gradient-to-br from-indigo-50 to-slate-50 border border-indigo-100 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center text-base font-bold shrink-0">
                            {(root.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${root.planType === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'}`}>
                                    Plan {root.planType}
                                </span>
                                <p className="text-sm font-bold text-slate-900 truncate">{root.name || 'Unknown'}</p>
                            </div>
                            <code className="text-[11px] text-slate-500">{root.referralCode}</code>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                        <Stat label="Pairs" value={pairs} tone="indigo" />
                        <Stat label="Left" value={leftCount} tone="emerald" />
                        <Stat label="Right" value={rightCount} tone="rose" />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <LegColumn
                    title="Left Leg"
                    icon={ArrowDownLeft}
                    tone="emerald"
                    legDirectCount={leftCount}
                    childNode={root.left}
                />
                <LegColumn
                    title="Right Leg"
                    icon={ArrowDownRight}
                    tone="rose"
                    legDirectCount={rightCount}
                    childNode={root.right}
                />
            </div>
        </div>
    );
};

const Stat = ({ label, value, tone = 'slate' }) => {
    const toneMap = {
        indigo: 'bg-indigo-100 text-indigo-700',
        emerald: 'bg-emerald-100 text-emerald-700',
        rose: 'bg-rose-100 text-rose-700',
        slate: 'bg-slate-100 text-slate-700',
    };
    return (
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold ${toneMap[tone]}`}>
            <span className="uppercase tracking-wider text-[9px] opacity-75">{label}</span>
            <span className="text-sm">{value}</span>
        </div>
    );
};

const LegColumn = ({ title, icon: Icon, tone, legDirectCount, childNode }) => {
    const headerToneMap = {
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        rose: 'bg-rose-50 border-rose-200 text-rose-800',
    };
    return (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className={`px-3 py-2 border-b flex items-center justify-between ${headerToneMap[tone]}`}>
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider">
                    <Icon size={14} /> {title}
                </span>
                <span className="text-[10px] font-semibold opacity-80">
                    {legDirectCount} direct{legDirectCount === 1 ? '' : 's'}
                </span>
            </div>
            <div className="p-3 bg-slate-50/40 min-h-[80px]">
                {childNode ? (
                    <BinaryTreeNode node={childNode} tone={tone} />
                ) : (
                    <EmptySlot tone={tone} />
                )}
            </div>
        </div>
    );
};

const EmptySlot = ({ tone }) => {
    const toneMap = {
        emerald: 'border-emerald-200 text-emerald-600 bg-emerald-50/50',
        rose: 'border-rose-200 text-rose-600 bg-rose-50/50',
    };
    return (
        <div className={`flex items-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed text-xs font-medium ${toneMap[tone]}`}>
            <UserPlus size={14} />
            <span>Slot available — next placement lands here.</span>
        </div>
    );
};

/**
 * A single binary-tree node, recursively rendering its `left` and
 * `right` children as indented branches with position pills. The
 * `tone` prop colours the leg's vertical guide line so the user
 * never loses track of which side of the binary tree they're
 * looking at.
 */
const BinaryTreeNode = ({ node, tone, depth = 0 }) => {
    const [expanded, setExpanded] = useState(true);
    const hasLeft = Boolean(node.left);
    const hasRight = Boolean(node.right);
    const hasChildren = hasLeft || hasRight;

    const guideToneMap = {
        emerald: 'border-emerald-300',
        rose: 'border-rose-300',
    };

    return (
        <div className={depth === 0 ? '' : `ml-3 border-l-2 ${guideToneMap[tone]} pl-3 mt-2`}>
            <div className="flex items-center gap-2 group">
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200"
                        aria-label={expanded ? 'Collapse' : 'Expand'}>
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                ) : (
                    <span className="w-5 h-5 inline-flex items-center justify-center text-slate-300">
                        ·
                    </span>
                )}
                <PositionPill position={node.position} />
                <Link
                    to={`/admin/mlm/members/${node._id}`}
                    className="text-sm font-semibold text-slate-900 hover:text-indigo-700 hover:underline truncate max-w-[160px]">
                    {node.name || 'Unknown'}
                </Link>
                <code className="text-[10px] text-slate-500 font-mono">{node.referralCode}</code>
                <span className="text-[10px] text-slate-400">·</span>
                <span className="text-[10px] text-slate-500">
                    L{node.leftLegDirectCount || 0}/R{node.rightLegDirectCount || 0}
                </span>
                <span className="text-[10px] text-slate-400">·</span>
                <span className="text-[10px] font-semibold text-slate-700">
                    ₹{((node.lifetimePlanAEarnings || 0) + (node.lifetimePlanBEarnings || 0)).toLocaleString('en-IN')}
                </span>
            </div>

            {expanded && hasChildren && (
                <div className="mt-1">
                    {hasLeft ? (
                        <BinaryTreeNode node={node.left} tone={tone} depth={depth + 1} />
                    ) : (
                        <BranchPlaceholder position="L" tone={tone} depth={depth + 1} />
                    )}
                    {hasRight ? (
                        <BinaryTreeNode node={node.right} tone={tone} depth={depth + 1} />
                    ) : (
                        <BranchPlaceholder position="R" tone={tone} depth={depth + 1} />
                    )}
                </div>
            )}
        </div>
    );
};

const PositionPill = ({ position }) => {
    if (position === 'L') {
        return (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
                L
            </span>
        );
    }
    if (position === 'R') {
        return (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                R
            </span>
        );
    }
    return null;
};

const BranchPlaceholder = ({ position, tone, depth }) => {
    const guideToneMap = {
        emerald: 'border-emerald-300',
        rose: 'border-rose-300',
    };
    return (
        <div className={`ml-3 border-l-2 ${guideToneMap[tone]} pl-3 mt-2`}>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 italic">
                <PositionPill position={position} />
                <span>vacant</span>
            </div>
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
