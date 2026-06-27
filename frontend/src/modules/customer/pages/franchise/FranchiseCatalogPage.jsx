import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ShoppingCart, Minus, Plus, Wallet, RefreshCcw } from "lucide-react";
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

const FranchiseCatalogPage = () => {
  const [items, setItems] = useState([]);
  const [hubName, setHubName] = useState("Harsh's Hub");
  const [walletBalance, setWalletBalance] = useState(0);
  const [cart, setCart] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  const load = async (q = search) => {
    setLoading(true);
    try {
      const [catalogRes, meRes] = await Promise.all([
        franchiseApi.getCatalog({ limit: 100, q: q.trim() || undefined }),
        franchiseApi.getMe(),
      ]);
      const catalog = catalogRes.data?.result ?? catalogRes.data?.data;
      setItems(catalog?.items ?? []);
      setHubName(catalog?.hubShopDisplayName || "Harsh's Hub");
      const me = meRes.data?.result ?? meRes.data?.data;
      setWalletBalance(me?.wallet?.availableBalance || 0);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setQty = (productId, delta) => {
    setCart((prev) => {
      const next = Math.max(0, (prev[productId] || 0) + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: next };
    });
  };

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const product = items.find((p) => String(p._id) === productId);
        const unitPrice = Number(product?.price) || 0;
        return { productId, quantity, product, unitPrice, lineTotal: unitPrice * quantity };
      });
  }, [cart, items]);

  const cartTotal = cartLines.reduce((sum, l) => sum + l.lineTotal, 0);
  const cartCount = cartLines.reduce((sum, l) => sum + l.quantity, 0);
  const canAfford = walletBalance >= cartTotal && cartTotal > 0;

  const purchase = async () => {
    if (!cartLines.length) return toast.error("Add items to cart");
    if (!canAfford) return toast.error("Insufficient wallet balance");
    setPurchasing(true);
    try {
      await franchiseApi.purchaseStock({
        items: cartLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      });
      toast.success("Stock purchased — check My Stock");
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
    return items.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <>
      <FranchiseMlmHeader title="Buy Stock" />
      <FranchisePageShell
        title={`${hubName} catalog`}
        subtitle="Purchase inventory using your franchise wallet balance."
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FranchiseStatCard label="Wallet balance" value={formatINR(walletBalance)} tone="indigo" />
          <FranchiseStatCard label="Cart total" value={formatINR(cartTotal)} tone="amber" />
          <FranchiseStatCard
            label="Items in cart"
            value={cartCount}
            hint={canAfford ? "Ready to purchase" : cartTotal > 0 ? "Top up wallet if needed" : "Add products below"}
            tone={canAfford ? "emerald" : "slate"}
          />
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search products…"
            className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl bg-white"
          />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((p) => {
              const qty = cart[p._id] || 0;
              return (
                <div
                  key={p._id}
                  className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3 shadow-sm"
                >
                  <ProductThumb product={p} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 truncate">{p.name}</p>
                    <p className="text-lg font-black text-indigo-600 mt-0.5">{formatINR(p.price)}</p>
                    {p.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => setQty(p._id, -1)}
                        disabled={qty === 0}
                        className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-40"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center font-bold">{qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty(p._id, 1)}
                        className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
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
              <button
                type="button"
                onClick={purchase}
                disabled={purchasing || !canAfford}
                className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 font-bold py-3 rounded-xl"
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
