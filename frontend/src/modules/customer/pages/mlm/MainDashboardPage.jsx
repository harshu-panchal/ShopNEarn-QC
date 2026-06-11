import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ChevronRight,
  Users,
  Wallet,
  Award,
  Send,
  Gift,
  Sparkles,
  Loader2,
  Clock,
  AlertTriangle,
  RefreshCcw,
  TrendingUp,
  Copy,
  Share2,
  Link as LinkIcon,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Hourglass,
  GitBranch,
  Network,
  Crown,
  ShieldCheck,
  Rocket,
  Mail,
  Phone,
  BadgeCheck,
  CalendarDays,
  UserCircle2,
  KeyRound,
  Eye,
  EyeOff,
  ShieldAlert,
  X,
  Menu,
  Edit2,
} from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../services/mlmApi";
import { customerApi } from "../../services/customerApi";
import { useAuth } from "@core/context/AuthContext";
import { useMlmDrawer } from "./MlmLayout";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Customer-MLM-rebuild Phase 8 — Main Dashboard page.
 *
 * One-shot read from `GET /api/customer/mlm/dashboard-overview` powers
 * every card. Three states:
 *   1. Rewards disabled  → coming-soon placeholder.
 *   2. No membership yet → "Join Now" CTA (or "Resume Payment" if a
 *      pending joining payment is in flight).
 *   3. Active OR registered-unpaid member → full dashboard.
 */
const MainDashboardPage = () => {
  const navigate = useNavigate();
  // Pull the customer profile from the auth context so the
  // Profile Card can render contact info (name, phone, email,
  // user id, member-since) without an extra round-trip — the
  // /customer/profile call already ran during AuthProvider mount.
  const { user, login } = useAuth();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [pendingJoining, setPendingJoining] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [overviewRes, membershipRes] = await Promise.all([
          mlmApi.getDashboardOverview(),
          mlmApi.getMembership(),
        ]);
        if (!mounted) return;
        const overviewPayload =
          overviewRes.data?.result ?? overviewRes.data?.data ?? overviewRes.data;
        setOverview(overviewPayload);
        const membershipPayload =
          membershipRes.data?.result ?? membershipRes.data?.data ?? membershipRes.data;
        setPendingJoining(membershipPayload?.pendingJoiningPayment || null);
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
        <Loader2 className="w-7 h-7 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!overview || !overview.enabled) {
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

  if (!overview.isMember) {
    return (
      <NotMemberView
        overview={overview}
        pendingJoining={pendingJoining}
        navigate={navigate}
      />
    );
  }
  return <MemberDashboard overview={overview} navigate={navigate} user={user} login={login} />;
};

// Page-level mobile header. Hidden on desktop (`md:hidden`) because
// the `MlmLayout` sidebar already provides section navigation;
// rendering this on top of the sidebar's "My Rewards" brand would
// duplicate the label. On mobile (no fixed sidebar) this is the
// only navigation chrome, so the hamburger button is the user's
// only way into the new mobile drawer.
//
// `navigate` is intentionally still threaded in as a prop even
// though we no longer call it — keeps the call-sites stable and
// makes any future "right-side action that navigates" trivial to
// add back.
// eslint-disable-next-line no-unused-vars
const Header = ({ title, navigate, right = null }) => {
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
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
        {title}
      </h1>
      {right}
    </div>
  );
};

// Desktop-only page header. Renders inside the main content column
// (so it scrolls with the page, unlike the mobile sticky bar) and
// gives the dashboard a clear section title without duplicating the
// sidebar's brand strip. Hidden on mobile (`hidden md:flex`) — the
// `Header` component above owns mobile chrome.
const DesktopPageHeader = ({ title, subtitle }) => (
  <div className="hidden md:flex items-end justify-between gap-4 pt-6 pb-4 border-b border-slate-200/80 mb-6">
    <div>
      <h1 className="text-2xl font-black text-slate-900 tracking-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
      )}
    </div>
  </div>
);

/* =================================================================
   NotMemberView — sign-up flow CTAs (mirrors the legacy
   MlmDashboardPage NotMemberView, lightly adapted for the new
   overview payload shape).
   ================================================================ */
