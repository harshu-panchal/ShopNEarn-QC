import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Users,
  Wallet,
  Award,
  Send,
  Gift,
  ArrowDownRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../services/mlmApi";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * MLM Dashboard — single-page overview of the customer's MLM status.
 *
 * Three states:
 *  1. MLM disabled  -> show generic placeholder (admin hasn't turned it on)
 *  2. Not a member  -> show "Join Now" CTA (buys the joining-package SKU)
 *  3. Active member -> full dashboard (referral code, wallets, network, CTAs)
 */
const MlmDashboardPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await mlmApi.getMembership();
        const payload = res.data?.result ?? res.data?.data ?? res.data;
        if (mounted) setData(payload);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Failed to load MLM data");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (!data || !data.enabled) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <Header title="Rewards Program" navigate={navigate} />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <Sparkles size={56} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-lg font-semibold text-slate-800">Coming soon!</h2>
          <p className="text-sm text-slate-500 mt-2">
            Our customer rewards program will go live shortly. Check back soon.
          </p>
        </div>
      </div>
    );
  }

  if (!data.isMember) {
    return <NotMemberView data={data} navigate={navigate} />;
  }

  return <MemberDashboardView data={data} navigate={navigate} />;
};

const Header = ({ title, navigate, right = null }) => (
  <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
    <button
      onClick={() => navigate(-1)}
      className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1">
      <ChevronLeft size={22} className="text-slate-800" />
    </button>
    <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
      {title}
    </h1>
    {right}
  </div>
);

const NotMemberView = ({ data, navigate }) => {
  const cfg = data.config || {};
  const [joining, setJoining] = useState(false);

  const joiningPriceConfigured = Number(cfg.joiningPackagePrice) > 0;
  const canJoin = joiningPriceConfigured;

  const handleJoin = async () => {
    if (joining) return;
    if (!canJoin) {
      toast.error("Joining is not configured yet. Please contact support.");
      return;
    }
    setJoining(true);
    try {
      const res = await mlmApi.initiateJoin();
      const payload = res.data?.result ?? res.data?.data ?? res.data;
      const redirectUrl = payload?.redirectUrl;
      if (!redirectUrl) {
        throw new Error("Payment gateway did not return a redirect URL.");
      }
      // Hand off to PhonePe. On success the gateway brings the customer
      // back to /payment-status, the webhook fires activation, and the
      // membership row appears on next dashboard load.
      window.location.assign(redirectUrl);
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to start joining payment";
      const code = err?.response?.data?.result?.code;
      if (code === "ALREADY_MEMBER") {
        toast.error(message);
        // Refresh the dashboard so the now-member view appears.
        navigate(0);
      } else if (code === "JOINING_PRICE_UNCONFIGURED" || code === "MLM_DISABLED") {
        toast.error(message);
      } else {
        toast.error(message);
      }
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Header title="Rewards Program" navigate={navigate} />
      <div className="max-w-2xl mx-auto px-4 space-y-4">
        <div className="rounded-2xl p-6 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 text-white shadow-lg shadow-indigo-500/20">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-80">
            <Award size={16} />
            Become a member
          </div>
          <h2 className="text-2xl font-black mt-2">Join the Rewards Program</h2>
          <p className="text-sm opacity-90 mt-2 leading-relaxed">
            Pay {formatINR(cfg.joiningPackagePrice)} once and get{" "}
            <strong>{formatINR(cfg.joiningPackageShoppingWalletCredit)}</strong>{" "}
            shopping credit instantly, plus access to referral bonuses on every
            friend you bring in.
          </p>
          <button
            onClick={handleJoin}
            disabled={joining || !canJoin}
            className="mt-5 w-full bg-white text-indigo-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-indigo-50 transition-colors disabled:opacity-70 disabled:cursor-not-allowed">
            {joining ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Opening payment…
              </>
            ) : (
              <>
                Join Now <ChevronRight size={18} />
              </>
            )}
          </button>
          {!canJoin && (
            <p className="mt-2 text-[11px] opacity-90">
              Joining is being set up. Please check back soon.
            </p>
          )}
        </div>

        <BenefitsCard cfg={cfg} />
      </div>
    </div>
  );
};

const BenefitsCard = ({ cfg }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
    <h3 className="text-base font-bold text-slate-900">What you get</h3>
    <ul className="space-y-2 text-sm text-slate-700">
      <li className="flex items-start gap-2">
        <Gift size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <span>
          <strong>{formatINR(cfg.joiningPackageShoppingWalletCredit)}</strong>{" "}
          shopping credit on join (redeemable on any product)
        </span>
      </li>
      <li className="flex items-start gap-2">
        <Users size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
        <span>Earn milestone bonuses for every friend you refer (Plan A)</span>
      </li>
      <li className="flex items-start gap-2">
        <Award size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <span>
          Auto-upgrade to Plan B at{" "}
          {formatINR(cfg.planBAutoUpgradeAtPlanALifetimeEarnings)} lifetime
          earnings — unlocks repurchase + mentor royalty bonuses on every paid
          downline order
        </span>
      </li>
      <li className="flex items-start gap-2">
        <Wallet size={18} className="text-violet-600 mt-0.5 flex-shrink-0" />
        <span>
          Withdraw to your bank or UPI (min {formatINR(cfg.withdrawalMinAmount)}
          )
        </span>
      </li>
    </ul>
  </div>
);

