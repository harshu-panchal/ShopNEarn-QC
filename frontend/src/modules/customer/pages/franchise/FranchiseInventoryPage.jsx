import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Package,
  RefreshCcw,
  ShoppingBag,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import Pagination from "@shared/components/ui/Pagination";
import {
  FranchisePageShell,
  FranchiseStatCard,
  SectionCard,
  ProductThumb,
  EmptyState,
  formatINR,
} from "./franchiseCustomerShared";

const TABS = [
  { id: "onhand", label: "On hand" },
  { id: "incoming", label: "Incoming" },
  { id: "outgoing", label: "Outgoing" },
  { id: "log", label: "Movement log" },
];

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FranchiseInventoryPage = () => {
  const [activeTab, setActiveTab] = useState("onhand");
  const [summary, setSummary] = useState(null);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [adjustType, setAdjustType] = useState("DAMAGE");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  const direction = useMemo(() => {
    if (activeTab === "incoming") return "incoming";
    if (activeTab === "outgoing") return "outgoing";
    return undefined;
  }, [activeTab]);

  const items = summary?.items || [];

  const loadSummary = useCallback(async () => {
    const res = await franchiseApi.getInventorySummary();
    setSummary(res.data?.result || res.data?.data || null);
  }, []);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (direction) params.direction = direction;
      const res = await franchiseApi.getInventoryMovements(params);
      const payload = res.data?.result || res.data?.data || {};
      setMovements(payload.items || []);
      setTotalPages(payload.totalPages || 1);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load movements");
    } finally {
      setLoading(false);
    }
  }, [page, direction]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        await loadSummary();
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [loadSummary]);

  useEffect(() => {
    if (activeTab === "onhand") return;
    loadMovements();
  }, [activeTab, loadMovements]);

  const handleAdjust = async () => {
    const qty = parseInt(adjustQty, 10);
    if (!selectedProduct || !qty) {
      toast.error("Select product and quantity");
      return;
    }
    try {
      const signedQty =
        adjustType === "CORRECTION" && adjustNote.trim().startsWith("-")
          ? -qty
          : qty;
      await franchiseApi.adjustInventory({
        productId: selectedProduct,
        type: adjustType,
        quantity: signedQty,
        note: adjustNote,
      });
      toast.success("Inventory adjusted");
      setAdjustOpen(false);
      await loadSummary();
      if (activeTab !== "onhand") await loadMovements();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Adjustment failed");
    }
  };

  return (
    <>
      <FranchiseMlmHeader title="Inventory" />
      <FranchisePageShell
        title="Inventory management"
        subtitle="Track stock received from the hub, fulfilled to customers, and manual adjustments."
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                loadSummary();
                if (activeTab !== "onhand") loadMovements();
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg"
            >
              <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-indigo-600 text-white rounded-lg"
            >
              <ClipboardList size={14} /> Adjust
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FranchiseStatCard
            label="SKUs"
            value={loading ? "…" : summary?.skuCount ?? 0}
            tone="indigo"
          />
          <FranchiseStatCard
            label="Total units"
            value={loading ? "…" : summary?.totalUnits ?? 0}
            tone="emerald"
          />
          <FranchiseStatCard
            label="Low stock"
            value={loading ? "…" : summary?.lowStock ?? 0}
            tone="amber"
          />
          <FranchiseStatCard
            label="Est. value"
            value={loading ? "…" : formatINR(summary?.valuation ?? 0)}
            tone="amber"
          />
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-black uppercase rounded-lg ${
                activeTab === tab.id
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "onhand" && (
          <SectionCard title="On-hand inventory">
            {loading ? (
              <p className="p-6 text-sm text-slate-500 text-center">Loading…</p>
            ) : items.length === 0 ? (
              <EmptyState
                message="No stock yet. Purchase from the hub catalog."
                action={
                  <Link
                    to="/mlm/franchise/catalog"
                    className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm"
                  >
                    <ShoppingBag size={16} /> Buy stock
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-3">Product</th>
                      <th className="text-right px-4 py-3">Qty</th>
                      <th className="text-right px-4 py-3">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => {
                      const price = Number(row.product?.price) || 0;
                      const qty = Number(row.quantity) || 0;
                      return (
                        <tr key={row._id} className="border-t border-slate-100">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <ProductThumb product={row.product} size="sm" />
                              <span className="font-semibold">
                                {row.product?.name || "Product"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-black">
                            <Package size={14} className="inline text-indigo-500 mr-1" />
                            {qty}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-700">
                            {formatINR(price * qty)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}

        {(activeTab === "incoming" || activeTab === "outgoing" || activeTab === "log") && (
          <SectionCard title="Stock movements">
            {loading ? (
              <p className="p-6 text-sm text-slate-500 text-center">Loading movements…</p>
            ) : movements.length === 0 ? (
              <EmptyState message="No movements in this view yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">Product</th>
                      <th className="text-left px-4 py-3">Type</th>
                      <th className="text-right px-4 py-3">Qty</th>
                      <th className="text-right px-4 py-3">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-xs text-slate-500">{formatDate(m.date)}</td>
                        <td className="px-4 py-3 font-semibold">{m.productName}</td>
                        <td className="px-4 py-3 text-[10px] font-black uppercase">
                          {m.direction === "incoming" ? (
                            <ArrowDownToLine size={12} className="inline text-emerald-600 mr-1" />
                          ) : (
                            <ArrowUpFromLine size={12} className="inline text-rose-600 mr-1" />
                          )}
                          {m.type.replace(/_/g, " ")}
                        </td>
                        <td className="px-4 py-3 text-right font-black">{m.quantityLabel}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{m.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="p-4 border-t border-slate-100">
                <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </SectionCard>
        )}

        {adjustOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
              <h2 className="text-lg font-black text-slate-900">Adjust inventory</h2>
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              >
                <option value="">Select product</option>
                {items.map((row) => (
                  <option key={row._id} value={row.productId}>
                    {row.product?.name} (qty: {row.quantity})
                  </option>
                ))}
              </select>
              <select
                value={adjustType}
                onChange={(e) => setAdjustType(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              >
                <option value="DAMAGE">Damage / loss</option>
                <option value="CORRECTION">Correction (+/-)</option>
                <option value="RESTOCK">Manual restock</option>
              </select>
              <input
                type="number"
                min={1}
                placeholder="Quantity"
                value={adjustQty}
                onChange={(e) => setAdjustQty(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
              <textarea
                placeholder="Note (prefix with - for correction decrease)"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                rows={2}
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setAdjustOpen(false)}
                  className="px-4 py-2 text-sm font-bold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdjust}
                  className="px-4 py-2 text-sm font-bold bg-indigo-600 text-white rounded-xl"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </FranchisePageShell>
    </>
  );
};

export default FranchiseInventoryPage;
