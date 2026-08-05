import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ShoppingCart, Minus, Plus, Wallet, RefreshCcw, PackageCheck, Layers } from "lucide-react";
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
import { getAvailableStock, getProductSellingPrice, stockLimitToastMessage } from "@/core/utils/productStock";

export const FranchiseCatalogPage = () => {
  const [items, setItems] = useState([]);
  const [hubName, setHubName] = useState("Harsh's Hub");
  const [walletBalance, setWalletBalance] = useState(0);
  const [hasCompletedFirstTopup, setHasCompletedFirstTopup] = useState(true);
  const [cart, setCart] = useState({}); // key: `${productId}:${variantSku || ''}`, value: qty
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  const load = async (q = search) => {
    setLoading(true);
    try {
      const [catalogRes, meRes] = await Promise.all([
        franchiseApi.getCatalog({ limit: 2000, q: q.trim() || undefined }),
        franchiseApi.getMe(),
      ]);
      const catalog = catalogRes.data?.result ?? catalogRes.data?.data;
      setItems(catalog?.items ?? []);
      setHubName(catalog?.hubShopDisplayName || "Harsh's Hub");
      const me = meRes.data?.result ?? meRes.data?.data;
      setWalletBalance(me?.wallet?.availableBalance || 0);
      setHasCompletedFirstTopup(me?.partner?.hasCompletedFirstTopup ?? true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setQty = (productId, variantSku = "", delta = 0) => {
    if (!hasCompletedFirstTopup) {
      return toast.info("For your 1st top-up, products are directly selected & sent by Admin.");
    }
    const product = items.find((p) => String(p._id) === String(productId));
    if (!product) return;

    const cartKey = `${productId}:${variantSku || ""}`;

    setCart((prev) => {
      const current = prev[cartKey] || 0;
      const next = Math.max(0, current + delta);
      const available = getAvailableStock(product, variantSku);

      if (delta > 0 && next > available) {
        toast.error(stockLimitToastMessage(product, variantSku, available));
        return prev;
      }

      if (next === 0) {
        const copy = { ...prev };
        delete copy[cartKey];
        return copy;
      }
      return { ...prev, [cartKey]: next };
    });
  };

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([cartKey, quantity]) => {
        const [productId, variantSku = ""] = cartKey.split(":");
        const product = items.find((p) => String(p._id) === productId);

        let variantName = "";
        if (variantSku && Array.isArray(product?.variants)) {
          const hit = product.variants.find(
            (v) => String(v.sku || "").trim() === variantSku || String(v.name || "").trim() === variantSku
          );
          if (hit) variantName = hit.name || "";
        }

        const unitPrice = getProductSellingPrice(product, variantSku);
        return {
          cartKey,
          productId,
          variantSku,
          variantName,
          quantity,
          product,
          unitPrice,
          lineTotal: unitPrice * quantity,
        };
      });
  }, [cart, items]);

  const cartTotal = cartLines.reduce((sum, l) => sum + l.lineTotal, 0);
  const cartCount = cartLines.reduce((sum, l) => sum + l.quantity, 0);
  const canAfford = walletBalance >= cartTotal && cartTotal > 0;

  const purchase = async () => {
    if (!hasCompletedFirstTopup) {
      return toast.error("For your 1st top-up, products are directly selected & sent by Admin.");
    }
    if (!cartLines.length) return toast.error("Add items to cart");
    if (!canAfford) return toast.error("Insufficient wallet balance");
    setPurchasing(true);
    try {
      await franchiseApi.purchaseStock({
        items: cartLines.map((l) => ({
          productId: l.productId,
          variantSku: l.variantSku || undefined,
          quantity: l.quantity,
        })),
      });
      toast.success("Stock purchased successfully — check My Stock");
      setCart({});
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Purchase failed");
    } finally {
      setPurchasing(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => {
      const nameMatch = p.name?.toLowerCase().includes(q);
      const descMatch = p.description?.toLowerCase().includes(q);
      const variantMatch = Array.isArray(p.variants) && p.variants.some(
        (v) => v.name?.toLowerCase().includes(q) || v.sku?.toLowerCase().includes(q)
      );
      return nameMatch || descMatch || variantMatch;
    });
  }, [items, search]);

  return (
    <>
      <FranchiseMlmHeader title="Buy Stock" />
      <FranchisePageShell
        title={`${hubName} catalog`}
        subtitle={`Purchase inventory using your franchise wallet balance. (${items.length} products available in ${hubName})`}
        actions={
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg"
          >
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        {!hasCompletedFirstTopup && (
          <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 text-xs sm:text-sm flex items-start gap-3 shadow-xs mb-2">
            <PackageCheck className="text-purple-600 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-bold text-purple-950">First Top-Up Notice</p>
              <p className="mt-0.5 text-purple-800">
                For your first top-up, products are directly selected and dispatched to you by Admin upon top-up approval.
                Self-purchasing stock from the catalog will open after your first top-up is completed.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FranchiseStatCard
            label="Available Products"
            value={loading ? "…" : items.length}
            hint={`In ${hubName} catalog`}
            tone="purple"
          />
          <FranchiseStatCard label="Wallet balance" value={formatINR(walletBalance)} tone="indigo" />
          <FranchiseStatCard label="Cart total" value={formatINR(cartTotal)} tone="amber" />
          <FranchiseStatCard
            label="Items in cart"
            value={cartCount}
            hint={!hasCompletedFirstTopup ? "Admin managed for 1st topup" : canAfford ? "Ready to purchase" : cartTotal > 0 ? "Top up wallet if needed" : "Add products below"}
            tone={canAfford ? "emerald" : "slate"}
          />
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Search by product name, variant, or SKU…"
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white"
            />
          </div>
          <div className="px-4 py-3 bg-purple-100/70 border border-purple-200 text-purple-950 font-extrabold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-xs whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-600 animate-pulse"></span>
            {hubName}: <span className="font-black">{items.length}</span> Products Available
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 text-center py-8">Loading catalog…</p>
        ) : filtered.length === 0 ? (
          <SectionCard>
            <EmptyState
              message="No products available from the hub yet."
              action={
                <Link to="/mlm/franchise/wallet" className="inline-block mt-3 text-indigo-600 font-semibold text-sm">
                  Top up wallet first →
                </Link>
              }
            />
          </SectionCard>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((p) => {
              const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
              const overallAvailable = getAvailableStock(p, "");

              return (
                <div
                  key={p._id}
                  className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col justify-between shadow-sm space-y-3"
                >
                  <div className="flex gap-3">
                    <ProductThumb product={p} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-slate-900 truncate">{p.name}</p>
                        {hasVariants && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-100 shrink-0">
                            <Layers size={11} /> {p.variants.length} Variants
                          </span>
                        )}
                      </div>
                      <p className="text-base font-black text-indigo-600 mt-0.5">
                        {formatINR(getProductSellingPrice(p, ""))}
                      </p>
                      {p.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Variant-Wise Section */}
                  {hasVariants ? (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-2">
                      <p className="text-[11px] font-black text-slate-600 uppercase tracking-wider px-1">
                        Select Variant & Quantity
                      </p>
                      <div className="divide-y divide-slate-200/80">
                        {p.variants.map((v, idx) => {
                          const vSku = String(v.sku || v.name || "").trim();
                          const cartKey = `${p._id}:${vSku}`;
                          const qty = cart[cartKey] || 0;
                          const vStock = getAvailableStock(p, vSku);
                          const vPrice = Number(v.salePrice) > 0 ? Number(v.salePrice) : Number(v.price) || Number(p.price) || 0;
                          const isOutOfStock = vStock <= 0;
                          const atStockLimit = qty >= vStock;

                          return (
                            <div
                              key={vSku || idx}
                              className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-slate-900 truncate">{v.name || "Variant"}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs font-black text-indigo-600">{formatINR(vPrice)}</span>
                                  {v.sku && <span className="text-[10px] text-slate-400 font-mono">SKU: {v.sku}</span>}
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                      isOutOfStock
                                        ? "bg-red-50 text-red-600 border border-red-100"
                                        : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                    }`}
                                  >
                                    {isOutOfStock ? "Out of Stock" : `${vStock} left`}
                                  </span>
                                </div>
                              </div>

                              {/* Quantity controls per variant */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setQty(p._id, vSku, -1)}
                                  disabled={qty === 0 || !hasCompletedFirstTopup}
                                  className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center disabled:opacity-30"
                                >
                                  <Minus size={12} />
                                </button>
                                <span className="w-6 text-center font-extrabold text-xs">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => setQty(p._id, vSku, 1)}
                                  disabled={isOutOfStock || atStockLimit || !hasCompletedFirstTopup}
                                  className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* Single Product Section */
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-3">
                      <div>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                            overallAvailable <= 0
                              ? "bg-red-50 text-red-600 border border-red-100"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                          }`}
                        >
                          {overallAvailable <= 0 ? "Out of Stock" : `${overallAvailable} available`}
                        </span>
                      </div>
                      {(() => {
                        const cartKey = `${p._id}:`;
                        const qty = cart[cartKey] || 0;
                        const isOutOfStock = overallAvailable <= 0;
                        const atStockLimit = qty >= overallAvailable;

                        return (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setQty(p._id, "", -1)}
                              disabled={qty === 0 || !hasCompletedFirstTopup}
                              className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center disabled:opacity-40"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="w-6 text-center font-bold text-sm">{qty}</span>
                            <button
                              type="button"
                              onClick={() => setQty(p._id, "", 1)}
                              disabled={isOutOfStock || atStockLimit || !hasCompletedFirstTopup}
                              className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {cartLines.length > 0 && (
          <div className="sticky bottom-4 z-10">
            <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-xl border border-slate-700">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <ShoppingCart size={18} />
                  <span className="font-bold">{cartCount} items · {formatINR(cartTotal)}</span>
                </div>
                {!canAfford && (
                  <Link
                    to="/mlm/franchise/wallet"
                    className="text-xs font-bold text-amber-300 flex items-center gap-1"
                  >
                    <Wallet size={14} /> Top up
                  </Link>
                )}
              </div>

              {/* Cart line details preview */}
              <div className="max-h-24 overflow-y-auto mb-3 space-y-1 text-xs text-slate-300 divide-y divide-slate-800">
                {cartLines.map((l) => (
                  <div key={l.cartKey} className="pt-1 flex items-center justify-between">
                    <span className="truncate">
                      {l.product?.name} {l.variantName ? `(${l.variantName})` : ""} × {l.quantity}
                    </span>
                    <span className="font-bold text-white shrink-0 ml-2">{formatINR(l.lineTotal)}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={purchase}
                disabled={purchasing || !canAfford}
                className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 font-bold py-3 rounded-xl transition-colors"
              >
                {purchasing ? "Processing…" : `Buy stock (${formatINR(cartTotal)})`}
              </button>
            </div>
          </div>
        )}
      </FranchisePageShell>
    </>
  );
};

export default FranchiseCatalogPage;
