import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, Users, ShieldCheck, AlertTriangle, GitBranch, Hourglass, Award, Check, Loader2, ArrowLeft, ExternalLink } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';
import GenealogyTreeCanvas from '@shared/components/mlm/GenealogyTreeCanvas';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDate = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const STATUS_BADGE = {
    active: 'bg-emerald-100 text-emerald-700',
    registered_unpaid: 'bg-amber-100 text-amber-700',
    suspended: 'bg-rose-100 text-rose-700',
    terminated: 'bg-slate-200 text-slate-700',
};
const STATUS_LABEL = {
    active: 'Active',
    registered_unpaid: 'Registered (unpaid)',
    suspended: 'Suspended',
    terminated: 'Terminated',
};

const MlmMemberDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [downlineTree, setDownlineTree] = useState(null);
    const [downlineDepth, setDownlineDepth] = useState(3);
    const [downlineLoading, setDownlineLoading] = useState(false);
    // Sub-tree navigation: `downlineRootId` is the membership ID
    // currently rendered on the canvas. Starts as the URL `id` (the
    // member whose page we're on) and changes whenever the admin
    // taps a downline node. The `downlineStack` is the breadcrumb
    // history so the back button walks up one level at a time and
    // "Reset" returns to the URL-anchored member.
    const [downlineRootId, setDownlineRootId] = useState(id);
    const [downlineStack, setDownlineStack] = useState([]);
    const [loading, setLoading] = useState(true);
    const [adjustForm, setAdjustForm] = useState({ direction: 'CREDIT', amount: '', bucket: 'earnings', reason: '' });
    const [adjusting, setAdjusting] = useState(false);
    const [verification, setVerification] = useState(null);
    const [verifying, setVerifying] = useState(false);
    const [approving, setApproving] = useState(false);

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

    const loadDownline = async (depth, targetMembershipId) => {
        setDownlineLoading(true);
        try {
            const res = await adminMlmApi.getMemberDownline(targetMembershipId, { depth });
            const d = res.data?.result ?? res.data?.data;
            setDownlineTree(d?.tree || null);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load downline');
        } finally {
            setDownlineLoading(false);
        }
    };

    useEffect(() => { load(); }, [id]);
    // Reset sub-tree navigation whenever the URL member changes.
    useEffect(() => {
        setDownlineRootId(id);
        setDownlineStack([]);
    }, [id]);
    useEffect(() => {
        if (!downlineRootId) return;
        loadDownline(downlineDepth, downlineRootId);
    }, [downlineRootId, downlineDepth]);

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

    const handleApprove = async () => {
        const memberName = data?.membership?.userId?.name || 'this member';
        if (!window.confirm(`Approve ${memberName} for Plan A without payment? This will activate their membership immediately and release any held bonuses to their sponsor.`)) {
            return;
        }
        setApproving(true);
        try {
            const res = await adminMlmApi.approveMember(id);
            const result = res.data?.result ?? res.data?.data ?? {};
            if (result.skipped) {
                toast.info('Already active — no change made.');
            } else {
                const heldMsg = result.releasedHeldBonusCount > 0
                    ? ` ${result.releasedHeldBonusCount} held bonus${result.releasedHeldBonusCount === 1 ? '' : 'es'} released to sponsor.`
                    : '';
                toast.success(`${memberName} activated for Plan A.${heldMsg}`);
            }
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to approve member');
        } finally {
            setApproving(false);
        }
    };

    // ----- Sub-tree navigation handlers -----
    // Tap a node → push current root onto the stack and recenter
    // the canvas on the tapped member. The admin tree builder
    // returns each node's membership `_id`, which is the URL key
    // for both the downline endpoint and the per-member detail
    // page.
    const handleNodeTap = useCallback((node) => {
        const targetId = node?.data?._id ? String(node.data._id) : null;
        if (!targetId) return;
        if (String(targetId) === String(downlineRootId)) return;
        setDownlineStack((prev) => [...prev, downlineRootId]);
        setDownlineRootId(targetId);
    }, [downlineRootId]);

    const handleBackOneLevel = useCallback(() => {
        setDownlineStack((prev) => {
            if (!prev.length) return prev;
            const next = prev.slice(0, -1);
            setDownlineRootId(prev[prev.length - 1]);
            return next;
        });
    }, []);

    const handleResetToAnchor = useCallback(() => {
        setDownlineStack([]);
        setDownlineRootId(id);
    }, [id]);

    const isViewingAnchor = String(downlineRootId) === String(id);

    // Current root's display info — pulled from the loaded sub-tree
    // payload so the breadcrumb always reflects what's actually
    // rendered (not the URL id, which may differ once you drill in).
    const currentRootInfo = useMemo(() => {
        if (!downlineTree) return null;
        const u = downlineTree.userId;
        const name = (typeof u === 'object' && u?.name) || downlineTree.name || 'Member';
        const publicId = (typeof u === 'object' && u?.userId) || downlineTree.publicUserId || null;
        return { name, publicId };
    }, [downlineTree]);

    const downlineBreadcrumb = !isViewingAnchor && currentRootInfo ? (
        <div className="flex items-center gap-1.5 ml-1 flex-wrap">
            <button
                type="button"
                onClick={handleBackOneLevel}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600"
                title="Back one level"
            >
                <ArrowLeft size={12} />
                Back
            </button>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-700">
                <Users size={12} className="text-indigo-500" />
                <span className="font-bold uppercase tracking-wide truncate max-w-[140px]">
                    {currentRootInfo.name}
                </span>
                {currentRootInfo.publicId && (
                    <span className="font-mono font-bold text-indigo-500/80">
                        · {currentRootInfo.publicId}
                    </span>
                )}
            </div>
            <button
                type="button"
                onClick={handleResetToAnchor}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600"
                title="Return to the member you started from"
            >
                Reset
            </button>
            <button
                type="button"
                onClick={() => navigate(`/admin/mlm/members/${downlineRootId}`)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-indigo-200 bg-indigo-600 hover:bg-indigo-700 text-[11px] font-bold text-white"
                title="Open this member's full profile"
            >
                <ExternalLink size={11} />
                Open profile
            </button>
        </div>
    ) : null;

    if (loading) return <div className="p-6 text-slate-500">Loading...</div>;
    if (!data) return <div className="p-6 text-slate-500">Not found</div>;

    const m = data.membership;
    const u = m.userId || {};

    return (
        <div className="p-4 sm:p-6 space-y-6">
            {/* Header row — title + badges on the left, admin action
                buttons pinned to the right. `ml-auto` on the action
                cluster keeps it right-aligned regardless of how the
                badges wrap. */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <Link to="/admin/mlm/members" className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-full shrink-0">
                    <ChevronLeft size={20} />
                </Link>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate max-w-full">{u.name || 'Member'}</h1>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.planType === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'}`}>
                    Plan {m.planType}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_BADGE[m.status] || 'bg-slate-100 text-slate-600'}`}>
                    {STATUS_LABEL[m.status] || m.status}
                </span>
                {m.position && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                        Leg {m.position === 'L' ? 'Left' : 'Right'}
                    </span>
                )}
                {m.status === 'registered_unpaid' && (
                    <button
                        type="button"
                        onClick={handleApprove}
                        disabled={approving}
                        className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white transition-colors shadow-sm"
                        title="Activate Plan A without payment"
                    >
                        {approving ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Check size={14} />
                        )}
                        {approving ? 'Approving…' : 'Approve Plan A'}
                    </button>
                )}
            </div>

            {/* Customer-MLM-rebuild Phase 10 — call-out banner when the
                member hasn't paid the joining fee yet. Visible to admins
                so they can chase up activation. */}
            {m.status === 'registered_unpaid' && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                    <Hourglass size={20} className="text-amber-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="font-bold text-amber-900 text-sm">Registered but not activated</p>
                        <p className="text-xs text-amber-800 mt-0.5">
                            This member has signed up and received their referral code, but hasn't paid the joining fee yet.
                            All pair-match bonuses earned via this member's leg are <strong>held</strong> for the sponsor and
                            will release automatically once activation is confirmed.
                        </p>
                    </div>
                </div>
            )}

            {/* Customer-MLM-rebuild Phase 10 — sponsor and held-bonus
                summary card. Admins can navigate straight to the
                sponsor's profile and see the total amount waiting on
                this member's activation. */}
            {(data.sponsor || (m.heldPairBonusForSponsor || 0) > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {data.sponsor && (
                        <Card title="Sponsor (L1 Upline)">
                            <Row label="Name" value={data.sponsor.name || '—'} />
                            <Row label="Phone" value={data.sponsor.phone || '—'} />
                            <Row label="Email" value={data.sponsor.email || '—'} />
                            <Row label="Code" value={<code className="font-bold">{data.sponsor.referralCode || '—'}</code>} />
                            <Row label="Status" value={
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_BADGE[data.sponsor.status] || 'bg-slate-100 text-slate-600'}`}>
                                    {STATUS_LABEL[data.sponsor.status] || data.sponsor.status}
                                </span>
                            } />
                            <div className="pt-2">
                                <Link to={`/admin/mlm/members/${data.sponsor.membershipId}`} className="text-xs font-bold text-indigo-600 hover:underline">
                                    View sponsor →
                                </Link>
                            </div>
                        </Card>
                    )}
                    <Card title="Held Pair-Match Bonus">
                        <div className="flex items-center gap-3 mb-2">
                            <Award className="text-amber-600" size={24} />
                            <div>
                                <p className="text-2xl font-black text-slate-900">{formatINR(m.heldPairBonusForSponsor || 0)}</p>
                                <p className="text-[11px] text-slate-500">Owed to this member's sponsor, pending downline activation</p>
                            </div>
                        </div>
                        {(data.heldBonusEvents?.length || 0) > 0 ? (
                            <ul className="divide-y divide-slate-100 text-xs">
                                {data.heldBonusEvents.map((row) => (
                                    <li key={row._id} className="py-2 flex items-center justify-between">
                                        <div>
                                            <p className="font-semibold text-slate-800">Pair #{row.meta?.pairIndex ?? '?'}</p>
                                            <p className="text-[10px] text-slate-500">{formatDate(row.createdAt)}</p>
                                        </div>
                                        <span className="font-bold text-amber-700">{formatINR(row.bonusAmount || 0)}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-xs text-slate-500">No held bonus events currently rely on this member.</p>
                        )}
                    </Card>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Membership">
                    <Row label="Referral Code" value={<code className="font-bold">{m.referralCode}</code>} />
                    <Row label="Status" value={
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_BADGE[m.status] || 'bg-slate-100 text-slate-600'}`}>
                            {STATUS_LABEL[m.status] || m.status}
                        </span>
                    } />
                    <Row label="Leg position" value={m.position === 'L' ? 'Left' : m.position === 'R' ? 'Right' : '—'} />
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
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
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

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 pt-5 pb-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                        <GitBranch size={16} /> Binary Downline Tree
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        Hover any node to see member details · tap a node to drill into their downline ·
                        use the zoom controls (or ⌘/Ctrl + scroll) to resize.
                    </p>
                </div>
                {/* Fixed-height canvas frame. The shared component
                    expects to live inside a `flex-1 min-h-0` parent
                    (it stretches to fill via its internal flex-1) —
                    a 620px tall flex column gives that. */}
                <div className="flex h-[620px] flex-col">
                    <GenealogyTreeCanvas
                        tree={downlineTree}
                        loading={downlineLoading}
                        isMember
                        depth={downlineDepth}
                        onDepthChange={setDownlineDepth}
                        onNodeTap={handleNodeTap}
                        breadcrumb={downlineBreadcrumb}
                        emptyTreeMessage="No downline data for this member yet."
                        footerHint={
                            <>
                                <span className="hidden sm:inline">
                                    Hover for details · tap a node to drill into their downline ·
                                    use the zoom controls (or ⌘/Ctrl + scroll) to resize.
                                </span>
                                <span className="sm:hidden">
                                    Tap a node to drill in · use the zoom buttons to resize.
                                </span>
                            </>
                        }
                    />
                </div>
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
