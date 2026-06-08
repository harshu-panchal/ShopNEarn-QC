import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Users, ShieldCheck, AlertTriangle, GitBranch, Hourglass, Award, Check, Loader2, ArrowLeft, RotateCcw } from 'lucide-react';
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

// Friendly labels for the `MlmCommissionEvent.bonusType` enum. Falls
// back to the raw value when a new bonus type ships without a UI
// update — keeps the cell readable in the worst case and avoids
// crashes on enum drift.
const BONUS_TYPE_LABEL = {
    BINARY_PAIR_MATCH: 'Binary pair match',
    DIRECT_REFERRAL_MILESTONE: 'Direct referral milestone',
    REPURCHASE_BONUS: 'Repurchase',
    MENTOR_ROYALTY: 'Mentor royalty',
    HOME_SHOPPING_SALES: 'Home shopping sales',
    HOME_SHOPPING_REFERRAL: 'Home shopping referral',
    HOME_SHOPPING_ROYALTY: 'Home shopping royalty',
    GIFT_VOUCHER_MILESTONE: 'Gift voucher milestone',
    MANUAL_ADJUSTMENT: 'Manual adjustment',
    SIGNUP_BONUS_SELF: 'Signup bonus',
    SIGNUP_BONUS_SPONSOR: 'Referral bonus (signup)',
};

function formatBonusType(raw) {
    if (!raw) return '—';
    return BONUS_TYPE_LABEL[raw] || raw.replace(/_/g, ' ').toLowerCase();
}

