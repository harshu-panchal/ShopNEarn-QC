import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Package, RefreshCcw, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import {
  FranchisePageShell,
  FranchiseStatCard,
  SectionCard,
  ProductThumb,
  EmptyState,
  formatINR,
} from "./franchiseCustomerShared";

const FranchiseStockPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await franchiseApi.getStock();
      setItems(res.data?.result?.items ?? res.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load stock");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const skuCount = items.length;
    const totalUnits = items.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    const estValue = items.reduce(
      (sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.product?.price) || 0),
      0,
    );
    return { skuCount, totalUnits, estValue };
  }, [items]);

  return (
    <>
      <FranchiseMlmHeader title="My Stock" />
      <FranchisePageShell
        title="My stock inventory"
        subtitle="Products you hold locally to fulfill customer orders routed to your location."
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg"
          >
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FranchiseStatCard label="SKUs" value={loading ? "…" : stats.skuCount} tone="indigo" />
          <FranchiseStatCard label="Total units" value={loading ? "…" : stats.totalUnits} tone="emerald" />
          <FranchiseStatCard
            label="Est. stock value"
            value={loading ? "…" : formatINR(stats.estValue)}
            hint="At hub catalog prices"
            tone="amber"
          />
        </div>

        <SectionCard title="Inventory">
          {loading ? (
            <p className="p-6 text-sm text-slate-500 text-center">Loading stock…</p>
          ) : items.length === 0 ? (
            <EmptyState
              message="No stock yet. Purchase inventory from the hub catalog using your wallet."
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
                    <th className="text-right px-4 py-3">Unit price</th>
                    <th className="text-right px-4 py-3">Qty</th>
                    <th className="text-right px-4 py-3">Line value</th>
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
                            <div>
                              <p className="font-semibold text-slate-900">
                                {row.product?.name || "Product"}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">
                                {row.productId}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">{formatINR(price)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center gap-1 font-black text-slate-900">
                            <Package size={14} className="text-indigo-500" />
                            {qty}
                          </span>
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

        {items.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-sm text-indigo-900">
            <p className="font-semibold">Fulfillment tip</p>
            <p className="text-indigo-800/80 mt-1 text-xs leading-relaxed">
              When a customer order is routed to you, accept it from Customer Orders and deliver from
              this inventory. Low stock? Buy more from the hub catalog.
            </p>
          </div>
        )}
      </FranchisePageShell>
    </>
  );
};

export default FranchiseStockPage;
