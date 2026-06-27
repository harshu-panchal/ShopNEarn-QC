import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Store } from "lucide-react";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import { PageShell, InfoBlock, formatINR } from "./franchiseAdminShared";

const FIELD_META = [
  {
    key: "registrationPrice",
    label: "Registration price (₹)",
    hint: "One-time franchise signup fee charged to members",
    type: "number",
  },
  {
    key: "walletCreditMultiplier",
    label: "Wallet credit multiplier",
    hint: "Approved top-ups credit deposit × this value as stock purchasing power",
    type: "number",
    step: "0.1",
  },
  {
    key: "hubShopDisplayName",
    label: "Hub display name",
    hint: "Shown to franchise partners in the customer app",
    type: "text",
  },
  {
    key: "hubSellerId",
    label: "Hub seller ID",
    hint: "MongoDB ObjectId of the seller whose catalog is Harsh's Hub",
    type: "text",
    mono: true,
  },
];

const FranchiseSettings = () => {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFranchiseApi.getSettings().then((res) => {
      setCfg(res.data?.result ?? res.data?.data);
    });
  }, []);

  if (!cfg) {
    return (
      <PageShell title="Franchise Settings">
        <p className="text-slate-500">Loading settings…</p>
      </PageShell>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminFranchiseApi.updateSettings({
        ...cfg,
        registrationPrice: Number(cfg.registrationPrice),
        walletCreditMultiplier: Number(cfg.walletCreditMultiplier),
      });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Home Shoppy Settings"
      subtitle="Configure registration fees, wallet rules, and the hub catalog seller."
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <Store size={18} className="text-indigo-600" /> Program configuration
          </h2>
          {FIELD_META.map((field) => (
            <label key={field.key} className="block">
              <span className="text-sm font-semibold text-slate-800">{field.label}</span>
              <p className="text-xs text-slate-500 mb-1.5">{field.hint}</p>
              <input
                type={field.type}
                step={field.step}
                value={cfg[field.key] ?? ""}
                onChange={(e) => setCfg({ ...cfg, [field.key]: e.target.value })}
                className={`w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 ${field.mono ? "font-mono text-xs" : ""}`}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-3 rounded-xl disabled:opacity-50"
          >
            <Save size={16} /> {saving ? "Saving…" : "Save settings"}
          </button>
        </div>

        <div className="space-y-4">
          <InfoBlock label="Current summary">
            <ul className="text-sm space-y-2 text-slate-700">
              <li>
                <span className="text-slate-500">Registration:</span>{" "}
                <strong>{formatINR(cfg.registrationPrice)}</strong>
              </li>
              <li>
                <span className="text-slate-500">Top-up credit:</span>{" "}
                <strong>{cfg.walletCreditMultiplier || 2}×</strong>
              </li>
              <li>
                <span className="text-slate-500">Hub name:</span>{" "}
                <strong>{cfg.hubShopDisplayName || "Harsh's Hub"}</strong>
              </li>
              <li>
                <span className="text-slate-500">Enabled:</span>{" "}
                <strong>{cfg.enabled ? "Yes" : "No"}</strong>
              </li>
            </ul>
          </InfoBlock>
          <InfoBlock label="Setup checklist">
            <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside">
              <li>Set hub seller ID to the admin catalog seller</li>
              <li>Mark seller as platform hub if not already</li>
              <li>Add products to hub seller inventory</li>
              <li>Approve franchise registrations from Registrations tab</li>
            </ol>
          </InfoBlock>
        </div>
      </div>
    </PageShell>
  );
};

export default FranchiseSettings;
