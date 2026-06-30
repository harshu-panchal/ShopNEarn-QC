import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu,
  ArrowLeft,
  ArrowRight,
  Loader2,
  User,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import mlmApi from "../../../services/mlmApi";
import { useMlmDrawer } from "../MlmLayout";
import MemberJoinedSubtitle from "@shared/components/mlm/MemberJoinedSubtitle";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const TotalTeamPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await mlmApi.getTotalTeam();
        if (!mounted) return;
        setData(res.data?.result ?? res.data?.data ?? res.data);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Failed to load total team");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
      <Header />
      <div className="max-w-6xl xl:max-w-none mx-auto px-3 sm:px-4 md:px-8 py-4 w-full space-y-4">
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : !data?.isMember ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <Sparkles className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">
              Your direct referrals will appear once you become a member.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block pt-2 pb-2 border-b border-slate-200/80">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Total Team
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Your direct referrals on the left and right legs in one view.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <SummaryCard
                label="Left Directs"
                count={data.leftLeg?.length || 0}
                sub={`${data.leftLegActiveCount || 0} active`}
                icon={<ArrowLeft size={18} />}
                tone="indigo"
              />
              <SummaryCard
                label="Right Directs"
                count={data.rightLeg?.length || 0}
                sub={`${data.rightLegActiveCount || 0} active`}
                icon={<ArrowRight size={18} />}
                tone="emerald"
              />
              <SummaryCard
                label="Pairs Completed"
                count={data.pairsCompleted || 0}
                icon={<Sparkles size={18} />}
                tone="amber"
                spanFullOnMobile
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LegList
                title="Left Leg — Direct Referrals"
                accentColor="indigo"
                icon={<ArrowLeft size={16} />}
                items={data.leftLeg || []}
              />
              <LegList
                title="Right Leg — Direct Referrals"
                accentColor="emerald"
                icon={<ArrowRight size={16} />}
                items={data.rightLeg || []}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const SummaryCard = ({
  label,
  count,
  sub,
  icon,
  tone = "indigo",
  spanFullOnMobile,
}) => {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200 p-4 ${spanFullOnMobile ? "col-span-2 md:col-span-1" : ""}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center ${tones[tone]}`}
        >
          {icon}
        </span>
      </div>
      <p className="text-2xl font-black text-slate-900 mt-1">{count}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
};

const LegList = ({ title, accentColor, icon, items }) => {
  const accent = {
    indigo: "text-indigo-600 bg-indigo-50",
    emerald: "text-emerald-600 bg-emerald-50",
  }[accentColor];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div
        className={`px-4 py-3 flex items-center gap-2 border-b border-slate-200 ${accent}`}
      >
        {icon}
        <h3 className="text-sm font-bold uppercase tracking-wide">{title}</h3>
        <span className="ml-auto text-xs font-bold">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-slate-500">No direct referrals on this leg yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={String(item.userId)}>
              <Link
                to={`/mlm/network/member/${item.userId}`}
                className="block px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                    <User size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-indigo-700 truncate hover:underline">
                        {item.name || "Member"}
                      </p>
                      <StatusBadge status={item.status} planType={item.planType} />
                    </div>
                    <MemberJoinedSubtitle
                      joinedAt={item.joinedAt}
                      className="text-[10px] text-slate-400"
                    />
                    <p className="text-[11px] text-slate-500 truncate">
                      {item.phone || "—"} •{" "}
                      <code className="font-mono">{item.referralCode}</code>
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                      <span>↓ {item.totalDownlineCount || 0} downline</span>
                      <span>Pairs {item.pairsCompleted || 0}</span>
                      <span>{formatINR(item.lifetimeEarnings || 0)} earned</span>
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
      Member
    </span>
  );
};

function Header() {
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
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
        Total Team
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

export default TotalTeamPage;
