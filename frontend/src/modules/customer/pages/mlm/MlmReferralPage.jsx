import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Copy, Share2, Users, MessageCircle, Download, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { mlmApi } from '../../services/mlmApi';

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const MlmReferralPage = () => {
    const navigate = useNavigate();
    const [membership, setMembership] = useState(null);
    const [referrals, setReferrals] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const [m, r] = await Promise.all([
                    mlmApi.getMembership(),
                    mlmApi.getDirectReferrals({ limit: 100 }),
                ]);
                const mp = m.data?.result ?? m.data?.data;
                const rp = r.data?.result ?? r.data?.data;
                if (mounted) {
                    setMembership(mp);
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
    const shareUrl = `${window.location.origin}/signup?ref=${encodeURIComponent(code)}`;
    const shareText = `Use my referral code ${code} when you sign up — get instant shopping credit on your first order! ${shareUrl}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(shareUrl)}`;

    const handleCopy = (text) => {
        navigator.clipboard?.writeText(text);
        toast.success('Copied!');
    };

    const handleWebShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Join with my code', text: shareText, url: shareUrl });
            } catch { /* user cancelled */ }
        } else {
            handleCopy(shareText);
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
        <div className="min-h-screen bg-slate-50 pb-24">
            <Header navigate={navigate} />
            <div className="max-w-2xl mx-auto px-4 space-y-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600 mb-2">Your Code</h3>
                    <div className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl px-3 sm:px-4 py-4 border-2 border-dashed border-slate-300">
                        <code className="text-xl sm:text-2xl font-black tracking-widest text-slate-900 break-all min-w-0">{code}</code>
                        <button
                            onClick={() => handleCopy(code)}
                            className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 uppercase tracking-widest hover:underline shrink-0"
                        >
                            <Copy size={14} /> Copy
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
                            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
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
                                            {' · '}{r.planType === 'B' ? 'Plan B' : 'Plan A'}
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
        </div>
    );
};

/**
 * LegBalanceCard — surfaces left-leg-direct vs right-leg-direct counts
 * and the next pair's payout. Helps the customer see exactly where to
 * place their next referral to unlock the next pair-match bonus.
 */
const LegBalanceCard = ({ membership, config }) => {
    const left = Number(membership.leftLegDirectCount) || 0;
    const right = Number(membership.rightLegDirectCount) || 0;
    const pairs = Number(membership.pairsCompleted) || 0;
    const nextAmount = Number(membership.nextPairBonusAmount) || 0;
    const nextIdx = Number(membership.nextPairIndex) || pairs + 1;
    const cooldown = Number(config?.planAPairBonusReleaseCooldownDays) || 0;
    const weakerLeg = left <= right ? 'left' : 'right';

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">
                    Binary Tree Balance
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
                    Plan A
                </span>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-3">
                <div className={`rounded-xl border p-3 text-center ${weakerLeg === 'left' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <p className={`text-xl font-black ${weakerLeg === 'left' ? 'text-amber-700' : 'text-slate-900'}`}>{left}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">Left Leg</p>
                </div>
                <div className="rounded-xl border bg-indigo-50 border-indigo-200 p-3 text-center">
                    <p className="text-xl font-black text-indigo-700">{pairs}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">Pairs Done</p>
                </div>
                <div className={`rounded-xl border p-3 text-center ${weakerLeg === 'right' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <p className={`text-xl font-black ${weakerLeg === 'right' ? 'text-amber-700' : 'text-slate-900'}`}>{right}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">Right Leg</p>
                </div>
            </div>

            <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
                <div className="flex items-baseline justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Next Pair Payout
                    </p>
                    <span className="text-base font-black text-slate-900">
                        {nextAmount > 0 ? formatINR(nextAmount) : '—'}
                    </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Refer one more friend on your <strong>{weakerLeg} leg</strong> to complete pair #{nextIdx}.
                    {cooldown > 0 && (
                        <> Pair bonuses unlock for withdrawal after {cooldown} days.</>
                    )}
                </p>
            </div>
        </div>
    );
};

const Header = ({ navigate }) => (
    <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
        <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
        >
            <ChevronLeft size={22} className="text-slate-800" />
        </button>
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Referrals</h1>
    </div>
);

export default MlmReferralPage;
