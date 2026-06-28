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
  Clock,
  AlertTriangle,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../services/mlmApi";
import { buildBinaryPairHint, isTeamLegWeaker } from "@shared/utils/mlmBinaryDisplay";

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
        toast.error(err?.response?.data?.message || "Failed to load rewards data");
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
  const pending = data.pendingJoiningPayment || null;
  const [joining, setJoining] = useState(false);

  const joiningPriceConfigured = Number(cfg.joiningPackagePrice) > 0;
  const hasOpenIntent =
    pending && (pending.status === "CREATED" || pending.status === "PENDING_REVIEW");
  // Block re-initiation while a payment is open (avoids minting a
  // second row mid-review). FAILED is fine — that's a retry path.
  const canJoin = joiningPriceConfigured && !hasOpenIntent;

  const handleJoin = async () => {
    if (joining) return;
    if (!canJoin) {
      if (hasOpenIntent) {
        // Resume — route the customer back to the manual page or
        // wait for review. Should not normally reach here as the
        // banner CTA fires first.
        if (pending.redirectUrl) {
          window.location.assign(pending.redirectUrl);
        }
        return;
      }
      toast.error("Joining is not configured yet. Please contact support.");
      return;
    }
    setJoining(true);
    try {
      const res = await mlmApi.initiateJoin();
      const payload = res.data?.result ?? res.data?.data ?? res.data;
      const redirectUrl = payload?.redirectUrl;
      const paymentMode = payload?.paymentMode;
      const paymentId = payload?.paymentId;
      if (!redirectUrl) {
        throw new Error("Payment gateway did not return a redirect URL.");
      }
      if (paymentMode === "manual_qr" && paymentId) {
        // Stay in-app for the manual flow — don't trigger a hard
        // window.location.assign which would unmount the SPA.
        navigate(`/mlm/manual-payment/${paymentId}`);
        return;
      }
      // PhonePe path — hand off the browser.
      window.location.assign(redirectUrl);
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to start joining payment";
      const code = err?.response?.data?.result?.code;
      if (code === "ALREADY_MEMBER") {
        toast.error(message);
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
        {pending && (
          <PendingPaymentBanner
            pending={pending}
            onResume={() => {
              if (pending.paymentId) {
                navigate(`/mlm/manual-payment/${pending.paymentId}`);
              }
            }}
            onRetry={handleJoin}
            retrying={joining}
          />
        )}

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
            ) : hasOpenIntent ? (
              <>
                {pending?.status === "PENDING_REVIEW"
                  ? "Awaiting Approval"
                  : "Resume Payment"}{" "}
                <ChevronRight size={18} />
              </>
            ) : (
              <>
                Join Now <ChevronRight size={18} />
              </>
            )}
          </button>
          {!joiningPriceConfigured && (
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

/**
 * Three banner variants based on the pending manual-QR joining
 * payment state:
 *   - CREATED        — proof not submitted, "Resume" CTA -> manual page
 *   - PENDING_REVIEW — under admin review, no action
 *   - FAILED         — last attempt rejected, "Try Again" CTA
 */
const PendingPaymentBanner = ({ pending, onResume, onRetry, retrying }) => {
  if (pending.status === "CREATED") {
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex gap-3 items-start">
        <Clock size={22} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-amber-900">
            Finish your payment
          </p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            You've started joining for {formatINR(pending.amount)}. Complete
            the QR payment and submit your transaction id to activate.
          </p>
          <button
            onClick={onResume}
            className="mt-3 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1 hover:bg-amber-700 transition-colors">
            Resume <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (pending.status === "PENDING_REVIEW") {
    return (
      <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4 flex gap-3 items-start">
        <Clock size={22} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-blue-900">
            Your request is under review
          </p>
          <p className="text-xs text-blue-800 mt-1 leading-relaxed">
            We've received your payment proof
            {pending.transactionId ? (
              <>
                {" "}
                (txn:{" "}
                <code className="font-mono text-blue-900">
                  {pending.transactionId}
                </code>
                )
              </>
            ) : null}
            . Your status will be updated within 24 hours. You'll get a
            notification once admin approves it.
          </p>
        </div>
      </div>
    );
  }

  if (pending.status === "FAILED") {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex gap-3 items-start">
        <AlertTriangle size={22} className="text-rose-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-rose-900">
            Your last payment was not approved
          </p>
          {pending.rejectionReason && (
            <p className="text-xs text-rose-800 mt-1 leading-relaxed">
              Reason: {pending.rejectionReason}
            </p>
          )}
          <p className="text-xs text-rose-800 mt-1 leading-relaxed">
            You can retry with a fresh payment.
          </p>
          <button
            onClick={onRetry}
            disabled={retrying}
            className="mt-3 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold inline-flex items-center gap-1 hover:bg-rose-700 transition-colors disabled:opacity-70">
            {retrying ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Starting…
              </>
            ) : (
              <>
                <RefreshCcw size={14} /> Try Again
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return null;
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
        <span>
          Earn binary <strong>pair-match</strong> bonuses every time you refer a
          new pair (one on each leg) — Plan A
        </span>
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

        {/* Plan A binary pair bonus card — only shown for Plan A members. */}
        {membership.planType === "A" && (
          <PairBonusCard membership={membership} config={config} />
        )}

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

        {/* Home Shoppy franchise */}
        <button
          onClick={() => navigate("/mlm/franchise")}
          className="w-full bg-gradient-to-r from-indigo-600 to-violet-700 text-white rounded-2xl p-4 flex items-center justify-between hover:opacity-95 transition-opacity">
          <div className="flex items-center gap-3">
            <Gift size={24} />
            <div className="text-left">
              <p className="text-sm font-black uppercase tracking-wide">
                Home Shoppy
              </p>
              <p className="text-[11px] opacity-90">
                Franchise partner · Home Shoppy program
              </p>
            </div>
          </div>
          <ChevronRight size={18} />
        </button>
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

/**
 * Plan A binary pair-match bonus card — shows the customer's leg counts,
 * pairs completed, and the next-pair payout preview.
 *
 * The "weaker leg" is highlighted because that is what limits pair count.
 */
const PairBonusCard = ({ membership, config }) => {
  const binary = {
    leftLegTeamActiveCount: membership.leftLegTeamActiveCount,
    rightLegTeamActiveCount: membership.rightLegTeamActiveCount,
    pairsCompleted: membership.pairsCompleted,
    pairsRemaining: membership.pairsRemaining,
    nextPairBonusAmount: membership.nextPairBonusAmount,
    dailyPairCap: membership.dailyPairCap,
  };
  const left = Number(binary.leftLegTeamActiveCount) || 0;
  const right = Number(binary.rightLegTeamActiveCount) || 0;
  const pairs = Number(binary.pairsCompleted) || 0;
  const nextAmount = Number(binary.nextPairBonusAmount) || 0;
  const cooldown = Number(config?.planAPairBonusReleaseCooldownDays) || 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-slate-900">
          Binary Pair Bonus
        </h3>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
          Plan A
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <LegCard
          label="Left Team"
          value={left}
          highlight={isTeamLegWeaker(binary, "left")}
        />
        <LegCard
          label="Pairs Paid"
          value={pairs}
          highlight={false}
          accent
        />
        <LegCard
          label="Right Team"
          value={right}
          highlight={isTeamLegWeaker(binary, "right")}
        />
      </div>

      <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Next Pair Payout
        </p>
        <div className="flex items-baseline justify-between mt-1">
          <span className="text-lg font-black text-slate-900">
            {nextAmount > 0 ? formatINR(nextAmount) : "—"}
          </span>
          <span className="text-[11px] text-slate-500">per team match</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
          {buildBinaryPairHint(binary, formatINR)}
          {cooldown > 0 && (
            <>
              {" "}
              Pair bonuses unlock for withdrawal after {cooldown} days.
            </>
          )}
        </p>
      </div>
    </div>
  );
};

const LegCard = ({ label, value, highlight, accent }) => (
  <div
    className={`rounded-xl border p-3 text-center ${
      accent
        ? "bg-indigo-50 border-indigo-200"
        : highlight
          ? "bg-amber-50 border-amber-200"
          : "bg-slate-50 border-slate-200"
    }`}
  >
    <p
      className={`text-lg font-black ${
        accent
          ? "text-indigo-700"
          : highlight
            ? "text-amber-700"
            : "text-slate-900"
      }`}
    >
      {value}
    </p>
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">
      {label}
    </p>
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
