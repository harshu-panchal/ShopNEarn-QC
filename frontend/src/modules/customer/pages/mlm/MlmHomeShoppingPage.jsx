import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Gift, CheckCircle2, Lock, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { mlmApi } from '../../services/mlmApi';
import { useMlmDrawer } from './MlmLayout';

/**
 * MLM Home Shopping (Plan B exclusive).
 *
 * Eligibility logic (mirror of backend `claimHomeShopping`):
 *   - Must be MLM member.
 *   - Must be Plan B (auto-upgraded after ₹30,000 lifetime Plan A earnings).
 *   - `homeShoppingUnlocked === true`.
 *   - `homeShoppingClaimed === false` (single-use).
 *
 * Workflow:
 *   1. Show "locked" view for non-eligible members with progress to upgrade.
 *   2. Show "claim" CTA for unlocked-but-unclaimed members.
 *   3. Show "already claimed" success view for claimed members; provide
 *      a CTA that links to the home-shopping product page (resolved from
 *      `config.homeShoppingProductId`).
 */
const MlmHomeShoppingPage = () => {
    const navigate = useNavigate();
    const { openDrawer } = useMlmDrawer();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [claiming, setClaiming] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await mlmApi.getMembership();
            setData(res.data?.result ?? res.data?.data);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleClaim = async () => {
        setClaiming(true);
        try {
            await mlmApi.claimHomeShopping();
            toast.success('Home Shopping unlocked! Add the product to your cart.');
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Could not claim');
        } finally {
            setClaiming(false);
        }
    };

    const m = data?.membership;
    const cfg = data?.config || {};
    const isPlanB = m?.planType === 'B';
    const isUnlocked = !!m?.homeShoppingUnlocked;
    const isClaimed = !!m?.homeShoppingClaimed;
    const goal = Number(cfg.planBAutoUpgradeAtPlanALifetimeEarnings) || 30000;
    const progress = Math.min(100, Math.round(((m?.lifetimePlanAEarnings || 0) / goal) * 100));

    return (
        <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
            {/* Mobile-only hamburger + title — desktop sidebar
                already surfaces "Home Shopping" as the active item,
                and the hamburger opens that same sidebar as a
                slide-in drawer on phones. */}
            <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={openDrawer}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                    aria-label="Open navigation"
                >
                    <Menu size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Home Shopping</h1>
            </div>

            <div className="max-w-2xl md:max-w-5xl mx-auto px-4 md:px-8 space-y-4 md:space-y-6">
                <div className="hidden md:flex items-end justify-between gap-4 pt-6 pb-4 border-b border-slate-200/80">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                            Home Shopping
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">
                            Premium-tier benefit unlocked at ₹{goal.toLocaleString('en-IN')} lifetime Plan A earnings.
                        </p>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-2xl p-5">
                    <Gift size={28} />
                    <h2 className="text-2xl font-black mt-2">Plan B Exclusive</h2>
                    <p className="text-sm opacity-90 mt-1">
                        Claim a premium Home Shopping product worth up to ₹{(cfg.homeShoppingProductCreditValue || 100000).toLocaleString('en-IN')} as part of your Plan B benefits.
                    </p>
                </div>

                {/* Action card + Commission preview — stacked on
                    mobile, side-by-side on `md:+`. Both cards have
                    enough density to fit a 2-col layout cleanly. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 items-start">
                    <div>
                        {loading ? (
                            <div className="text-center text-sm text-slate-500 py-8">Loading...</div>
                        ) : !data?.isMember ? (
                            <Locked
                                icon={Lock}
                                title="Activate Your Rewards Account First"
                                sub="Activate your rewards account, refer friends, hit ₹30k Plan A earnings, then claim your Home Shopping benefit."
                            />
                        ) : !isPlanB || !isUnlocked ? (
                            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                                <div className="flex items-center gap-2 text-slate-700">
                                    <Lock size={18} />
                                    <h3 className="text-base font-bold">Plan B Required</h3>
                                </div>
                                <p className="text-sm text-slate-600">
                                    Reach ₹{goal.toLocaleString('en-IN')} in lifetime Plan A earnings to auto-upgrade and unlock Home Shopping.
                                </p>
                                <div>
                                    <div className="flex items-center justify-between text-xs mb-1.5">
                                        <span className="text-slate-600 font-semibold">Progress</span>
                                        <span className="text-slate-900 font-bold">₹{(m?.lifetimePlanAEarnings || 0).toLocaleString('en-IN')} / ₹{goal.toLocaleString('en-IN')}</span>
                                    </div>
                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-amber-500" style={{ width: `${progress}%` }} />
                                    </div>
                                </div>
                            </div>
                        ) : isClaimed ? (
                            <div className="bg-white border border-emerald-200 rounded-2xl p-5">
                                <div className="flex items-center gap-2 text-emerald-700">
                                    <CheckCircle2 size={20} />
                                    <h3 className="text-base font-bold">Home Shopping Claimed</h3>
                                </div>
                                <p className="text-sm text-slate-600 mt-2">
                                    Your Home Shopping benefit is active. Add the product to your cart and complete checkout.
                                </p>
                                {cfg.homeShoppingProductId && (
                                    <button
                                        onClick={() => navigate(`/product/${cfg.homeShoppingProductId}`)}
                                        className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"
                                    >
                                        <ShoppingCart size={16} /> View Product
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="bg-white border border-amber-200 rounded-2xl p-5">
                                <div className="flex items-center gap-2 text-amber-700">
                                    <Gift size={20} />
                                    <h3 className="text-base font-bold">Ready to Claim</h3>
                                </div>
                                <p className="text-sm text-slate-600 mt-2">
                                    One-time claim. Once claimed, you can purchase the Home Shopping product
                                    and the entire upline will earn Plan B Home Shopping commissions.
                                </p>
                                <button
                                    onClick={handleClaim}
                                    disabled={claiming}
                                    className="mt-4 w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 disabled:bg-slate-300"
                                >
                                    {claiming ? 'Claiming...' : 'Claim Home Shopping'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Commission preview — informational only */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-3">
                            How upline earns when you buy
                        </h3>
                        <ul className="space-y-2 text-sm text-slate-700">
                            <li className="flex justify-between"><span>L1 (Direct Sponsor)</span><b>{cfg.homeShoppingCommissions?.salesPercent ?? 10}%</b></li>
                            <li className="flex justify-between"><span>L2 (Grandsponsor)</span><b>{cfg.homeShoppingCommissions?.referralPercent ?? 5}%</b></li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Locked = ({ icon: Icon, title, sub }) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 mx-auto flex items-center justify-center text-slate-500">
            <Icon size={22} />
        </div>
        <h3 className="text-base font-bold text-slate-900 mt-3">{title}</h3>
        <p className="text-sm text-slate-600 mt-1">{sub}</p>
    </div>
);

export default MlmHomeShoppingPage;
