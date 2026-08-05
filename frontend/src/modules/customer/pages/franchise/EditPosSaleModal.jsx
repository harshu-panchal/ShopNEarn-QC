import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Search,
  Minus,
  Plus,
  ShoppingCart,
  User,
  Banknote,
  Smartphone,
  ShoppingBag,
  Coins,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import { ProductThumb, formatINR } from "./franchiseCustomerShared";

export const EditPosSaleModal = ({ orderId, onClose, onUpdated }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState({});
  const [originalOrder, setOriginalOrder] = useState(null);

  const [buyerKind, setBuyerKind] = useState("guest");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [registeredCustomer, setRegisteredCustomer] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [upiReference, setUpiReference] = useState("");
  const [reason, setReason] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, receiptRes] = await Promise.all([
        franchiseApi.getPosProducts({ limit: 100 }),
        franchiseApi.getPosReceipt(orderId),
      ]);

      const fetchedProducts = prodRes.data?.result?.items ?? prodRes.data?.data?.items ?? [];
      setProducts(fetchedProducts);

      const receipt = receiptRes.data?.result ?? receiptRes.data?.data;
      setOriginalOrder(receipt);

      if (receipt) {
        setPaymentMethod(receipt.paymentMethod || "cash");
        setUpiReference(receipt.upiReference || "");

        const initialCart = {};
        if (Array.isArray(receipt.lines)) {
          for (const line of receipt.lines) {
            const hit = fetchedProducts.find((p) => String(p.name).toLowerCase() === String(line.name).toLowerCase());
            const pId = hit ? String(hit._id) : line.productId;
            if (pId) {
              initialCart[pId] = Number(line.quantity) || 1;
            }
          }
        }
        setCart(initialCart);

        const buyer = receipt.buyer || {};
        if (buyer.kind === "registered" || buyer.customerId) {
          setBuyerKind("registered");
          setLookupPhone(buyer.phone || "");
          if (buyer.phone) {
            try {
              const custRes = await franchiseApi.lookupPosCustomer(buyer.phone);
              const cust = custRes.data?.result ?? custRes.data?.data;
              setRegisteredCustomer(cust);
            } catch {
              setRegisteredCustomer({
                id: buyer.customerId,
                name: buyer.name,
                phone: buyer.phone,
              });
            }
          }
        } else {
          setBuyerKind("guest");
          setGuestName(buyer.name || "");
          setGuestPhone(buyer.phone || "");
        }
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load bill details");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [orderId, onClose]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => String(p.name || "").toLowerCase().includes(q) || String(p.description || "").toLowerCase().includes(q),
    );
  }, [products, search]);

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

  const newTotal = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.lineTotal, 0),
    [cartLines],
  );

  const originalTotal = useMemo(
    () => Number(originalOrder?.grandTotal || 0),
    [originalOrder],
  );

  const priceDelta = newTotal - originalTotal;

  const setQty = (productId, delta) => {
    const product = products.find((p) => String(p._id) === String(productId));
    setCart((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
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

  const handleSave = async () => {
    if (cartLines.length === 0) return toast.error("Cart cannot be empty");
    if (buyerKind === "registered" && !registeredCustomer?.id) {
      return toast.error("Look up a registered customer first");
    }
    if ((paymentMethod === "shopping_wallet" || paymentMethod === "earnings_wallet") && buyerKind !== "registered") {
      return toast.error("Wallet payment requires selecting a registered customer");
    }
    if (paymentMethod === "upi_partner" && !upiReference.trim()) {
      return toast.error("Enter UPI reference / transaction note");
    }

    setSaving(true);
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

      const res = await franchiseApi.updatePosSale(orderId, {
        items: cartLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        buyer,
        payment: {
          method: paymentMethod,
          upiReference: paymentMethod === "upi_partner" ? upiReference : "",
        },
        reason: reason.trim() || "POS bill edited by franchise partner",
      });

      const payload = res.data?.result ?? res.data?.data;
      toast.success("POS bill updated successfully");
      if (onUpdated) onUpdated(payload.receipt);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update POS bill");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              Edit POS Bill <span className="text-indigo-600 font-bold text-sm">#{orderId}</span>
            </h2>
            <p className="text-xs text-slate-500">Modify items, customer details, or payment mode.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
            <Loader2 className="animate-spin text-indigo-600" size={32} />
            <p className="text-sm font-semibold">Loading bill details…</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Product Selection Grid */}
            <div className="lg:col-span-7 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search catalog products…"
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
                {filteredProducts.map((product) => {
                  const id = String(product._id);
                  const inCart = cart[id] || 0;
                  return (
                    <div
                      key={id}
                      className={`bg-white border rounded-xl p-2.5 flex flex-col ${
                        inCart > 0 ? "border-indigo-500 ring-2 ring-indigo-500/10" : "border-slate-200"
                      }`}
                    >
                      <div className="w-full aspect-square rounded-lg mb-1.5 overflow-hidden bg-slate-50">
                        <ProductThumb product={product} size="sm" />
                      </div>
                      <p className="text-xs font-bold text-slate-900 line-clamp-1 flex-1">{product.name}</p>
                      <p className="text-xs font-black text-indigo-600 mt-0.5">{formatINR(product.unitPrice)}</p>
                      <p className="text-[10px] text-slate-400">Stock: {product.onHandQty ?? 0}</p>
                      <div className="flex items-center justify-between mt-2 gap-1">
                        <button
                          type="button"
                          disabled={inCart === 0}
                          onClick={() => setQty(id, -1)}
                          className="p-1 rounded-md border border-slate-200 disabled:opacity-30"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="font-bold text-xs w-6 text-center">{inCart}</span>
                        <button
                          type="button"
                          onClick={() => setQty(id, 1)}
                          className="p-1 rounded-md bg-indigo-600 text-white"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Customer, Cart & Payment Form */}
            <div className="lg:col-span-5 space-y-4">
              {/* Customer Info */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2.5">
                <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                  <User size={14} /> Customer
                </h3>
                <div className="flex gap-2">
                  {["guest", "registered"].map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setBuyerKind(kind)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase ${
                        buyerKind === kind ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"
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
                      placeholder="Guest Name (optional)"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white"
                    />
                    <input
                      type="tel"
                      placeholder="Guest Phone (optional)"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-1.5">
                      <input
                        type="tel"
                        placeholder="Registered phone"
                        value={lookupPhone}
                        onChange={(e) => setLookupPhone(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white"
                      />
                      <button
                        type="button"
                        onClick={handleLookup}
                        disabled={lookupLoading}
                        className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold"
                      >
                        {lookupLoading ? "…" : "Find"}
                      </button>
                    </div>
                    {registeredCustomer && (
                      <div className="text-xs space-y-1 bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                        <p className="font-bold text-emerald-800">{registeredCustomer.name} · {registeredCustomer.phone}</p>
                        <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold text-emerald-700">
                          <span>Shopping: {formatINR(registeredCustomer.shoppingWalletBalance || 0)}</span>
                          <span>•</span>
                          <span>Earning: {formatINR(registeredCustomer.earningsWalletBalance || 0)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Cart Summary & Price Comparison */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2">
                <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                  <ShoppingCart size={14} /> Bill Items ({cartLines.length})
                </h3>

                <ul className="space-y-1.5 text-xs max-h-32 overflow-y-auto pr-1">
                  {cartLines.map((line) => (
                    <li key={line.productId} className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100">
                      <span className="font-medium line-clamp-1 flex-1">{line.product?.name}</span>
                      <span className="font-bold text-slate-700 ml-2">
                        {line.quantity} × {formatINR(line.unitPrice)} = {formatINR(line.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2 border-t border-slate-200 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-500">
                    <span>Original Bill Total</span>
                    <span>{formatINR(originalTotal)}</span>
                  </div>
                  <div className="flex justify-between font-black text-sm text-slate-900">
                    <span>New Bill Total</span>
                    <span>{formatINR(newTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold pt-1 border-t border-dashed border-slate-200">
                    <span>Net Difference</span>
                    <span className={priceDelta > 0 ? "text-amber-600" : priceDelta < 0 ? "text-emerald-600" : "text-slate-600"}>
                      {priceDelta > 0 ? `+${formatINR(priceDelta)} (Extra charge)` : priceDelta < 0 ? `-${formatINR(Math.abs(priceDelta))} (Refund)` : "₹0 (No change)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2.5">
                <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider">Payment Method</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("cash")}
                    className={`py-2 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 ${
                      paymentMethod === "cash" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "bg-white border-slate-200"
                    }`}
                  >
                    <Banknote size={14} /> Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("upi_partner")}
                    className={`py-2 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 ${
                      paymentMethod === "upi_partner" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "bg-white border-slate-200"
                    }`}
                  >
                    <Smartphone size={14} /> UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (buyerKind !== "registered") setBuyerKind("registered");
                      setPaymentMethod("shopping_wallet");
                    }}
                    className={`py-2 px-2 rounded-xl border text-[11px] font-bold flex flex-col items-center justify-center ${
                      paymentMethod === "shopping_wallet" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "bg-white border-slate-200 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-1"><ShoppingBag size={12} /> Shopping Wallet</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (buyerKind !== "registered") setBuyerKind("registered");
                      setPaymentMethod("earnings_wallet");
                    }}
                    className={`py-2 px-2 rounded-xl border text-[11px] font-bold flex flex-col items-center justify-center ${
                      paymentMethod === "earnings_wallet" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "bg-white border-slate-200 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-1"><Coins size={12} /> Earning Wallet</div>
                  </button>
                </div>
                {paymentMethod === "upi_partner" && (
                  <input
                    type="text"
                    placeholder="UPI ref / note"
                    value={upiReference}
                    onChange={(e) => setUpiReference(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white"
                  />
                )}
              </div>

              {/* Edit Reason */}
              <div>
                <input
                  type="text"
                  placeholder="Reason for editing bill (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || cartLines.length === 0}
                  onClick={handleSave}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="animate-spin" size={16} /> : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditPosSaleModal;