const MemberDashboardView = ({ data, navigate }) => {
  const { membership, wallet, config } = data;
  const plan = membership.planType === "B" ? "Plan B" : "Plan A";
  const planColor =
    membership.planType === "B"
      ? "from-amber-500 to-orange-600"
      : "from-indigo-500 to-violet-700";

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Header title="My Rewards" navigate={navigate} />
      <div className="max-w-2xl mx-auto px-4 space-y-4">
        {/* Plan badge */}
        <div
          className={`rounded-2xl p-5 bg-gradient-to-br ${planColor} text-white shadow-lg`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest opacity-80">
                Membership
              </p>
              <h2 className="text-2xl font-black mt-1">{plan}</h2>
              <p className="text-xs opacity-80 mt-1">
                Joined{" "}
                {new Date(membership.joinedAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
            <Award size={48} className="opacity-80" />
          </div>
          {membership.planType === "A" && (
            <div className="mt-4 bg-white/15 rounded-lg p-3 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="opacity-90">Progress to Plan B</span>
                <span className="font-bold">
                  {formatINR(membership.lifetimePlanAEarnings || 0)} /{" "}
                  {formatINR(config.planBAutoUpgradeAtPlanALifetimeEarnings)}
                </span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, ((membership.lifetimePlanAEarnings || 0) / Math.max(config.planBAutoUpgradeAtPlanALifetimeEarnings, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Wallet split */}
        <div className="grid grid-cols-2 gap-3">
          <WalletCard
            label="Shopping Credit"
            amount={wallet.shoppingBalance}
            hint="Use at checkout"
            color="bg-emerald-50 text-emerald-700"
          />
          <WalletCard
            label="Earnings"
            amount={wallet.earningsBalance}
            hint={`Withdrawable (min ${formatINR(config.withdrawalMinAmount)})`}
            color="bg-violet-50 text-violet-700"
          />
        </div>

        {wallet.pendingBalance > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <ArrowDownRight
              size={20}
              className="text-amber-600 flex-shrink-0"
            />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                Pending
              </p>
              <p className="text-sm text-amber-900">
                {formatINR(wallet.pendingBalance)} releases after the return
                window.
              </p>
            </div>
          </div>
        )}

        {/* Referral card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-slate-900">
              Your Referral Code
            </h3>
            <Link
              to="/mlm/referrals"
              className="text-xs font-semibold text-indigo-600">
              Manage
            </Link>
          </div>
          <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border-2 border-dashed border-slate-300">
            <code className="text-xl font-black tracking-widest text-slate-900">
              {membership.referralCode}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(membership.referralCode);
                toast.success("Copied to clipboard");
              }}
              className="text-xs font-bold text-indigo-600 uppercase tracking-widest hover:underline">
              Copy
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Directs" value={membership.directReferralsCount} />
          <StatCard label="Network" value={membership.totalDownlineCount} />
          <StatCard
            label="Lifetime"
            value={formatINR(
              (membership.lifetimePlanAEarnings || 0) +
                (membership.lifetimePlanBEarnings || 0),
            )}
          />
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate("/mlm/earnings")}
            className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col items-center gap-2 hover:bg-slate-50 transition-colors">
            <Wallet size={22} className="text-violet-600" />
            <span className="text-xs font-bold text-slate-800">
              Earnings History
            </span>
          </button>
          <button
            onClick={() => navigate("/mlm/withdrawals")}
            className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col items-center gap-2 hover:bg-slate-50 transition-colors">
            <Send size={22} className="text-emerald-600" />
            <span className="text-xs font-bold text-slate-800">Withdraw</span>
          </button>
        </div>

        {/* Plan B exclusive: Home Shopping CTA */}
        {membership?.planType === "B" && (
          <button
            onClick={() => navigate("/mlm/home-shopping")}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl p-4 flex items-center justify-between hover:opacity-95 transition-opacity">
            <div className="flex items-center gap-3">
              <Gift size={24} />
              <div className="text-left">
                <p className="text-sm font-black uppercase tracking-wide">
                  Home Shopping
                </p>
                <p className="text-[11px] opacity-90">
                  Plan B exclusive · Claim now
                </p>
              </div>
            </div>
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

const WalletCard = ({ label, amount, hint, color }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-4">
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
      {label}
    </p>
    <p className="text-xl font-black text-slate-900 mt-1">
      {formatINR(amount)}
    </p>
    <span
      className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {hint}
    </span>
  </div>
);

const StatCard = ({ label, value }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-3 text-center">
    <p className="text-base font-black text-slate-900">{value}</p>
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">
      {label}
    </p>
  </div>
);

export default MlmDashboardPage;
