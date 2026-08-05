import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  History,
  Search,
  Minus,
  Plus,
  ShoppingCart,
  User,
  Banknote,
  Smartphone,
  Coins,
  Wallet,
  ShoppingBag,
  Loader2,
  Printer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import PosReceiptPrint from "./PosReceiptPrint";
import {
  FranchisePageShell,
  ProductThumb,
  formatINR,
  EmptyState,
} from "./franchiseCustomerShared";

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const FranchisePosPage = () => {
  const navigate = useNavigate();
  const printRef = useRef(null);
  const [posEnabled, setPosEnabled] = useState(false);
  const [loadingMe, setLoadingMe] = useState(true);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [cart, setCart] = useState({});
  const [buyerKind, setBuyerKind] = useState("guest");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [registeredCustomer, setRegisteredCustomer] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [upiReference, setUpiReference] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);

  useEffect(() => {
    franchiseApi
      .getMe()
      .then((res) => {
        const data = res.data?.result ?? res.data?.data;
        setPosEnabled(!!data?.config?.posEnabled);
        if (!data?.isPartner) {
          toast.error("Active franchise partnership required");
          navigate("/mlm/franchise");
        }
      })
      .catch(() => toast.error("Failed to load franchise profile"))
      .finally(() => setLoadingMe(false));
  }, [navigate]);

  const loadProducts = useCallback(async (q = search) => {
    setLoadingProducts(true);
    try {
      const res = await franchiseApi.getPosProducts({ limit: 100, q: q.trim() || undefined });
      const payload = res.data?.result ?? res.data?.data;
      const items = [...(payload?.items ?? [])].sort((a, b) => {
        const aOn = Number(a.onHandQty) > 0;
        const bOn = Number(b.onHandQty) > 0;
        if (aOn !== bOn) return aOn ? -1 : 1;
        if (Number(b.onHandQty) !== Number(a.onHandQty)) {
          return Number(b.onHandQty) - Number(a.onHandQty);
        }
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      setProducts(items);
    } catch (err) {
      const code = err?.response?.data?.result?.code ?? err?.response?.data?.code;
      if (code === "POS_DISABLED") {
        setPosEnabled(false);
      }
      toast.error(err?.response?.data?.message || "Failed to load products");
    } finally {
      setLoadingProducts(false);
    }
  }, [search]);

  useEffect(() => {
    if (!loadingMe && posEnabled) loadProducts("");
  }, [loadingMe, posEnabled, loadProducts]);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const product = products.find((p) => String(p._id) === String(productId));
        const unitPrice = product?.unitPrice ?? 0;
        return {
          productId,
          quantity,
          product,
          unitPrice,
          lineTotal: unitPrice * quantity,
        };
      });
  }, [cart, products]);

  const cartTotal = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.lineTotal, 0),
    [cartLines],
  );

  const setQty = (productId, delta) => {
    const product = products.find((p) => String(p._id) === String(productId));
    if (!product) return;
    const max = Number(product.onHandQty) || 0;
    if (max <= 0) {
      toast.info("Out of stock — buy stock from hub first", {
        action: { label: "Buy stock", onClick: () => navigate("/mlm/franchise/catalog") },
      });
      return;
    }
    setCart((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      if (next > max) {
        toast.error(`Only ${max} on hand`);
        return prev;
      }
      if (next === 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: next };
    });
  };

  const handleLookup = async () => {
    if (!lookupPhone.trim()) return toast.error("Enter phone number");
    setLookupLoading(true);
    try {
      const res = await franchiseApi.lookupPosCustomer(lookupPhone.trim());
      const customer = res.data?.result ?? res.data?.data;
      setRegisteredCustomer(customer);
      toast.success(`Found ${customer.name || "customer"}`);
    } catch (err) {
      setRegisteredCustomer(null);
      toast.error(err?.response?.data?.message || "Customer not found");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (cartLines.length === 0) return toast.error("Cart is empty");
    if (buyerKind === "registered" && !registeredCustomer?.id) {
      return toast.error("Look up a registered customer first");
    }
    if (paymentMethod === "shopping_wallet" || paymentMethod === "earnings_wallet") {
      if (buyerKind !== "registered" || !registeredCustomer?.id) {
        return toast.error("Wallet payment requires selecting a registered customer");
      }
      if (paymentMethod === "shopping_wallet") {
        const bal = Number(registeredCustomer.shoppingWalletBalance || 0);
        if (bal < cartTotal) {
          return toast.error(
            `Insufficient Shopping Wallet balance (${formatINR(bal)} available, ${formatINR(cartTotal)} required)`,
          );
        }
      }
      if (paymentMethod === "earnings_wallet") {
        const bal = Number(registeredCustomer.earningsWalletBalance || 0);
        if (bal < cartTotal) {
          return toast.error(
            `Insufficient Earning Wallet balance (${formatINR(bal)} available, ${formatINR(cartTotal)} required)`,
          );
        }
      }
    }
    if (paymentMethod === "upi_partner" && !upiReference.trim()) {
      return toast.error("Enter UPI reference / transaction note");
    }

    setCheckoutLoading(true);
    const idempotencyKey = newIdempotencyKey();
    try {
      const buyer =
        buyerKind === "registered"
          ? {
              kind: "registered",
              customerId: registeredCustomer.id,
              name: registeredCustomer.name,
              phone: registeredCustomer.phone,
            }
          : { kind: "guest", name: guestName, phone: guestPhone };

      const res = await franchiseApi.createPosSale(
        {
          items: cartLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          buyer,
          payment: {
            method: paymentMethod,
            upiReference: paymentMethod === "upi_partner" ? upiReference : "",
          },
        },
        idempotencyKey,
      );
      const payload = res.data?.result ?? res.data?.data;
      setReceipt(payload.receipt);
      setShowReceipt(true);
      setCart({});
      setUpiReference("");
      toast.success(payload.duplicate ? "Sale already recorded" : "Sale completed");
      loadProducts(search);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Checkout failed");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loadingMe) {
    return (
      <>
        <FranchiseMlmHeader title="Bill customer" />
        <div className="p-8 text-center text-slate-500">Loading…</div>
      </>
    );
  }

  if (!posEnabled) {
    return (
      <>
        <FranchiseMlmHeader title="Bill customer" />
        <FranchisePageShell title="Store POS" subtitle="Offline billing is not enabled for your account yet.">
          <EmptyState message="Ask your administrator to enable Franchise POS in Home Shoppy settings." />
          <Link to="/mlm/franchise" className="text-sm font-semibold text-indigo-600">
            Back to dashboard
          </Link>
        </FranchisePageShell>
      </>
    );
  }

  return (
    <>
      <FranchiseMlmHeader title="Bill customer" />
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Home Shoppy POS</p>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">Bill walk-in customer</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <Link
              to="/mlm/franchise/pos/history"
              className="inline-flex items-center gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-xl"
            >
              <History size={14} /> Order history
            </Link>
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadProducts(search)}
                placeholder="Search hub catalog…"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-3">
            {loadingProducts ? (
              <p className="text-slate-500 text-sm">Loading products…</p>
            ) : products.length === 0 ? (
              <EmptyState message="Hub catalog is empty or unavailable." />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {products.map((product) => {
                  const id = String(product._id);
                  const inCart = cart[id] || 0;
                  const canSell = product.canSell && product.onHandQty > 0;
                  return (
                    <div
                      key={id}
                      className={`bg-white border rounded-2xl p-3 flex flex-col ${canSell ? "border-slate-200" : "border-slate-100 opacity-75"}`}
                    >
                      <div className="w-full aspect-square rounded-xl mb-2 overflow-hidden bg-slate-50">
                        <ProductThumb product={product} size="md" />
                      </div>
                      <p className="text-xs font-bold text-slate-900 line-clamp-2 flex-1">{product.name}</p>
                      <p className="text-sm font-black text-indigo-600 mt-1">{formatINR(product.unitPrice)}</p>
                      <p
                        className={`text-[10px] font-bold uppercase mt-1 ${canSell ? "text-emerald-600" : "text-rose-500"}`}
                      >
                        On hand: {product.onHandQty ?? 0}
                      </p>
                      <div className="flex items-center justify-between mt-2 gap-1">
                        <button
                          type="button"
                          disabled={!canSell && inCart === 0}
                          onClick={() => setQty(id, -1)}
                          className="p-2 rounded-lg border border-slate-200 disabled:opacity-40"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="font-bold text-sm w-8 text-center">{inCart}</span>
                        <button
                          type="button"
                          disabled={!canSell}
                          onClick={() => setQty(id, 1)}
                          className="p-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-3">
                <ShoppingCart size={18} /> Cart
              </h2>
              {cartLines.length === 0 ? (
                <p className="text-xs text-slate-500">Add products with stock on hand.</p>
              ) : (
                <ul className="space-y-2 text-sm max-h-48 overflow-y-auto">
                  {cartLines.map((line) => (
                    <li key={line.productId} className="flex justify-between gap-2">
                      <span className="line-clamp-1">{line.product?.name}</span>
                      <span className="shrink-0 font-semibold">
                        {line.quantity} × {formatINR(line.unitPrice)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-between font-black text-lg mt-3 pt-3 border-t border-slate-100">
                <span>Total</span>
                <span>{formatINR(cartTotal)}</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <User size={18} /> Customer
              </h2>
              <div className="flex gap-2">
                {["guest", "registered"].map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setBuyerKind(kind)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase ${
                      buyerKind === kind ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {kind}
                  </button>
                ))}
              </div>
              {buyerKind === "guest" ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Name (optional)"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="tel"
                    placeholder="Phone (optional)"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      placeholder="Registered phone"
                      value={lookupPhone}
                      onChange={(e) => setLookupPhone(e.target.value)}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleLookup}
                      disabled={lookupLoading}
                      className="px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold"
                    >
                      {lookupLoading ? "…" : "Find"}
                    </button>
                  </div>
                  {registeredCustomer && (
                    <div className="text-xs space-y-1 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 mt-2">
                      <p className="font-bold text-emerald-800">
                        {registeredCustomer.name} · {registeredCustomer.phone}
                      </p>
                      <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-emerald-700 mt-1">
                        <span className="bg-emerald-100/80 px-2 py-0.5 rounded-md">
                          Shopping: {formatINR(registeredCustomer.shoppingWalletBalance || 0)}
                        </span>
                        <span className="bg-emerald-100/80 px-2 py-0.5 rounded-md">
                          Earning: {formatINR(registeredCustomer.earningsWalletBalance || 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <h2 className="font-bold text-slate-900">Payment</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("cash")}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold ${
                    paymentMethod === "cash"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200"
                  }`}
                >
                  <Banknote size={16} /> Cash
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("upi_partner")}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold ${
                    paymentMethod === "upi_partner"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200"
                  }`}
                >
                  <Smartphone size={16} /> UPI
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (buyerKind !== "registered") {
                      setBuyerKind("registered");
                      toast.info("Switched to Registered customer mode for wallet payment");
                    }
                    setPaymentMethod("shopping_wallet");
                  }}
                  className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-xl border text-xs font-bold ${
                    paymentMethod === "shopping_wallet"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <ShoppingBag size={14} /> Shopping Wallet
                  </div>
                  {registeredCustomer && (
                    <span className="text-[10px] opacity-80 mt-0.5">
                      {formatINR(registeredCustomer.shoppingWalletBalance || 0)}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (buyerKind !== "registered") {
                      setBuyerKind("registered");
                      toast.info("Switched to Registered customer mode for wallet payment");
                    }
                    setPaymentMethod("earnings_wallet");
                  }}
                  className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-xl border text-xs font-bold ${
                    paymentMethod === "earnings_wallet"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <Coins size={14} /> Earning Wallet
                  </div>
                  {registeredCustomer && (
                    <span className="text-[10px] opacity-80 mt-0.5">
                      {formatINR(registeredCustomer.earningsWalletBalance || 0)}
                    </span>
                  )}
                </button>
              </div>
              {paymentMethod === "upi_partner" && (
                <input
                  type="text"
                  placeholder="UPI ref / note"
                  value={upiReference}
                  onChange={(e) => setUpiReference(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              )}
              <button
                type="button"
                disabled={checkoutLoading || cartLines.length === 0}
                onClick={handleCheckout}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {checkoutLoading ? <Loader2 className="animate-spin" size={18} /> : null}
                Complete sale
              </button>
            </div>
          </div>
        </div>
      </div>

      {showReceipt && receipt && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 print:hidden">
              <h3 className="font-bold">Receipt</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold"
                >
                  <Printer size={14} /> Print
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowReceipt(false);
                    setReceipt(null);
                  }}
                  className="p-2 rounded-lg border border-slate-200"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <PosReceiptPrint receipt={receipt} printRef={printRef} />
          </div>
        </div>
      )}
    </>
  );
};

export default FranchisePosPage;
