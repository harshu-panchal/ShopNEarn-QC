import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "@shared/components/ui/Badge";
import Pagination from "@shared/components/ui/Pagination";
import {
  HiOutlineCube,
  HiOutlineExclamationTriangle,
  HiOutlineArchiveBoxXMark,
  HiOutlineArrowsUpDown,
  HiOutlineArrowDownTray,
  HiOutlineArrowUpTray,
  HiOutlineClipboardDocumentList,
  HiOutlinePlus,
  HiOutlineMinus,
} from "react-icons/hi2";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { sellerApi } from "../services/sellerApi";
import { toast } from "sonner";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "incoming", label: "Incoming" },
  { id: "outgoing", label: "Outgoing" },
  { id: "log", label: "Movement log" },
];

const ADJUST_TYPES = [
  { value: "Restock", label: "Restock (incoming)" },
  { value: "Damage", label: "Damage / loss (outgoing)" },
  { value: "Correction", label: "Correction" },
];

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const InventoryManagement = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [movements, setMovements] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [adjustType, setAdjustType] = useState("Restock");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  const direction = useMemo(() => {
    if (activeTab === "incoming") return "incoming";
    if (activeTab === "outgoing") return "outgoing";
    return undefined;
  }, [activeTab]);

  const loadSummary = useCallback(async () => {
    const res = await sellerApi.getInventorySummary();
    if (res.data.success) setSummary(res.data.result || null);
  }, []);

  const loadProducts = useCallback(async () => {
    const res = await sellerApi.getProducts({ page: 1, limit: 200 });
    if (res.data.success) {
      const payload = res.data.result || {};
      setProducts(Array.isArray(payload.items) ? payload.items : []);
    }
  }, []);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (direction) params.direction = direction;
      const res = await sellerApi.getStockHistory(params);
      if (res.data.success) {
        const payload = res.data.result || {};
        setMovements(payload.items || []);
        setTotalPages(payload.totalPages || 1);
      }
    } catch {
      toast.error("Failed to load movements");
    } finally {
      setLoading(false);
    }
  }, [page, direction]);

  useEffect(() => {
    loadSummary();
    loadProducts();
  }, [loadSummary, loadProducts]);

  useEffect(() => {
    if (activeTab === "overview") {
      loadSummary();
      setLoading(false);
    } else {
      loadMovements();
    }
  }, [activeTab, loadMovements, loadSummary]);

  const handleAdjust = async () => {
    const qty = parseInt(adjustQty, 10);
    if (!selectedProduct || !qty || qty <= 0) {
      toast.error("Select a product and valid quantity");
      return;
    }
    try {
      const signedQty =
        adjustType === "Restock"
          ? qty
          : adjustType === "Damage"
            ? qty
            : adjustType === "Correction" && adjustNote.includes("-")
              ? -qty
              : qty;
      const res = await sellerApi.adjustStock({
        productId: selectedProduct,
        type: adjustType,
        quantity: adjustType === "Correction" ? signedQty : qty,
        note: adjustNote,
      });
      if (res.data.success) {
        toast.success("Stock adjusted");
        setAdjustOpen(false);
        loadSummary();
        if (activeTab !== "overview") loadMovements();
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Adjustment failed");
    }
  };

  const stats = [
    {
      label: "SKUs",
      value: summary?.skuCount ?? "—",
      icon: HiOutlineCube,
      color: "text-brand-600",
      bg: "bg-brand-50",
    },
    {
      label: "Total units",
      value: summary?.totalUnits ?? "—",
      icon: HiOutlineArrowsUpDown,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
    {
      label: "Low stock",
      value: summary?.lowStock ?? "—",
      icon: HiOutlineExclamationTriangle,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      label: "Out of stock",
      value: summary?.outOfStock ?? "—",
      icon: HiOutlineArchiveBoxXMark,
      color: "text-rose-600",
      bg: "bg-rose-50",
    },
    {
      label: "Valuation",
      value: summary ? `₹${Number(summary.valuation || 0).toLocaleString()}` : "—",
      icon: HiOutlineClipboardDocumentList,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
  ];

  return (
    <div className="space-y-6 pb-16">
      <BlurFade delay={0.1}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              Inventory Management
              <Badge className="text-[9px] px-1.5 py-0 font-bold uppercase bg-indigo-100 text-indigo-700">
                Harsh&apos;s Hub
              </Badge>
            </h1>
            <p className="text-slate-600 text-sm mt-0.5">
              Track incoming and outgoing stock, transfers to franchise partners, and manual adjustments.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/seller/inventory"
              className="px-4 py-2 text-xs font-bold uppercase rounded-xl border border-slate-200 bg-white text-slate-600"
            >
              Simple stock view
            </Link>
            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              className="px-4 py-2 text-xs font-bold uppercase rounded-xl bg-brand-600 text-white"
            >
              Manual adjust
            </button>
          </div>
        </div>
      </BlurFade>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              setPage(1);
            }}
            className={cn(
              "px-4 py-2 text-xs font-black uppercase rounded-lg transition-colors",
              activeTab === tab.id
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:bg-slate-100",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {stats.map((s) => (
            <div key={s.label} className={cn("rounded-2xl p-4 border border-slate-100", s.bg)}>
              <s.icon className={cn("h-5 w-5 mb-2", s.color)} />
              <p className="text-[10px] font-bold uppercase text-slate-500">{s.label}</p>
              <p className={cn("text-xl font-black", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {(activeTab === "incoming" || activeTab === "outgoing" || activeTab === "log") && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-sm text-slate-500">Loading movements…</p>
          ) : movements.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No movements found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Product</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-right px-4 py-3">Qty</th>
                    <th className="text-left px-4 py-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDate(m.date)}</td>
                      <td className="px-4 py-3 font-semibold">{m.productName}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase">
                          {m.direction === "incoming" ? (
                            <HiOutlineArrowDownTray className="text-emerald-600" />
                          ) : (
                            <HiOutlineArrowUpTray className="text-rose-600" />
                          )}
                          {m.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-black">{m.quantityLabel}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate">
                        {m.note || "—"}
                      </td>
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
        </div>
      )}

      {adjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-black text-slate-900">Manual stock adjustment</h2>
            <select
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} (stock: {p.stock})
                </option>
              ))}
            </select>
            <select
              value={adjustType}
              onChange={(e) => setAdjustType(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              {ADJUST_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
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
              placeholder="Note (for Correction (-) prefix note with minus)"
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
                className="px-4 py-2 text-sm font-bold bg-brand-600 text-white rounded-xl flex items-center gap-1"
              >
                {adjustType === "Restock" ? <HiOutlinePlus /> : <HiOutlineMinus />}
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryManagement;
