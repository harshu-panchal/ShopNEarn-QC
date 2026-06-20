import React, { useEffect, useState } from "react";
import { Loader2, ArrowLeft, ArrowRight, User, ChevronDown, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";
import MemberJoinedSubtitle from "@shared/components/mlm/MemberJoinedSubtitle";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Customer-MLM-rebuild Phase 8 — Binary Genealogy page.
 *
 * Flat per-leg roster: left-leg directs in one column, right-leg
 * directs in the other. Each row shows the member's name, masked
 * phone, status, joined date, subtree count (how many people sit
 * underneath them), and lifetime earnings.
 */
const BinaryGenealogyPage = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await mlmApi.getBinaryGenealogy();
        if (!mounted) return;
        setData(res.data?.result ?? res.data?.data ?? res.data);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Failed to load");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // `max-w-6xl mx-auto` was hoisted out of GenealogyLayout into each
  // list page so the Tree View can render edge-to-edge. The outer
  // wrapper here also handles vertical scrolling within the layout's
  // flex-1 outlet shell.
  // Container widths bumped from `max-w-6xl` to `xl:max-w-none` so
  // the binary tree can use the full desktop panel width beside the
  // sidebar. The 3-up summary strip (md:+) replaces the old 2+1
  // stack and reads as a single horizontal KPI band.
  if (loading) {
    return (
      <div className="max-w-6xl xl:max-w-none mx-auto px-3 sm:px-4 md:px-8 py-4 w-full overflow-y-auto pb-24">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (!data?.isMember) {
    return (
      <div className="max-w-6xl xl:max-w-none mx-auto px-3 sm:px-4 md:px-8 py-4 w-full overflow-y-auto pb-24">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <Sparkles className="w-10 h-10 mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">
            Your binary tree will appear once you become a member.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl xl:max-w-none mx-auto px-3 sm:px-4 md:px-8 py-4 w-full overflow-y-auto pb-24 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummaryCard
          label="Left Leg Directs"
          count={data.leftLegCount || 0}
          icon={<ArrowLeft size={18} />}
          tone="indigo"
        />
        <SummaryCard
          label="Right Leg Directs"
          count={data.rightLegCount || 0}
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
          title="Left Leg"
          accentColor="indigo"
          icon={<ArrowLeft size={16} />}
          items={data.leftLeg || []}
        />
        <LegList
          title="Right Leg"
          accentColor="emerald"
          icon={<ArrowRight size={16} />}
          items={data.rightLeg || []}
        />
      </div>
    </div>
  );
};

const SummaryCard = ({ label, count, icon, tone = "indigo", spanFullOnMobile }) => {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  // `spanFullOnMobile` makes the card take 2 columns at the
  // `grid-cols-2` mobile breakpoint (so it sits below as a wide
  // banner), but reverts to a normal cell at `md:grid-cols-3`
  // where it can fit alongside the two leg cards.
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
          <p className="text-xs text-slate-500">
            No referrals on this leg yet.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={String(item.userId)} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0">
                  <User size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {item.name || "Member"}
                    </p>
                    <StatusBadge status={item.status} />
                  </div>
                  <MemberJoinedSubtitle joinedAt={item.joinedAt} className="text-[10px] text-slate-400" />
                  <p className="text-[11px] text-slate-500 truncate">
                    {item.phone || "—"} • code{" "}
                    <code className="font-mono">{item.referralCode}</code>
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                    <span>↓ {item.subtreeCount} downline</span>
                    <span>Pairs {item.pairsCompleted}</span>
                    <span>{formatINR(item.lifetimeEarnings || 0)} earned</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const map = {
    active: "bg-emerald-100 text-emerald-700",
    registered_unpaid: "bg-amber-100 text-amber-700",
    suspended: "bg-rose-100 text-rose-700",
    terminated: "bg-slate-200 text-slate-700",
  };
  return (
    <span
      className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${map[status] || "bg-slate-100 text-slate-700"}`}
    >
      {status === "registered_unpaid" ? "Unpaid" : status}
    </span>
  );
};

export default BinaryGenealogyPage;
