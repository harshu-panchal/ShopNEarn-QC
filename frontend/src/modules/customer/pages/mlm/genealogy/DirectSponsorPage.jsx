import React, { useEffect, useState } from "react";
import { Loader2, User, Award, Phone, Calendar, Copy } from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";

/**
 * Customer-MLM-rebuild Phase 8 — Direct Sponsor page.
 *
 * Shows the customer's L1 sponsor card with the sponsor's name,
 * masked phone, referral code, plan, status, and joined date.
 */
const DirectSponsorPage = () => {
  const [loading, setLoading] = useState(true);
  const [sponsor, setSponsor] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await mlmApi.getDirectSponsor();
        if (!mounted) return;
        const payload = res.data?.result ?? res.data?.data ?? res.data;
        setSponsor(payload?.sponsor || null);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Failed to load sponsor");
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
      <div className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!sponsor) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <User className="w-10 h-10 mx-auto text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">
          You don't have a sponsor on record.
        </p>
      </div>
    );
  }

  const copyCode = () => {
    if (!sponsor.referralCode) return;
    navigator.clipboard?.writeText(sponsor.referralCode);
    toast.success("Code copied!");
  };

  const planLabel = sponsor.planType === "B" ? "Premium" : "Plan A";
  const statusBadge = {
    active: "bg-emerald-100 text-emerald-700",
    registered_unpaid: "bg-amber-100 text-amber-700",
    suspended: "bg-rose-100 text-rose-700",
    terminated: "bg-slate-200 text-slate-700",
  }[sponsor.status] || "bg-slate-100 text-slate-700";

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center flex-shrink-0">
            <User size={26} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">
              Your Sponsor
            </p>
            <h2 className="text-2xl font-black mt-1 truncate">
              {sponsor.name || "Sponsor"}
            </h2>
            <p className="text-xs opacity-80 mt-1">
              {planLabel} member · {sponsor.status === "registered_unpaid" ? "Activation pending" : sponsor.status}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="space-y-4">
          <Row
            icon={<Award size={16} />}
            label="Referral Code"
            value={
              <button
                onClick={copyCode}
                className="flex items-center gap-1.5 font-mono font-bold text-slate-900 text-sm"
              >
                {sponsor.referralCode}
                <Copy size={12} className="text-slate-400" />
              </button>
            }
          />
          <Row
            icon={<Phone size={16} />}
            label="Phone"
            value={sponsor.phone || "—"}
          />
          <Row
            icon={<Calendar size={16} />}
            label="Joined"
            value={new Date(sponsor.joinedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          />
          <Row
            icon={<User size={16} />}
            label="Status"
            value={
              <span
                className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded ${statusBadge}`}
              >
                {sponsor.status === "registered_unpaid" ? "Activation Pending" : sponsor.status}
              </span>
            }
          />
        </div>
      </div>

      <p className="text-[11px] text-slate-400 px-2">
        Your sponsor is the person whose referral code you used at signup.
        Contact your sponsor if you need help understanding the rewards
        program.
      </p>
    </div>
  );
};

const Row = ({ icon, label, value }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2 text-slate-500">
      {icon}
      <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
    </div>
    <div className="text-sm text-slate-900">{value}</div>
  </div>
);

export default DirectSponsorPage;
