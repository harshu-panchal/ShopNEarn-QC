import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCcw, Store, Users, Wallet, ClipboardList, Settings, LogIn, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import {
  PageShell,
  StatCard,
  QuickLinkCard,
  formatINR,
  formatDate,
  formatAddressSnapshot,
  DataTable,
  EmptyRow,
  StatusPill,
} from "./franchiseAdminShared";

const FranchiseAdminDashboard = () => {
  const [data, setData] = useState(null);
  const [recentRegs, setRecentRegs] = useState([]);
  const [recentTopUps, setRecentTopUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loggingIntoHub, setLoggingIntoHub] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, regRes, topRes] = await Promise.all([
        adminFranchiseApi.getDashboard(),
        adminFranchiseApi.listRegistrations({ status: "PENDING_REVIEW", limit: 5 }),
        adminFranchiseApi.listTopUps({ status: "pending_review", limit: 5 }),
      ]);
      setData(dashRes.data?.result ?? dashRes.data?.data);
      setRecentRegs(regRes.data?.result?.items ?? regRes.data?.data?.items ?? []);
      setRecentTopUps(topRes.data?.result?.items ?? topRes.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const cfg = data?.config || {};
  const hubName = cfg.hubShopDisplayName || "Harsh's Hub";
  const hubSellerId = data?.hubSellerId || cfg.hubSellerId;

  const handleLoginToHub = async () => {
    if (loggingIntoHub) return;
    if (!hubSellerId) {
      toast.error("Hub seller is not configured. Set it in Franchise Settings.");
      return;
    }
    if (!window.confirm(
      `Open a new tab and sign in to ${hubName}? ` +
      "If you already have a seller session open in this browser, it will be replaced.",
    )) {
      return;
    }

    const newTab = window.open("about:blank", "_blank");
    if (!newTab) {
      toast.error("Pop-up blocked. Please allow pop-ups for this site and try again.");
      return;
    }

    setLoggingIntoHub(true);
    try {
      const res = await adminFranchiseApi.issueHubImpersonationToken();
      const payload = res.data?.result ?? res.data?.data ?? {};
      if (!payload.token) {
        throw new Error("Backend returned no impersonation token.");
      }
      const redirect = payload.redirect || "/seller";
      const handoffUrl =
        `${window.location.origin}/auth/handoff` +
        `#token=${encodeURIComponent(payload.token)}` +
        `&role=seller` +
        `&redirect=${encodeURIComponent(redirect)}`;
      newTab.location.replace(handoffUrl);
      toast.success(`Opening ${payload.hubShopDisplayName || hubName} seller panel…`);
    } catch (err) {
      try { newTab.close(); } catch { /* ignore */ }
      toast.error(
        err?.response?.data?.message ||
        err?.message ||
        "Failed to open hub seller panel.",
      );
    } finally {
      setLoggingIntoHub(false);
    }
  };

  return (
    <PageShell
      title="Home Shoppy Franchise"
      subtitle="Manage franchise registrations, wallet top-ups, partners, and hub catalog routing."
      actions={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Active partners"
          value={loading ? "…" : data?.activePartners ?? 0}
          hint="Franchise partners fulfilling orders"
          icon={Users}
          tone="indigo"
          to="/admin/franchise/partners"
        />
        <StatCard
          label="Pending registrations"
          value={loading ? "…" : data?.pendingRegistrations ?? 0}
          hint="₹10,000 signup proofs awaiting review"
          icon={ClipboardList}
          tone="amber"
          to="/admin/franchise/registrations"
        />
        <StatCard
          label="Pending top-ups"
          value={loading ? "…" : data?.pendingTopUps ?? 0}
          hint="Wallet deposits awaiting 2× credit"
          icon={Wallet}
          tone="emerald"
          to="/admin/franchise/topups"
        />
        <StatCard
          label="Registration fee"
          value={formatINR(cfg.registrationPrice || 10000)}
          hint={`Wallet credit: ${cfg.walletCreditMultiplier || 2}× product value`}
          icon={Store}
          tone="slate"
          to="/admin/franchise/settings"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900">Program overview</h2>
            <Link to="/admin/franchise/settings" className="text-xs font-bold text-indigo-600 hover:underline">
              Edit settings
            </Link>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="bg-slate-50 rounded-xl p-4">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Hub catalog</dt>
              <dd className="font-semibold text-slate-900 mt-1">{hubName}</dd>
              <dd className="text-xs text-slate-500 mt-1 font-mono break-all">
                Seller ID: {hubSellerId || "Not configured"}
              </dd>
              <button
                type="button"
                onClick={handleLoginToHub}
                disabled={loggingIntoHub || !hubSellerId}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white transition-colors shadow-sm"
                title={hubSellerId ? `Open seller panel for ${hubName}` : "Configure hub seller ID first"}
              >
                {loggingIntoHub ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <LogIn size={14} />
                )}
                {loggingIntoHub ? "Signing in…" : `Log in to ${hubName}`}
              </button>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Order routing</dt>
              <dd className="font-semibold text-slate-900 mt-1">Nearest franchise partner</dd>
              <dd className="text-xs text-slate-500 mt-1">
                Hub-only carts route by customer delivery coordinates
              </dd>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Registration</dt>
              <dd className="font-semibold text-slate-900 mt-1">{formatINR(cfg.registrationPrice || 10000)} one-time</dd>
              <dd className="text-xs text-slate-500 mt-1">Manual UPI QR + admin approval</dd>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Franchise wallet</dt>
              <dd className="font-semibold text-slate-900 mt-1">
                Top-up → admin credits {cfg.walletCreditMultiplier || 2}× stock value
              </dd>
              <dd className="text-xs text-slate-500 mt-1">Partners buy stock from hub catalog</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-3">
          <QuickLinkCard
            to="/admin/franchise/dispatch"
            title="Franchise dispatch"
            description="Assign delivery partners to accepted Home Shoppy orders"
            icon={Store}
          />
          <QuickLinkCard
            to="/admin/franchise/registrations"
            title="Registration reviews"
            description="Verify ₹10k payments and activate new franchise partners"
            count={data?.pendingRegistrations}
            icon={ClipboardList}
          />
          <QuickLinkCard
            to="/admin/franchise/topups"
            title="Wallet top-ups"
            description="Approve deposits and credit franchise wallets"
            count={data?.pendingTopUps}
            icon={Wallet}
          />
          <QuickLinkCard
            to="/admin/franchise/partners"
            title="Partner directory"
            description="Territories, wallets, stock, and adjustments"
            icon={Users}
          />
          <QuickLinkCard
            to="/admin/franchise/settings"
            title="Program settings"
            description="Hub seller, fees, and display name"
            icon={Settings}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Latest registration requests</h2>
            <Link to="/admin/franchise/registrations" className="text-xs font-bold text-indigo-600">
              View all
            </Link>
          </div>
          <DataTable
            columns={[
              { key: "when", label: "Submitted" },
              { key: "who", label: "Customer" },
              { key: "amt", label: "Amount", align: "right" },
              { key: "status", label: "Status" },
            ]}
            minWidth="520px"
          >
            {loading ? (
              <EmptyRow colSpan={4} message="Loading…" />
            ) : recentRegs.length === 0 ? (
              <EmptyRow colSpan={4} message="No pending registrations." />
            ) : (
              recentRegs.map((row) => (
                <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs">{formatDate(row.manualPaymentDetails?.submittedAt || row.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{row.customerInfo?.name || "Customer"}</p>
                    <p className="text-xs text-slate-500">{row.customerInfo?.phone || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{formatINR(row.registrationPriceSnapshot)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.status} />
                  </td>
                </tr>
              ))
            )}
          </DataTable>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Latest wallet top-ups</h2>
            <Link to="/admin/franchise/topups" className="text-xs font-bold text-indigo-600">
              View all
            </Link>
          </div>
          <DataTable
            columns={[
              { key: "when", label: "Submitted" },
              { key: "who", label: "Partner" },
              { key: "amt", label: "Deposit", align: "right" },
              { key: "credit", label: "Credit", align: "right" },
            ]}
            minWidth="520px"
          >
            {loading ? (
              <EmptyRow colSpan={4} message="Loading…" />
            ) : recentTopUps.length === 0 ? (
              <EmptyRow colSpan={4} message="No pending top-ups." />
            ) : (
              recentTopUps.map((row) => (
                <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs">{formatDate(row.manualPaymentDetails?.submittedAt || row.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">
                      {row.partnerInfo?.userId?.name || row.partnerInfo?.displayName || "Partner"}
                    </p>
                    <p className="text-xs text-slate-500">{row.partnerInfo?.referralCode || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{formatINR(row.amount)}</td>
                  <td className="px-4 py-3 text-right text-emerald-700 font-bold">
                    {formatINR(row.amount * (row.creditMultiplierSnapshot || 2))}
                  </td>
                </tr>
              ))
            )}
          </DataTable>
        </section>
      </div>
    </PageShell>
  );
};

export default FranchiseAdminDashboard;
