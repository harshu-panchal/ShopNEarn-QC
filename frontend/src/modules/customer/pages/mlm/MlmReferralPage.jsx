import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Copy, Share2, Users, MessageCircle, Download, QrCode, ArrowLeft, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { mlmApi } from '../../services/mlmApi';
import { useMlmDrawer } from './MlmLayout';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const referralPlanLabel = (referral) => {
    if (referral?.status !== 'active') return 'Member';
    if (referral?.planType === 'B') return 'Plan B';
    if (referral?.planType === 'A') return 'Plan A';
    return 'Member';
};

const MlmReferralPage = () => {
    const navigate = useNavigate();
    const [membership, setMembership] = useState(null);
    const [referrals, setReferrals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [leg, setLeg] = useState('L');

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const [m, r, o] = await Promise.all([
                    mlmApi.getMembership(),
                    mlmApi.getDirectReferrals({ limit: 100 }),
                    mlmApi.getDashboardOverview()
                ]);
                const mp = m.data?.result ?? m.data?.data;
                const rp = r.data?.result ?? r.data?.data;
                const op = o.data?.result ?? o.data?.data ?? o.data;
                if (mounted) {
                    setMembership({ ...mp, binaryOverview: op?.binary });
                    setReferrals(rp?.items || []);
                }
            } catch (err) {
                toast.error(err?.response?.data?.message || 'Failed to load referrals');
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <p className="text-slate-500 text-sm">Loading...</p>
            </div>
        );
    }

    if (!membership?.isMember) {
        return (
            <div className="min-h-screen bg-slate-50 pb-24">
                <Header navigate={navigate} />
                <div className="max-w-2xl mx-auto px-4 py-12 text-center text-slate-500 text-sm">
                    You need to activate your rewards account to access this page.
                </div>
            </div>
        );
    }

    const code = membership.membership.referralCode;
    // Canonical share URL points at the public signup route. The legacy
    // `/customer-auth?ref=…` path is also registered in `AppRouter.jsx`
    // so older links shared on WhatsApp / SMS keep working — but new
    // shares should use `/signup` for the cleanest UX.
    const shareUrl = `${window.location.origin}/signup?ref=${encodeURIComponent(code)}&leg=${leg}`;
    // `shareMessage` is the URL-free invite copy. The Web Share API
    // appends `url` to `text` on most platforms, so embedding the URL
    // here would produce a duplicate link. The clipboard fallback
    // below joins message + URL with a newline. (Same fix applies to
    // MainDashboardPage.shareReferral — both files were affected.)
    const shareMessage = `Use my referral code ${code} when you sign up — get instant shopping credit on your first order!`;
    const shareTextWithUrl = `${shareMessage}\n${shareUrl}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(shareUrl)}`;

    const handleCopy = (text) => {
        navigator.clipboard?.writeText(text);
        toast.success('Copied!');
    };

    const handleWebShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Join with my code',
                    text: shareMessage,
                    url: shareUrl,
                });
            } catch { /* user cancelled */ }
        } else {
            handleCopy(shareTextWithUrl);
        }
    };

    const handleDownloadQr = async () => {
        try {
            const resp = await fetch(qrSrc);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `referral-${code}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch {
            toast.error('Could not download QR');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
            <Header navigate={navigate} />
            <div className="max-w-2xl md:max-w-7xl mx-auto px-4 md:px-8 space-y-4 md:space-y-6">
                {/* Desktop-only section title — the mobile back+title
                    header above (`md:hidden`) is suppressed on
                    desktop because the sidebar already shows
                    "Referrals" as the active item. */}
                <div className="hidden md:flex items-end justify-between gap-4 pt-6 pb-4 border-b border-slate-200/80">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                            Referrals
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">
                            Share your code, watch your team grow, and unlock new bonuses.
                        </p>
                    </div>
                </div>

                {/* Desktop layout (lg:+) — main column (2/3) carries
                    the share card + direct referrals list; side rail
                    (1/3) carries leg balance + QR. Below lg: it
                    collapses to a single column that mirrors mobile. */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 items-start">
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
                            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600 mb-2">Your Code</h3>
                            <div className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 sm:px-4 py-4 border-2 border-dashed border-slate-300 mb-4">
                                <code className="text-xl sm:text-2xl font-black tracking-widest text-slate-900 break-all min-w-0">{code}</code>
                                <button
                                    onClick={() => handleCopy(code)}
                                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 uppercase tracking-widest hover:underline shrink-0"
                                >
                                    <Copy size={14} /> Copy
                                </button>
                            </div>

                            {/* Leg Link Selector */}
                            <div className="flex bg-slate-100 rounded-lg p-1 mb-2">
                                <button
                                    onClick={() => setLeg('L')}
                                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors uppercase tracking-wider ${leg === 'L' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Left Leg Link
                                </button>
                                <button
                                    onClick={() => setLeg('R')}
                                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors uppercase tracking-wider ${leg === 'R' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    Right Leg Link
                                </button>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mt-4">
                                <button
                                    onClick={handleWebShare}
                                    className="flex flex-col items-center gap-1 bg-indigo-50 hover:bg-indigo-100 rounded-xl p-3 transition-colors"
                                >
                                    <Share2 size={20} className="text-indigo-600" />
                                    <span className="text-[11px] font-bold text-indigo-700">Share</span>
                                </button>
                                <a
                                    href={`https://wa.me/?text=${encodeURIComponent(shareTextWithUrl)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex flex-col items-center gap-1 bg-emerald-50 hover:bg-emerald-100 rounded-xl p-3 transition-colors"
                                >
                                    <MessageCircle size={20} className="text-emerald-600" />
                                    <span className="text-[11px] font-bold text-emerald-700">WhatsApp</span>
                                </a>
                                <button
                                    onClick={() => handleCopy(shareUrl)}
                                    className="flex flex-col items-center gap-1 bg-slate-100 hover:bg-slate-200 rounded-xl p-3 transition-colors"
                                >
                                    <Copy size={20} className="text-slate-700" />
                                    <span className="text-[11px] font-bold text-slate-800">Link</span>
                                </button>
                            </div>

                            <div className="mt-4 text-xs text-slate-500">
                                Share this link — friends who sign up with your code count toward your direct referrals.
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl border border-slate-200">
                            <div className="px-4 sm:px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                                    <Users size={18} /> Direct Referrals ({referrals.length})
                                </h3>
                            </div>
                            {referrals.length === 0 ? (
                                <div className="px-5 py-10 text-center text-sm text-slate-500">
                                    No referrals yet. Share your code to start earning.
                                </div>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {referrals.map((r) => (
                                        <li key={r.userId} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-semibold text-slate-900 truncate">{r.name || 'New member'}</p>
                                                <p className="text-[11px] text-slate-500 truncate">
                                                    Joined {new Date(r.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                    {' · '}{referralPlanLabel(r)}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs font-bold text-slate-600">{r.directReferralsCount} directs</p>
                                                <p className="text-[11px] text-emerald-600 font-semibold whitespace-nowrap">
                                                    {formatINR(r.lifetimeEarnings)}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    <aside className="lg:col-span-1 space-y-4 lg:sticky lg:top-32 self-start">
                        {membership.membership?.planType === 'A' && (
                            <LegBalanceCard
                                membership={membership.membership}
                                config={membership.config}
                            />
                        )}

                        <div className="bg-white rounded-2xl border border-slate-200 p-5">
                            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600 mb-3 flex items-center gap-2">
                                <QrCode size={16} /> Scan & Join
                            </h3>
                            <div className="flex flex-col items-center gap-3">
                                <img
                                    src={qrSrc}
                                    alt={`QR for referral code ${code}`}
                                    className="w-48 h-48 rounded-xl border border-slate-200 bg-white"
                                    loading="lazy"
                                />
                                <button
                                    onClick={handleDownloadQr}
                                    className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-700 hover:text-indigo-900"
                                >
                                    <Download size={14} /> Download QR
                                </button>
                                <p className="text-[11px] text-slate-500 text-center">Show this QR to friends or print it on flyers. Scanning opens the signup screen with your code pre-filled.</p>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

const LegBox = ({ label, count, activeCount, weaker, accent, icon }) => (
    <div
      className={`rounded-xl border p-3 text-center ${
        accent
          ? "bg-indigo-50 border-indigo-200"
          : weaker
            ? "bg-amber-50 border-amber-200"
            : "bg-slate-50 border-slate-200"
      }`}
    >
      {icon && (
        <div
          className={`mx-auto mb-1 ${
            accent ? "text-indigo-700" : weaker ? "text-amber-700" : "text-slate-600"
          }`}
        >
          {icon}
        </div>
      )}
      <p
        className={`text-lg font-black ${
          accent ? "text-indigo-700" : weaker ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {count} {activeCount !== undefined && <span className="opacity-70 text-sm">({activeCount})</span>}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">
        {label}
      </p>
    </div>
  );

/**
 * LegBalanceCard — surfaces left-leg vs right-leg true counts
 * to match the main dashboard exactly.
 */
const LegBalanceCard = ({ membership, config }) => {
    const binary = membership.binaryOverview;
    if (!binary) return null; // Wait until dashboard overview loads

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-900 mb-3">
                Binary Network
            </h3>

            <div className="grid grid-cols-3 gap-3 mb-3">
                <LegBox
                  label="Left Leg"
                  count={binary.leftLegTotalDownlineCount}
                  activeCount={binary.leftLegActiveDownlineCount}
                  icon={<ArrowLeft size={18} />}
                  weaker={
                    binary.leftLegDirectCount <= binary.rightLegDirectCount
                  }
                />
                <LegBox label="Pairs" count={binary.pairsCompleted} accent />
                <LegBox
                  label="Right Leg"
                  count={binary.rightLegTotalDownlineCount}
                  activeCount={binary.rightLegActiveDownlineCount}
                  icon={<ArrowRight size={18} />}
                  weaker={
                    binary.rightLegDirectCount <= binary.leftLegDirectCount
                  }
                />
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
                Refer one more friend on your{" "}
                <strong>
                  {binary.leftLegDirectCount <= binary.rightLegDirectCount
                    ? "left"
                    : "right"}{" "}
                  leg
                </strong>{" "}
                to complete pair #{binary.nextPairIndex} and earn{" "}
                <strong>
                  {binary.nextPairBonusAmount > 0
                    ? formatINR(binary.nextPairBonusAmount)
                    : "—"}
                </strong>
                .
            </p>
        </div>
    );
};

// Mobile-only header — the desktop sidebar (`md:+`) already shows
// "Referrals" as the active sidebar item, so this row is hidden
// on desktop. The hamburger opens the same sidebar as a slide-in
// drawer via `useMlmDrawer().openDrawer()`.
//
// `navigate` is left as a no-op prop so the call-site (the page's
// JSX) doesn't need to change shape; future right-side actions
// that navigate can wire it back up without a refactor.
// eslint-disable-next-line no-unused-vars
const Header = ({ navigate }) => {
    const { openDrawer } = useMlmDrawer();
    return (
        <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
            <button
                onClick={openDrawer}
                className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                aria-label="Open navigation"
            >
                <Menu size={22} className="text-slate-800" />
            </button>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Referrals</h1>
        </div>
    );
};

export default MlmReferralPage;
