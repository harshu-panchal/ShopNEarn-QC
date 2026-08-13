import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Menu,
  ArrowLeft,
  Loader2,
  User,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import mlmApi from "../../../services/mlmApi";
import { useMlmDrawer } from "../MlmLayout";
import MemberJoinedSubtitle from "@shared/components/mlm/MemberJoinedSubtitle";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const bonusTypeLabel = (t) => {
  const map = {
    SIGNUP_BONUS_SELF: "Welcome Signup Bonus",
    SIGNUP_BONUS_SPONSOR: "Referral Signup Bonus",
    DIRECT_REFERRAL_MILESTONE: "Matching Income",
    DIRECT_REFERRAL_ACTIVATION: "Pair Match Bonus",
    DIRECT_REFERRAL_PER_ACTIVATION: "Direct Referral Activation Income",
    BINARY_PAIR_MATCH: "Pair Match Bonus",
    REPURCHASE_BONUS: "Repurchase Bonus",
    MENTOR_ROYALTY: "Mentor Royalty",
    HOME_SHOPPING_SALES: "Home Shopping Sales",
    HOME_SHOPPING_REFERRAL: "Home Shopping Referral",
    HOME_SHOPPING_ROYALTY: "Home Shopping Royalty",
    GIFT_VOUCHER_MILESTONE: "Gift Voucher",
    MANUAL_ADJUSTMENT: "Manual Adjustment",
  };
  return map[t] || t;
};