const NotMemberView = ({ overview, pendingJoining, navigate }) => {
  const cfg = overview.config || {};
  const pending = pendingJoining || null;
  const [joining, setJoining] = useState(false);

  const joiningPriceConfigured = Number(cfg.joiningPackagePrice) > 0;
  const hasOpenIntent =
    pending && (pending.status === "CREATED" || pending.status === "PENDING_REVIEW");
  const canJoin = joiningPriceConfigured && !hasOpenIntent;

  const handleJoin = async () => {
    if (joining) return;
    if (!canJoin) {
      if (hasOpenIntent && pending.paymentId) {
        navigate(`/mlm/manual-payment/${pending.paymentId}`);
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
      if (!redirectUrl) throw new Error("Payment gateway did not return a redirect URL.");
      if (paymentMode === "manual_qr" && paymentId) {
        navigate(`/mlm/manual-payment/${paymentId}`);
        return;
      }
      window.location.assign(redirectUrl);
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to start joining payment";
      toast.error(message);
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Header title="Rewards Program" navigate={navigate} />
      <div className="max-w-2xl md:max-w-3xl mx-auto px-4 md:px-8 space-y-4">
        <DesktopPageHeader
          title="Rewards Program"
          subtitle="Activate your account to start earning."
        />
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
            Activate to start earning
          </div>
          <h2 className="text-2xl font-black mt-2">
            Unlock the Rewards Program
          </h2>
          <p className="text-sm opacity-90 mt-2 leading-relaxed">
            Pay {formatINR(cfg.joiningPackagePrice)} once and get{" "}
            <strong>{formatINR(cfg.joiningPackageShoppingWalletCredit)}</strong>{" "}
            shopping credit instantly, plus access to referral bonuses on every
            friend you bring in.
          </p>
          <button
            onClick={handleJoin}
            disabled={joining || !canJoin}
            className="mt-5 w-full bg-white text-indigo-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-indigo-50 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {joining ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Opening payment…
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
                Activate Now <ChevronRight size={18} />
              </>
            )}
          </button>
          {!joiningPriceConfigured && (
            <p className="mt-2 text-[11px] opacity-90">
              Joining is being set up. Please check back soon.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const PendingPaymentBanner = ({ pending, onResume, onRetry, retrying }) => {
  if (pending.status === "CREATED") {
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex gap-3 items-start">
        <Clock size={22} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-amber-900">Finish your payment</p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            You've started joining for {formatINR(pending.amount)}. Complete the
            QR payment and submit your transaction id to activate.
          </p>
          <button
            onClick={onResume}
            className="mt-3 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1 hover:bg-amber-700 transition-colors"
          >
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
            We've received your payment proof. Status will be updated within 24
            hours.
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
          <button
            onClick={onRetry}
            disabled={retrying}
            className="mt-3 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold inline-flex items-center gap-1 hover:bg-rose-700 transition-colors disabled:opacity-70"
          >
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

/* =================================================================
   MemberDashboard — full dashboard for ACTIVE + REGISTERED_UNPAID.
   Surfaces every piece of data demanded by the brief:
     earning total, total referrals, active customers, payout,
     wallet balance, left/right leg counts, pending payout, today's
     earnings, next-pair preview.
   ================================================================ */
const MemberDashboard = ({ overview, navigate, user, login }) => {
  const { membership, wallet, earnings, referrals, binary, payout, dailyCap, config } = overview;
  const isUnpaid = !!membership.isRegisteredUnpaid;

  // Canonical share URL — every signup that lands on `/signup?ref=…`
  // pre-fills the referral code, so this is the only link the
  // customer ever needs to hand out.
  const shareUrl = membership.referralCode
    ? `${window.location.origin}/signup?ref=${membership.referralCode}`
    : "";

  const copyReferralCode = () => {
    if (!membership.referralCode) return;
    navigator.clipboard?.writeText(membership.referralCode);
    toast.success("Referral code copied!");
  };

  const copyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl);
    toast.success("Signup link copied!");
  };

  const shareReferral = async () => {
    if (!membership.referralCode) return;
    // The Web Share API on most platforms (Android, iOS, WhatsApp,
    // Telegram, etc.) appends `url` to the end of `text` when both are
    // supplied — so embedding the URL inside `text` AND passing `url`
    // produces a duplicate link in the final share payload. We pass
    // them separately so the platform composes the message cleanly:
    //   - `text` = the human-readable invite (no URL)
    //   - `url`  = the canonical signup link (added by the OS)
    //
    // The clipboard fallback joins them with a newline so the user
    // still gets a single coherent message when navigator.share is
    // unavailable.
    const message = `Join me on the rewards program! Sign up with my referral code ${membership.referralCode}.`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Join the Rewards Program",
          text: message,
          url: shareUrl,
        });
        return;
      }
      navigator.clipboard?.writeText(`${message}\n${shareUrl}`);
      toast.success("Share link copied!");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
      <Header title="My Rewards" navigate={navigate} />
      <div className="max-w-3xl md:max-w-7xl mx-auto px-4 md:px-8 space-y-4 md:space-y-6">
        <DesktopPageHeader
          title="My Rewards"
          subtitle="Track your earnings, network, and referrals at a glance."
        />

        {/* Status / activation banner — full width on every breakpoint
            because it's a single high-priority message. */}
        {isUnpaid && (
          <ActivationCta
            membership={membership}
            joiningPrice={config.joiningPackagePrice}
            navigate={navigate}
          />
        )}

        {/* Hero row (md:+) — current plan card on the left (8 cols)
            and referral-code card on the right (4 cols). On mobile
            this collapses to a single stacked column so the existing
            UX is preserved.

            The plan card is the visual anchor of the page so it gets
            the wider slot; the referral code is a "constantly needed"
            utility so it lives on the right rail where it stays in
            the viewport even when the main column scrolls past it. */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
          <div className="md:col-span-7 lg:col-span-8">
            <MyPlanCard
              membership={membership}
              earnings={earnings}
              config={config}
            />
          </div>
          <div className="md:col-span-5 lg:col-span-4">
            <ReferralCodeCard
              code={membership.referralCode}
              shareUrl={shareUrl}
              onCopyCode={copyReferralCode}
              onCopyLink={copyShareLink}
              onShare={shareReferral}
            />
          </div>
        </div>

        {/* Profile snapshot — identity card placed between the hero
            row (plan + referral code) and the wallet row so the
            customer's name + contact info anchors the "who you are"
            context before the "what you've earned" data. Full-width
            on every breakpoint; the internal layout is the one that
            adapts (single column on mobile, avatar+name on the left
            with a 4-cell info grid on desktop). */}
        <ProfileCard user={user} membership={membership} login={login} />

        {/* Wallet snapshot — 2-up on every breakpoint. Pinned above
            the KPI strip so the customer always sees their available
            balances first. */}
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3 md:gap-4">
          <WalletCard
            label="Earnings Wallet"
            amount={wallet.earningsBalance}
            hint={`Withdrawable (min ${formatINR(config.withdrawalMinAmount)})`}
            tone="violet"
            icon={<Wallet size={18} />}
          />
          <WalletCard
            label="Shopping Wallet"
            amount={wallet.shoppingBalance}
            hint="Redeem at checkout"
            tone="emerald"
            icon={<Gift size={18} />}
          />
        </div>

        {/* Pending bucket banner */}
        {wallet.pendingBalance > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <Hourglass size={20} className="text-amber-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                Pending
              </p>
              <p className="text-sm text-amber-900">
                {formatINR(wallet.pendingBalance)} releases after the cooldown.
              </p>
            </div>
          </div>
        )}

        {/* KPI strip — 8 stat tiles arranged as a 2-row × 4-column
            grid on every breakpoint above mobile (`sm:grid-cols-4`).
            Two rows of large, glanceable cards reads cleaner than a
            single thin row of 8 on wide desktops — the extra
            vertical space lets each tile breathe and use a larger
            value type. Mobile stays at the existing 2-col layout. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
          <StatTile
            label="Total Earnings"
            value={formatINR(earnings.lifetime)}
            icon={<TrendingUp size={18} />}
            tone="indigo"
          />
          <StatTile
            label="Today"
            value={formatINR(earnings.today)}
            icon={<Sparkles size={18} />}
            tone="amber"
          />
          <StatTile
            label="This Month"
            value={formatINR(earnings.thisMonth)}
            icon={<TrendingUp size={18} />}
            tone="emerald"
          />
          <StatTile
            label="Pending Payout"
            value={formatINR(payout.pendingGross)}
            icon={<Send size={18} />}
            tone="rose"
            subtle={`${payout.pendingCount} request${payout.pendingCount === 1 ? "" : "s"}`}
          />
          <StatTile
            label="Total Referrals"
            value={referrals.directReferralsCount}
            icon={<Users size={18} />}
            tone="indigo"
            subtle={`${referrals.directActive} active`}
          />
          <StatTile
            label="Active Customers"
            value={referrals.activeCustomersInNetwork}
            icon={<CheckCircle2 size={18} />}
            tone="emerald"
            subtle="in network"
          />
          <StatTile
            label="Network Size"
            value={referrals.totalDownlineCount}
            icon={<Network size={18} />}
            tone="violet"
            subtle={`${referrals.registeredUnpaidInNetwork} pending`}
          />
          <StatTile
            label="Pairs Completed"
            value={binary.pairsCompleted}
            icon={<GitBranch size={18} />}
            tone="amber"
            subtle={`Next: ${binary.nextPairBonusAmount > 0 ? formatINR(binary.nextPairBonusAmount) : "—"}`}
          />
        </div>

        {/* Bottom row (md:+) — Binary Network panel on the left
            (8 cols, the data-heavy summary) and Quick Links on the
            right (4 cols, three navigation tiles). The right column
            stacks the quick-link grid + the daily-cap meter so the
            two side rails stay balanced visually. */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
          <div className="md:col-span-7 lg:col-span-8">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 h-full">
              <h3 className="text-base font-bold text-slate-900 mb-3">
                Binary Network
              </h3>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <LegBox
                  label="Left Leg"
                  count={binary.leftLegDirectCount}
                  icon={<ArrowLeft size={18} />}
                  weaker={
                    binary.leftLegDirectCount <= binary.rightLegDirectCount
                  }
                />
                <LegBox label="Pairs" count={binary.pairsCompleted} accent />
                <LegBox
                  label="Right Leg"
                  count={binary.rightLegDirectCount}
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
          </div>

          <div className="md:col-span-5 lg:col-span-4 space-y-3 md:space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <QuickLink
                label="Genealogy"
                icon={<Network size={20} />}
                to="/mlm/genealogy/tree"
              />
              <QuickLink
                label="Earnings"
                icon={<TrendingUp size={20} />}
                to="/mlm/payouts/earnings"
              />
              <QuickLink
                label="Withdraw"
                icon={<Send size={20} />}
                to="/mlm/payouts/withdrawals"
              />
            </div>
            {dailyCap.cap > 0 && (
              <DailyCapMeter cap={dailyCap.cap} used={dailyCap.usedToday} />
            )}
          </div>
        </div>

        {/* Plan B Home Shopping CTA — full width on every breakpoint
            because it's a tier-exclusive callout, not a stat. */}
        {membership.planType === "B" && membership.homeShoppingUnlocked && (
          <button
            onClick={() => navigate("/mlm/home-shopping")}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl p-4 flex items-center justify-between hover:opacity-95 transition-opacity"
          >
            <div className="flex items-center gap-3">
              <Gift size={24} />
              <div className="text-left">
                <p className="text-sm font-black uppercase tracking-wide">
                  Home Shopping
                </p>
                <p className="text-[11px] opacity-90">Premium-tier exclusive</p>
              </div>
            </div>
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

const ActivationCta = ({ membership, joiningPrice, navigate }) => (
  <div className="rounded-2xl bg-amber-50 border-2 border-amber-300 p-4">
    <div className="flex gap-3 items-start">
      <Sparkles size={22} className="text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-bold text-amber-900">
          Activate to unlock your earnings
        </p>
        <p className="text-xs text-amber-800 mt-1 leading-relaxed">
          Your referral code is already live — invite friends now! Pay{" "}
          <strong>{formatINR(joiningPrice)}</strong> once to activate your
          earning plan and start receiving bonuses from your team.
        </p>
        <button
          onClick={async () => {
            try {
              const res = await mlmApi.initiateJoin();
              const payload = res.data?.result ?? res.data?.data ?? res.data;
              const redirectUrl = payload?.redirectUrl;
              const paymentMode = payload?.paymentMode;
              const paymentId = payload?.paymentId;
              if (paymentMode === "manual_qr" && paymentId) {
                navigate(`/mlm/manual-payment/${paymentId}`);
                return;
              }
              if (redirectUrl) window.location.assign(redirectUrl);
            } catch (err) {
              toast.error(
                err?.response?.data?.message ||
                  "Failed to start activation payment",
              );
            }
          }}
          className="mt-3 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1 hover:bg-amber-700 transition-colors"
        >
          Activate Now <ChevronRight size={14} />
        </button>
      </div>
    </div>
  </div>
);

/**
 * MyPlanCard
 *
 * Surfaces the customer's CURRENT plan as a first-class card:
 *
 *   - Plan A      → indigo/violet hero, lifetime Plan-A earnings,
 *                   and a progress bar toward the Plan B upgrade
 *                   threshold (when one is configured).
 *   - Plan B      → amber/gold "Premium" hero highlighting Home
 *                   Shopping access + mentor royalties.
 *   - Unpaid      → amber "Activation Pending" hero with a hint
 *                   to pay the joining fee. The ActivationCta banner
 *                   above the plan card already drives the actual
 *                   activation CTA, so this card only sets context.
 */
const MyPlanCard = ({ membership, earnings, config }) => {
  const isUnpaid = !!membership.isRegisteredUnpaid;
  const isPlanB = membership.planType === "B";

  // Plan A → Plan B upgrade progress
  const upgradeThreshold = Number(config?.planBAutoUpgradeAtPlanALifetimeEarnings) || 0;
  const planAEarnings = Number(earnings?.planA) || 0;
  const upgradePct = upgradeThreshold > 0
    ? Math.min(100, (planAEarnings / upgradeThreshold) * 100)
    : 0;
  const remainingForUpgrade = Math.max(0, upgradeThreshold - planAEarnings);

  const memberSince = membership.joinedAt
    ? new Date(membership.joinedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  // Tone driven by plan / status. Each branch returns the heading,
  // tagline, perks list, and tailwind colour set so the component
  // body itself stays declarative.
  let planName;
  let planTagline;
  let bgClass;
  let statusBadge;
  let Icon;
  let perks;
  if (isUnpaid) {
    planName = "Activation Pending";
    planTagline = "Pay the one-time fee to unlock your earning plan.";
    bgClass = "from-amber-500 via-orange-500 to-rose-500";
    statusBadge = { label: "Awaiting Activation", className: "bg-white/20" };
    Icon = Hourglass;
    perks = [
      "Your referral code is already live — start inviting friends now.",
      "Every signup that activates while you're unpaid is HELD for you.",
      "Pair-match bonuses release the moment your activation is confirmed.",
    ];
  } else if (isPlanB) {
    planName = "Plan B · Premium";
    planTagline = "You're on the highest tier. Enjoy royalty earnings & Home Shopping.";
    bgClass = "from-amber-500 via-orange-500 to-pink-600";
    statusBadge = { label: "Premium", className: "bg-white/25" };
    Icon = Crown;
    perks = [
      "Repurchase bonus on every downline purchase across 12 levels.",
      "Mentor royalties on each direct's commissions.",
      membership.homeShoppingUnlocked
        ? "Home Shopping unlocked — claim your premium product."
        : "Home Shopping ready to unlock from your benefits.",
    ];
  } else {
    planName = "Plan A";
    planTagline = "Build your binary tree and earn on every matched pair.";
    bgClass = "from-indigo-600 via-violet-600 to-purple-700";
    statusBadge = { label: "Active", className: "bg-emerald-400/30" };
    Icon = ShieldCheck;
    perks = [
      "Pair-match bonus on every L+R direct pair you complete.",
      "Daily-cap rollover keeps unpaid bonuses queued for tomorrow.",
      upgradeThreshold > 0
        ? `Auto-upgrade to Plan B at ${formatINR(upgradeThreshold)} lifetime earnings.`
        : "Stay tuned for Plan B (Premium) auto-upgrade benefits.",
    ];
  }

  return (
    <div
      className={`rounded-2xl p-5 bg-gradient-to-br ${bgClass} text-white shadow-md`}
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">
              Current Plan
            </p>
            <span
              className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${statusBadge.className}`}
            >
              {statusBadge.label}
            </span>
          </div>
          <h2 className="text-2xl font-black mt-1 leading-tight">{planName}</h2>
          <p className="text-xs opacity-90 mt-1 leading-relaxed">
            {planTagline}
          </p>
        </div>
      </div>

      {/* Plan A → Plan B progress meter. Only shown when the
          threshold is configured AND the customer is currently on
          Plan A (the upgrade is meaningless for Plan B / unpaid). */}
      {!isUnpaid && !isPlanB && upgradeThreshold > 0 && (
        <div className="mt-4 bg-white/10 rounded-xl p-3">
          <div className="flex items-center justify-between text-[11px] opacity-90 mb-1.5">
            <span className="font-bold uppercase tracking-wider">
              Progress to Plan B
            </span>
            <span className="font-bold">
              {formatINR(planAEarnings)} / {formatINR(upgradeThreshold)}
            </span>
          </div>
          <div className="h-2 bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all"
              style={{ width: `${upgradePct}%` }}
            />
          </div>
          <p className="text-[11px] opacity-90 mt-2 leading-relaxed">
            {remainingForUpgrade > 0 ? (
              <>
                Earn <strong>{formatINR(remainingForUpgrade)}</strong> more from
                pair-match bonuses to auto-upgrade.
              </>
            ) : (
              <>You qualify for Plan B — your upgrade will land shortly.</>
            )}
          </p>
        </div>
      )}

      {/* Perks / benefit bullets — kept compact so the card never
          dominates the dashboard on PC widths. */}
      <ul className="mt-4 space-y-1.5">
        {perks.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2 text-xs opacity-95 leading-relaxed"
          >
            <CheckCircle2
              size={14}
              className="mt-0.5 shrink-0 opacity-80"
            />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      {memberSince && !isUnpaid && (
        <p className="mt-3 text-[10px] uppercase tracking-widest opacity-70">
          Member since {memberSince}
        </p>
      )}
    </div>
  );
};

/**
 * ReferralCodeCard
 *
 * Dedicated, copy-ready presentation of the customer's referral
 * code. Renders three actions:
 *
 *   - Copy Code  → copies the bare code (e.g. "9D6NZ9VY")
 *   - Copy Link  → copies the signup deep-link (`/signup?ref=…`)
 *   - Share      → native Web Share API (falls back to clipboard)
 *
 * The actions row stacks 1-up on very narrow phones, then 3-across
 * from `sm:` upwards. The signup link is shown read-only beneath
 * the code so users can see exactly what they're about to share.
 */
const ReferralCodeCard = ({
  code,
  shareUrl,
  onCopyCode,
  onCopyLink,
  onShare,
}) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
        <Rocket size={14} className="text-indigo-500" /> Your Referral Code
      </p>
      <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
        Free to share
      </span>
    </div>

    <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-indigo-50 via-violet-50 to-purple-50 border-2 border-dashed border-indigo-200 rounded-xl px-3 sm:px-4 py-4">
      <code className="text-xl sm:text-2xl font-black tracking-widest text-indigo-900 break-all min-w-0">
        {code || "—"}
      </code>
      <button
        onClick={onCopyCode}
        className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 uppercase tracking-widest hover:text-indigo-800 shrink-0"
      >
        <Copy size={14} /> Copy
      </button>
    </div>

    {/* Signup-link preview — read-only, single line, clipped so even
        very long origins (with port numbers) don't expand the card. */}
    {shareUrl && (
      <div className="mt-3 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
        <LinkIcon size={14} className="text-slate-400 shrink-0" />
        <p
          className="text-[11px] text-slate-600 font-mono truncate flex-1 min-w-0"
          title={shareUrl}
        >
          {shareUrl.replace(/^https?:\/\//, "")}
        </p>
      </div>
    )}

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
      <button
        onClick={onCopyCode}
        className="bg-slate-100 hover:bg-slate-200 transition-colors px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700"
      >
        <Copy size={14} /> Copy Code
      </button>
      <button
        onClick={onCopyLink}
        disabled={!shareUrl}
        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <LinkIcon size={14} /> Copy Link
      </button>
      <button
        onClick={onShare}
        className="bg-indigo-600 hover:bg-indigo-700 text-white transition-colors px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold"
      >
        <Share2 size={14} /> Share
      </button>
    </div>

    <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
      Share this code — every signup grows your team and unlocks new bonuses.
    </p>
  </div>
);

/**
 * ProfileCard
 *
 * Identity strip rendered between the hero row and the wallet row
 * on the MLM dashboard. Surfaces the customer's name, public
 * user-id handle (the SE-prefixed string they share with support),
 * phone, email, and member-since date so they don't have to bounce
 * to `/profile` just to confirm which account they're looking at.
 *
 * Data sources:
 *   - `user` (from `useAuth().user`) → name, phone, email, userId
 *   - `membership` (from dashboard overview) → joinedAt
 *
 * Layout:
 *   - Mobile: avatar + name on top, info rows stacked below.
 *   - Desktop (md:+): avatar + name on the left (col-span-4), a
 *     2x2 grid of contact info on the right (col-span-8), with the
 *     Edit Profile action pinned to the top-right corner.
 *
 * Gracefully handles the empty-profile case (auth still loading,
 * stale cache) by rendering placeholder "—" cells instead of
 * blank space, so the card never collapses to zero height.
 */
const ProfileCard = ({ user, membership, login }) => {
  const initial = (user?.name || "U").trim().charAt(0).toUpperCase();
  const handle = user?.userId || null;
  const memberSince = membership?.joinedAt
    ? new Date(membership.joinedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  // Verified badge — `isVerified` flips true once the customer has
  // completed OTP at any point. Falsy for legacy / freshly-imported
  // rows; we hide the badge instead of showing a misleading "no".
  const isVerified = !!user?.isVerified;

  // Show-credentials modal state. Lazy-fetches `/customer/credentials`
  // the first time the modal opens so the dashboard never ships the
  // plaintext password unless the customer explicitly asked to see
  // it. See AccountCredentialsPage.jsx for the canonical reveal
  // pattern; we reuse the same endpoint here so the two surfaces
  // can never drift in what they expose.
  const [credsOpen, setCredsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const copyHandle = () => {
    if (!handle) return;
    navigator.clipboard?.writeText(handle);
    toast.success("User ID copied!");
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-5 items-start">
        {/* Identity column — avatar + name + handle. */}
        <div className="md:col-span-4 flex items-center md:items-start gap-3 md:gap-4 min-w-0">
          <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            {user?.name ? (
              <span className="text-xl md:text-2xl font-black">{initial}</span>
            ) : (
              <UserCircle2 size={28} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-base md:text-lg font-bold text-slate-900 truncate">
                {user?.name || "Customer"}
              </h3>
              {isVerified && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5"
                  title="Phone verified via OTP"
                >
                  <BadgeCheck size={11} /> Verified
                </span>
              )}
            </div>
            {handle ? (
              <button
                type="button"
                onClick={copyHandle}
                className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-mono font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors rounded-md px-2 py-0.5 max-w-full"
                title="Click to copy your user id"
              >
                <span className="truncate">{handle}</span>
                <Copy size={11} className="shrink-0" />
              </button>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400 italic">
                User ID pending…
              </p>
            )}
          </div>
          {/* Actions row — pinned right on mobile (next to the name).
              We wrap both Edit and Show-credentials in a flex box. */}
          <div className="md:hidden flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
              aria-label="Edit profile"
              title="Edit profile"
            >
              <Edit2 size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCredsOpen(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors"
              aria-label="Show credentials"
              title="Show credentials"
            >
              <KeyRound size={16} />
            </button>
          </div>
        </div>

        {/* Info grid — Phone / Email / Member since / Show
            credentials. Stacks 1-col on mobile and goes 2x2 on
            `sm:+`. */}
        <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
          <ProfileInfoRow
            icon={<Phone size={14} />}
            label="Phone"
            value={user?.phone ? `+91 ${formatPhone(user.phone)}` : "—"}
          />
          <ProfileInfoRow
            icon={<Mail size={14} />}
            label="Email"
            value={user?.email || "—"}
            mono={!!user?.email}
            truncate
          />
          <ProfileInfoRow
            icon={<CalendarDays size={14} />}
            label="Member since"
            value={memberSince || "—"}
          />
          <div className="hidden md:grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl py-2.5 transition-colors"
            >
              <Edit2 size={14} /> Edit
            </button>
            <button
              type="button"
              onClick={() => setCredsOpen(true)}
              className="flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs uppercase tracking-wider rounded-xl py-2.5 transition-colors"
            >
              <KeyRound size={14} /> Creds
            </button>
          </div>
        </div>
      </div>
      {credsOpen && <CredentialsModal onClose={() => setCredsOpen(false)} />}
      {editOpen && <EditProfileModal onClose={() => setEditOpen(false)} user={user} login={login} />}
    </div>
  );
};

/**
 * CredentialsModal
 *
 * Lightweight reveal modal launched from the dashboard ProfileCard.
 * Fetches `/customer/credentials` on open and surfaces the four
 * login-relevant fields: User ID, Email, Phone, Password.
 *
 * The password is masked behind an eye toggle so a screen-share or
 * casual shoulder-surf can't snipe it; every field has a one-tap
 * copy button so the customer can paste credentials into a sign-in
 * form on another device without retyping.
 *
 * Why a modal (not a deep-link to AccountCredentialsPage):
 *   - Keeps the customer on the dashboard so they don't lose their
 *     scroll position or context.
 *   - The dashboard's MlmLayout sidebar would hide the existing
 *     credentials page chrome anyway; an inline reveal is cleaner.
 *
 * Both surfaces hit the SAME backend endpoint so the password
 * exposure surface area can never drift between them. See the
 * SECURITY NOTE on `_signupPasswordPlaintext` in
 * `backend/app/models/customer.js` for the trade-off discussion.
 */
const CredentialsModal = ({ onClose }) => {
  const [loading, setLoading] = useState(true);
  const [creds, setCreds] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await customerApi.getCredentials();
        if (!mounted) return;
        setCreds(res.data?.result ?? res.data?.data ?? res.data);
      } catch (err) {
        if (mounted) {
          toast.error(
            err?.response?.data?.message ||
              "Failed to load your account details.",
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Close on Escape — small UX nicety; matches the pattern used by
  // most other modals across the app.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = (label, value) => {
    if (!value) return;
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(`${label} copied!`))
      .catch(() => toast.error(`Could not copy ${label.toLowerCase()}`));
  };

  return (
    <div
      className="fixed inset-0 z-100 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="credentials-modal-title"
    >
      <div
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <KeyRound size={18} />
            </div>
            <div className="min-w-0">
              <h2
                id="credentials-modal-title"
                className="text-base font-bold text-slate-900 truncate"
              >
                Account Credentials
              </h2>
              <p className="text-[11px] text-slate-500 truncate">
                Your sign-in details on this account
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-full text-slate-500 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          {/* Privacy nudge — keeps the user honest about who can
              see their screen the moment the modal opens. Same copy
              as the standalone AccountCredentialsPage so the
              security messaging stays consistent. */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
            <ShieldAlert
              size={16}
              className="text-amber-600 shrink-0 mt-0.5"
            />
            <p className="text-[11px] leading-relaxed text-amber-900">
              Anyone who can see your screen can sign in as you. Reveal
              your password only when you need it.
            </p>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              <CredentialModalRow
                icon={<BadgeCheck size={16} />}
                label="User ID"
                value={creds?.userId}
                placeholder="—"
                mono
                onCopy={() => copy("User ID", creds?.userId)}
              />
              <CredentialModalRow
                icon={<Mail size={16} />}
                label="Email"
                value={creds?.email}
                placeholder="No email on record"
                onCopy={() => copy("Email", creds?.email)}
                truncate
              />
              <CredentialModalRow
                icon={<Phone size={16} />}
                label="Phone"
                value={creds?.phone}
                placeholder="No phone on record"
                onCopy={() => copy("Phone", creds?.phone)}
              />
              <CredentialModalRow
                icon={<KeyRound size={16} />}
                label="Password"
                value={creds?.password}
                placeholder="—"
                isSecret
                secretRevealed={showPassword}
                onToggleSecret={() => setShowPassword((v) => !v)}
                onCopy={() => copy("Password", creds?.password)}
                footer={
                  creds && !creds.hasStoredPassword ? (
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                      Your current password was set before we started
                      keeping a copy for this screen. It still works
                      for sign-in but can't be shown here — change
                      your password to record a new one.
                    </p>
                  ) : null
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Single row used inside the credentials modal — mirrors the
 * `CredentialRow` from AccountCredentialsPage.jsx in look and
 * feel but tightened (smaller icons, less padding) so all four
 * rows fit comfortably without the modal needing to scroll.
 */
const CredentialModalRow = ({
  icon,
  label,
  value,
  placeholder = "—",
  isSecret = false,
  secretRevealed = false,
  onToggleSecret,
  onCopy,
  footer = null,
  mono = false,
  truncate = false,
}) => {
  const hasValue = Boolean(value);
  const display = (() => {
    if (!hasValue) return placeholder;
    if (!isSecret) return value;
    if (secretRevealed) return value;
    const len = Math.min(value.length, 20);
    return "•".repeat(len);
  })();
  const monoClass = isSecret || mono ? "font-mono tracking-wider" : "";

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {label}
          </p>
          <p
            className={`mt-0.5 text-sm font-semibold ${truncate ? "truncate" : "break-all"} ${
              hasValue ? "text-slate-900" : "text-slate-400 italic"
            } ${monoClass}`}
            title={truncate && hasValue ? value : undefined}
          >
            {display}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isSecret && (
            <button
              type="button"
              onClick={onToggleSecret}
              disabled={!hasValue}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label={secretRevealed ? "Hide password" : "Show password"}
            >
              {secretRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            disabled={!hasValue}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={`Copy ${label.toLowerCase()}`}
          >
            <Copy size={16} />
          </button>
        </div>
      </div>
      {footer}
    </div>
  );
};

/**
 * Single contact-info pill used inside the ProfileCard info grid.
 * Kept inline (not its own file) because it's only used here and
 * the styling is intentionally tight to the parent card's density.
 */
const ProfileInfoRow = ({ icon, label, value, mono = false, truncate = false }) => (
  <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2.5 min-w-0">
    <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`text-xs font-semibold text-slate-800 ${truncate ? "truncate" : ""} ${mono ? "font-mono" : ""}`}
        title={truncate ? value : undefined}
      >
        {value}
      </p>
    </div>
  </div>
);

// Strips the +91 / 91 prefix off the stored phone so the UI shows
// just the 10-digit Indian number (the +91 chip is rendered next
// to it). Mirrors the helper in ProfilePage.jsx; duplicated here
// to keep the dashboard page self-contained.
const formatPhone = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("+91")) return value.replace(/^\+91[\s-]*/, "");
  if (value.startsWith("91") && value.length >= 12) return value.replace(/^91[\s-]*/, "");
  return value;
};

const WalletCard = ({ label, amount, hint, tone = "violet", icon }) => {
  const tones = {
    violet: { bg: "bg-violet-50", text: "text-violet-700", icon: "text-violet-600" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", icon: "text-emerald-600" },
  };
  const t = tones[tone] || tones.violet;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">
          {label}
        </p>
        <span className={`${t.icon} shrink-0`}>{icon}</span>
      </div>
      <p className="text-lg sm:text-xl font-black text-slate-900 mt-1 truncate">
        {formatINR(amount)}
      </p>
      <span
        className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold max-w-full truncate ${t.bg} ${t.text}`}
      >
        {hint}
      </span>
    </div>
  );
};

// StatTile uses a responsive density: a compact mobile preset
// (matches the original sizes so the mobile dashboard is
// pixel-identical to before) and a roomier desktop preset
// (`md:` and above) where the 2x4 grid gives each cell a much
// larger footprint that would otherwise look sparse with the
// previous typography.
const StatTile = ({ label, value, icon, tone = "indigo", subtle }) => {
  const tones = {
    indigo: "text-indigo-600 bg-indigo-50",
    emerald: "text-emerald-600 bg-emerald-50",
    amber: "text-amber-600 bg-amber-50",
    rose: "text-rose-600 bg-rose-50",
    violet: "text-violet-600 bg-violet-50",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3.5 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <span
          className={`w-7 h-7 md:w-9 md:h-9 rounded-full flex items-center justify-center shrink-0 ${tones[tone] || tones.indigo}`}
        >
          {icon}
        </span>
      </div>
      <p className="text-base md:text-2xl font-black text-slate-900 mt-1.5 md:mt-3 truncate">
        {value}
      </p>
      {subtle && (
        <p className="text-[10px] md:text-xs text-slate-500 mt-0.5 md:mt-1 truncate">
          {subtle}
        </p>
      )}
    </div>
  );
};

const LegBox = ({ label, count, weaker, accent, icon }) => (
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
      {count}
    </p>
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">
      {label}
    </p>
  </div>
);

const QuickLink = ({ label, icon, to }) => (
  <Link
    to={to}
    className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col items-center gap-2 hover:bg-slate-50 transition-colors"
  >
    <span className="text-indigo-600">{icon}</span>
    <span className="text-xs font-bold text-slate-800">{label}</span>
  </Link>
);

const DailyCapMeter = ({ cap, used }) => {
  const pct = Math.min(100, (used / Math.max(cap, 1)) * 100);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Daily Earning Cap
        </p>
        <p className="text-xs font-semibold text-slate-700">
          {formatINR(used)} / {formatINR(cap)}
        </p>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        Earnings beyond the daily cap roll over to the next IST day automatically.
      </p>
    </div>
  );
};

/**
 * EditProfileModal
 *
 * Lightweight modal to edit user's name, email, and password.
 */
const EditProfileModal = ({ onClose, user, login }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: ''
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await customerApi.updateProfile(formData);
      const updatedUser = response.data.result;

      // Update local auth state
      login({ ...user, ...updatedUser });

      toast.success('Profile updated successfully!');
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-100 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-modal-title"
    >
      <div
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Edit2 size={18} />
            </div>
            <div className="min-w-0">
              <h2
                id="edit-profile-modal-title"
                className="text-base font-bold text-slate-900 truncate"
              >
                Edit Profile
              </h2>
              <p className="text-[11px] text-slate-500 truncate">
                Update your account details
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-full text-slate-500 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
              <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all">
                <UserCircle2 size={20} className="text-slate-400" />
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="bg-transparent w-full text-slate-800 font-bold outline-none placeholder:font-medium"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
              <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all">
                <Mail size={20} className="text-slate-400" />
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="bg-transparent w-full text-slate-800 font-bold outline-none placeholder:font-medium"
                  placeholder="Enter email address"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">New Password (optional)</label>
              <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all">
                <KeyRound size={20} className="text-slate-400" />
                <input
                  type="text"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="bg-transparent w-full text-slate-800 font-bold outline-none placeholder:font-medium"
                  placeholder="Leave blank to keep current"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full py-3.5 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Edit2 size={20} />
              )}
              {isLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default MainDashboardPage;