const MlmMemberDetail = () => {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [downlineTree, setDownlineTree] = useState(null);
    // Default depth = 3 levels. Opening the entire downline by
    // default flooded the canvas with placeholder slots and pushed
    // the meaningful nodes off-screen for any reasonably populated
    // member. Three levels keeps the initial view scannable and
    // lines up with the customer-side default; admins doing a full
    // audit can still pick "All levels" from the dropdown.
    // (`0` is the backend sentinel for unlimited.)
    const [downlineDepth, setDownlineDepth] = useState(3);
    const [downlineLoading, setDownlineLoading] = useState(false);
    // In-page sub-tree navigation. `downlineRootId` is the
    // membership currently rendered on the canvas; it starts as
    // the URL `id` and changes whenever the admin taps a node.
    // `downlineStack` is the breadcrumb history so the Back
    // button unwinds one level at a time and Reset returns to the
    // URL-anchored member without touching the browser URL.
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
    // When the URL member changes (e.g. admin uses the back
    // button to return to a different member), reset the in-page
    // sub-tree navigation so the canvas re-anchors on that member.
    useEffect(() => {
        setDownlineRootId(id);
        setDownlineStack([]);
    }, [id]);
    // Fetch whatever sub-tree the canvas is currently rooted at.
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

    // ----- In-page sub-tree navigation -----
    // Tap a node → push the current root onto the stack and
    // re-render the canvas rooted at the tapped member. The admin
    // tree builder sets `_id` to the membership document id, which
    // is exactly the key the downline endpoint takes — so we can
    // re-fetch a brand-new sub-tree without leaving this page or
    // changing the URL.
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

    // Genealogy redesign — admin-side empty-slot tap handler. The
    // canvas opens its own modal and gives us the resolved
    // `{parentMembershipId, leg, form}` payload here. Admins can
    // place anywhere in the displayed tree (no downline-ownership
    // check on the backend route); after success we re-fetch the
    // current sub-tree so the new node renders immediately.
    const handleAddMember = useCallback(async ({ parentMembershipId, leg, form }) => {
        try {
            const res = await adminMlmApi.addChildMember(parentMembershipId, {
                leg,
                name: form.name,
                email: form.email,
                phone: form.phone,
                password: form.password,
            });
            const newMember =
                res.data?.result?.newMember ?? res.data?.data?.newMember ?? null;
            const credentialEcho = newMember?.publicUserId
                ? ` (User ID ${newMember.publicUserId})`
                : '';
            toast.success(
                `Member created and placed in the tree${credentialEcho}. Login details have been emailed.`,
            );
            await loadDownline(downlineDepth, downlineRootId);
            await load();
        } catch (err) {
            const msg = err?.response?.data?.message || 'Failed to add member.';
            toast.error(msg);
            throw new Error(msg);
        }
    // `loadDownline` and `load` are inline closures defined above;
    // their identities don't change in a way that affects behaviour
    // here, so omitting them from the deps array is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [downlineDepth, downlineRootId]);

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

    // Toolbar breadcrumb shown only when the admin has drilled in.
    // No "Open profile" link here on purpose — the whole point of
    // drill-in is to inspect a sub-tree without leaving this page,
    // so we don't offer a one-tap URL change. (The admin can still
    // copy the membership id from the URL if they need it.)
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
                <RotateCcw size={11} />
                Reset
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
                        <PaginatedList
                            items={data.heldBonusEvents || []}
                            pageSize={5}
                            emptyMessage="No held bonus events currently rely on this member."
                            ulClassName="divide-y divide-slate-100 text-xs"
                            renderItem={(row) => (
                                <li key={row._id} className="py-2 flex items-center justify-between">
                                    <div>
                                        <p className="font-semibold text-slate-800">Pair #{row.meta?.pairIndex ?? '?'}</p>
                                        <p className="text-[10px] text-slate-500">{formatDate(row.createdAt)}</p>
                                    </div>
                                    <span className="font-bold text-amber-700">{formatINR(row.bonusAmount || 0)}</span>
                                </li>
                            )}
                        />
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
                    <PaginatedList
                        items={data.commissionHistory || []}
                        pageSize={5}
                        emptyMessage="No commissions yet."
                        ulClassName="divide-y divide-slate-100 text-sm"
                        renderItem={(row) => (
                            <li key={row._id} className="py-2 flex items-center justify-between">
                                <div>
                                    <p className="font-semibold text-slate-800 capitalize">
                                        {formatBonusType(row.bonusType)}{row.level ? ` L${row.level}` : ''}
                                    </p>
                                    <p className="text-[11px] text-slate-500">{formatDate(row.createdAt)} · {row.status}</p>
                                </div>
                                <span className="font-bold text-emerald-700">+{formatINR(row.cappedAmount)}</span>
                            </li>
                        )}
                    />
                </Card>

                <Card title="Withdrawals">
                    <PaginatedList
                        items={data.withdrawals || []}
                        pageSize={5}
                        emptyMessage="No withdrawals yet."
                        ulClassName="divide-y divide-slate-100 text-sm"
                        renderItem={(row) => (
                            <li key={row._id} className="py-2 flex items-center justify-between">
                                <div>
                                    <p className="font-semibold text-slate-800">{formatINR(row.amount)} <span className="text-xs text-slate-500">(net {formatINR(row.netPayoutAmount)})</span></p>
                                    <p className="text-[11px] text-slate-500">{formatDate(row.createdAt)} · {row.status}</p>
                                </div>
                            </li>
                        )}
                    />
                </Card>
            </div>

            <Card title="Direct Referrals">
                <PaginatedList
                    items={data.directReferrals || []}
                    pageSize={5}
                    emptyMessage="No direct referrals."
                    ulClassName="divide-y divide-slate-100 text-sm"
                    renderItem={(row) => (
                        <li key={row._id} className="py-2 flex items-center justify-between">
                            <div>
                                <p className="font-semibold text-slate-800">{row.userId?.name || 'Unknown'} <span className="text-xs text-slate-500">· {row.userId?.phone || ''}</span></p>
                                <p className="text-[11px] text-slate-500">{row.referralCode} · Plan {row.planType}</p>
                            </div>
                            <Link to={`/admin/mlm/members/${row._id}`} className="text-xs font-bold text-indigo-600">View</Link>
                        </li>
                    )}
                />
            </Card>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 pt-5 pb-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                        <GitBranch size={16} /> Binary Downline Tree
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        Click any node to open its detail card — use the “Show Genealogy”
                        button inside to re-render the tree rooted at that member (no page
                        change) · use Back / Reset in the toolbar to walk up · drag the
                        background to pan · hold ⌘/Ctrl + scroll to zoom.
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
                        onAddMember={handleAddMember}
                        emptySlotMaxDepth={2}
                        breadcrumb={downlineBreadcrumb}
                        highlightViewerSelf={false}
                        emptyTreeMessage="No downline data for this member yet."
                        footerHint={
                            <>
                                <span className="hidden sm:inline">
                                    Click a member to open their detail card — use “Show
                                    Genealogy” inside to re-render the tree rooted on that
                                    member · tap a <span className="text-sky-600 font-bold">blue</span> open
                                    slot to add a new member directly under that parent · use
                                    Back / Reset to walk up · drag the background to pan · hold
                                    ⌘/Ctrl + scroll to zoom.
                                </span>
                                <span className="sm:hidden">
                                    Tap a member to open details · Show Genealogy to drill in ·
                                    tap blue slots to add members · Back to walk up · drag to
                                    pan · pinch to zoom.
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

/**
 * PaginatedList — lightweight client-side pagination for the
 * Commission / Withdrawals / Direct Referrals / Held Bonus card
 * lists on the admin member detail page.
 *
 * - Renders the empty-state message when `items` is empty so each
 *   call-site doesn't have to repeat the conditional.
 * - Skips the pagination bar entirely when `items.length <= pageSize`
 *   so short lists stay quiet.
 * - Resets to page 1 whenever the items array reference changes
 *   (e.g. after a wallet adjustment refetches `data`) — using length
 *   as the trigger keeps the effect cheap and stable.
 *
 * No backend changes — the data already arrives as a single bounded
 * payload (commissionHistory is capped at 50 on the server, the
 * others are per-member and tiny). If any list grows unbounded
 * later, swap this for a server-side cursor/page endpoint.
 */
const PaginatedList = ({
    items,
    pageSize = 5,
    emptyMessage,
    renderItem,
    ulClassName = 'divide-y divide-slate-100 text-sm',
}) => {
    const [page, setPage] = useState(1);
    const totalPages = Math.max(1, Math.ceil((items?.length || 0) / pageSize));

    // If the data shrinks (e.g. a refetch returns fewer rows) make
    // sure the current page never points past the end of the list.
    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    // Reset to page 1 whenever the input array changes identity so
    // the user lands on the freshest rows after a refetch.
    useEffect(() => {
        setPage(1);
    }, [items]);

    if (!items || items.length === 0) {
        return <p className="text-sm text-slate-500">{emptyMessage}</p>;
    }

    const start = (page - 1) * pageSize;
    const visible = items.slice(start, start + pageSize);
    const showBar = items.length > pageSize;

    return (
        <div className="space-y-2">
            <ul className={ulClassName}>{visible.map(renderItem)}</ul>
            {showBar && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <span className="text-[10px] text-slate-500">
                        Showing <span className="font-bold text-slate-700">{start + 1}</span>–
                        <span className="font-bold text-slate-700">{Math.min(start + pageSize, items.length)}</span>{' '}
                        of <span className="font-bold text-slate-700">{items.length}</span>
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="w-7 h-7 rounded-md border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-600"
                            aria-label="Previous page"
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <span className="text-[11px] font-bold text-slate-600 px-2">
                            {page} / {totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="w-7 h-7 rounded-md border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-600"
                            aria-label="Next page"
                        >
                            <ChevronRight size={14} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MlmMemberDetail;
