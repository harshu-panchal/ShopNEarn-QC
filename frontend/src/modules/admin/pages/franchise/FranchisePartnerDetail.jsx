import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, Package, MapPin, Wallet } from "lucide-react";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import { PageShell, InfoBlock, StatusPill, formatINR, formatDate } from "./franchiseAdminShared";

const FranchisePartnerDetail = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [pincodes, setPincodes] = useState("");
  const [adj, setAdj] = useState({ amount: "", direction: "CREDIT", reason: "" });
  const [saving, setSaving] = useState(false);

  const load = () =>
    adminFranchiseApi.getPartner(id).then((res) => {
      const payload = res.data?.result ?? res.data?.data;
      setData(payload);
      setPincodes((payload?.partner?.territoryPincodes || []).join(", "));
    });

  useEffect(() => {
    load();
  }, [id]);

  if (!data) {
    return (
      <PageShell title="Partner detail">
        <p className="text-slate-500">Loading partner…</p>
      </PageShell>
    );
  }

  const { partner, wallet, stock } = data;
  const stockTotal = (stock || []).reduce((sum, s) => sum + Number(s.quantity || 0), 0);

  return (
    <PageShell
      title={partner.userId?.name || partner.displayName || "Franchise partner"}
      subtitle={`Code ${partner.referralCode} · Registered ${formatDate(partner.registeredAt)}`}
      actions={
        <Link
          to="/admin/franchise/partners"
          className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          <ChevronLeft size={14} /> Back to partners
        </Link>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs uppercase font-bold tracking-wider">
            <Wallet size={14} /> Wallet balance
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{formatINR(wallet?.availableBalance)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs uppercase font-bold tracking-wider">
            <Package size={14} /> Stock units
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{stockTotal}</p>
          <p className="text-xs text-slate-500">{(stock || []).length} SKU lines</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs uppercase font-bold tracking-wider">
            Status
          </div>
          <div className="mt-3">
            <StatusPill status={partner.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <InfoBlock label="Contact">
          <p className="font-semibold text-slate-900">{partner.userId?.name || partner.displayName}</p>
          <p className="text-sm text-slate-600">{partner.userId?.phone || partner.phone}</p>
          {partner.userId?.email && <p className="text-xs text-slate-500">{partner.userId.email}</p>}
        </InfoBlock>

        <InfoBlock label="Franchise address">
          <div className="flex gap-2">
            <MapPin size={16} className="text-indigo-500 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700">
              {partner.address ||
                [partner.locality, partner.city, partner.state, partner.pincode].filter(Boolean).join(", ") ||
                "—"}
            </p>
          </div>
        </InfoBlock>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="font-bold text-slate-900">Territory pincodes</h2>
          <p className="text-xs text-slate-500">Fallback routing when delivery coordinates are unavailable.</p>
          <input
            value={pincodes}
            onChange={(e) => setPincodes(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
            placeholder="e.g. 380001, 380015"
          />
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await adminFranchiseApi.patchTerritory(id, {
                  territoryPincodes: pincodes.split(/[,\s]+/).filter(Boolean),
                });
                toast.success("Territory updated");
                await load();
              } catch (err) {
                toast.error(err?.response?.data?.message || "Save failed");
              } finally {
                setSaving(false);
              }
            }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold disabled:opacity-50"
          >
            Save territory
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="font-bold text-slate-900">Manual wallet adjustment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              value={adj.amount}
              onChange={(e) => setAdj({ ...adj, amount: e.target.value })}
              placeholder="Amount ₹"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={adj.direction}
              onChange={(e) => setAdj({ ...adj, direction: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="CREDIT">Credit</option>
              <option value="DEBIT">Debit</option>
            </select>
            <input
              value={adj.reason}
              onChange={(e) => setAdj({ ...adj, reason: e.target.value })}
              placeholder="Reason"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm sm:col-span-1"
            />
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await adminFranchiseApi.adjustWallet(id, adj);
                toast.success("Wallet adjusted");
                setAdj({ amount: "", direction: "CREDIT", reason: "" });
                await load();
              } catch (err) {
                toast.error(err?.response?.data?.message || "Adjustment failed");
              } finally {
                setSaving(false);
              }
            }}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold disabled:opacity-50"
          >
            Apply adjustment
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Stock on hand</h2>
        </div>
        {(stock || []).length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No stock purchased yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-right px-4 py-3">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => (
                <tr key={s._id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{s.product?.name || "Product"}</td>
                  <td className="px-4 py-3 text-right font-bold">{s.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
};

export default FranchisePartnerDetail;