const NetworkMemberDetailPage = () => {
  const { memberId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await mlmApi.getNetworkMemberDetail(memberId);
        if (!mounted) return;
        setData(res.data?.result ?? res.data?.data ?? res.data);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Failed to load member");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [memberId]);

  const member = data?.member;
  const earnings = data?.earningsSummary;

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
      <Header memberName={member?.name} />
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-4 space-y-4 md:space-y-6">
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : !member ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            Member not found or you do not have access.
          </div>
        ) : (
          <>
            <div className="hidden md:block pt-2">
              <Link
                to="/mlm/network/total-team"
                className="inline-flex items-center gap-1 text-sm text-indigo-600 font-semibold hover:underline mb-3"
              >
                <ArrowLeft size={14} /> Back to Total Team
              </Link>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                {member.name || "Member"}
              </h1>
              <p className="text-sm text-slate-500 mt-1 font-mono">
                {member.publicUserId || member.referralCode}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <User size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900 md:hidden">
                      {member.name || "Member"}
                    </h2>
                    <StatusBadge status={member.status} planType={member.planType} />
                    {member.legUnderYou && (
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          member.legUnderYou === "L"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {member.legUnderYou === "L" ? "Left Leg" : "Right Leg"}
                      </span>
                    )}
                    {member.isDirectReferral && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                        Direct Referral
                      </span>
                    )}
                  </div>
                  <MemberJoinedSubtitle
                    joinedAt={member.joinedAt}
                    className="text-xs text-slate-500 mt-1"
                  />
                  <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <InfoRow label="Referral code" value={member.referralCode} mono />
                    <InfoRow label="Phone" value={member.phone || "—"} />
                    <InfoRow label="Email" value={member.email || "—"} />
                    {data?.sponsor?.name && (
                      <InfoRow label="Sponsor" value={data.sponsor.name} />
                    )}
                  </dl>
                </div>
              </div>
            </div>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                <Users size={14} /> Network Stats
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Direct Referrals" value={member.directReferralsCount || 0} />
                <StatCard label="Total Downline" value={member.totalDownlineCount || 0} />
                <StatCard label="Active Downline" value={member.activeDownlineCount || 0} />
                <StatCard label="Pairs Completed" value={member.pairsCompleted || 0} />
                <StatCard label="Left Leg Directs" value={member.leftLegDirectCount || 0} />
                <StatCard label="Right Leg Directs" value={member.rightLegDirectCount || 0} />
              </div>
            </section>

            {earnings && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                  <TrendingUp size={14} /> Earnings Summary
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-2xl p-4">
                    <p className="text-[10px] font-bold uppercase opacity-80">
                      Earnings Wallet
                    </p>
                    <p className="text-xl font-black mt-1">
                      {formatINR(earnings.earningsWalletBalance)}
                    </p>
                    <p className="text-[10px] opacity-75 mt-1">
                      Lifetime credited {formatINR(earnings.totalCredited)}
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl p-4">
                    <p className="text-[10px] font-bold uppercase opacity-80">
                      Shopping Wallet
                    </p>
                    <p className="text-xl font-black mt-1">
                      {formatINR(earnings.shoppingWalletBalance)}
                    </p>
                    <p className="text-[10px] opacity-75 mt-1">
                      Lifetime income {formatINR(earnings.totalShoppingCredited)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">
                      Earnings Wallet Lifetime
                    </p>
                    <p className="text-xl font-black text-slate-900 mt-1">
                      {formatINR(earnings.totalCredited)}
                    </p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">
                      This Month (Earnings)
                    </p>
                    <p className="text-xl font-black text-emerald-700 mt-1">
                      {formatINR(earnings.totalThisMonth)}
                    </p>
                  </div>
                </div>

                {earnings.shoppingByType?.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
                    <div className="px-4 py-3 border-b border-slate-100 bg-emerald-50/50">
                      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
                        Shopping wallet income
                      </p>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {earnings.shoppingByType.map((row) => (
                        <li
                          key={row.bonusType}
                          className="px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              {bonusTypeLabel(row.bonusType)}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {row.count} {row.count === 1 ? "credit" : "credits"}
                            </p>
                          </div>
                          <p className="text-sm font-bold text-emerald-700">
                            {formatINR(row.total)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {earnings.repurchaseByLevel?.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
                    <div className="px-4 py-3 border-b border-slate-100 bg-indigo-50/50">
                      <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">
                        Repurchase bonus — 6 upline levels
                      </p>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {earnings.repurchaseByLevel.map((row) => (
                        <li
                          key={row.level}
                          className="px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              Level {row.level}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {row.count} {row.count === 1 ? "credit" : "credits"}
                            </p>
                          </div>
                          <p className="text-sm font-bold text-indigo-700">
                            {formatINR(row.total)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {earnings.byType?.length > 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                      <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                        Earnings wallet income
                      </p>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {earnings.byType.map((row) => (
                        <li
                          key={row.bonusType}
                          className="px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              {bonusTypeLabel(row.bonusType)}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {row.count} {row.count === 1 ? "credit" : "credits"}
                            </p>
                          </div>
                          <p className="text-sm font-bold text-slate-900">
                            {formatINR(row.total)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  !earnings.shoppingByType?.length && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">
                    No earnings credited yet.
                  </div>
                  )
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const InfoRow = ({ label, value, mono }) => (
  <div>
    <dt className="text-[10px] font-bold uppercase text-slate-400">{label}</dt>
    <dd className={`text-slate-800 font-medium truncate ${mono ? "font-mono text-xs" : ""}`}>
      {value}
    </dd>
  </div>
);

const StatCard = ({ label, value }) => {
  const display = Math.max(0, Number(value) || 0);
  return (
  <div className="bg-white rounded-2xl border border-slate-200 p-3">
    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
    <p className="text-lg font-black text-slate-900 mt-0.5">{display}</p>
  </div>
  );
};

const StatusBadge = ({ status, planType }) => {
  if (status === "active") {
    return (
      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
        {planType === "B" ? "Plan B" : "Plan A"}
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
      {status === "registered_unpaid" ? "Pending Activation" : "Member"}
    </span>
  );
};

function Header({ memberName }) {
  const navigate = useNavigate();
  const { openDrawer } = useMlmDrawer();
  return (
    <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-2 border-b border-slate-200/60 flex items-center gap-3">
      <button
        onClick={openDrawer}
        className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-2"
        aria-label="Open navigation"
      >
        <Menu size={22} className="text-slate-800" />
      </button>
      <h1 className="text-lg font-semibold text-slate-900 tracking-tight flex-1 truncate">
        {memberName || "Member Detail"}
      </h1>
      <button
        onClick={() => navigate(-1)}
        className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors"
        aria-label="Go back"
      >
        <ArrowLeft size={20} className="text-slate-700" />
      </button>
    </div>
  );
}

export default NetworkMemberDetailPage;
