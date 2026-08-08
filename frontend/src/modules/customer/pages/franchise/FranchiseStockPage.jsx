import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Package,
  RefreshCcw,
  ShoppingBag,
  Clock,
  CheckCircle2,
  Truck,
  XCircle,
  ArrowRight,
  Boxes,
  FileText,
} from "lucide-react";
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
  const [activeTab, setActiveTab] = useState("inventory"); // "inventory" | "orders"
  const [items, setItems] = useState([]);
  const [stockOrders, setStockOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [stockRes, ordersRes] = await Promise.all([
        franchiseApi.getStock(),
        franchiseApi.listStockOrders({ limit: 100 }),
      ]);
      setItems(stockRes.data?.result?.items ?? stockRes.data?.data?.items ?? []);
      const orderData = ordersRes.data?.result ?? ordersRes.data?.data;
      setStockOrders(orderData?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load stock data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleApproveReceipt = async (orderId) => {
    setApprovingId(orderId);
    try {
      await franchiseApi.approveStockOrderReceipt(orderId);
      toast.success("Products received successfully! Stock updated in your inventory.");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to approve receipt");
    } finally {
      setApprovingId(null);
    }
  };

  const resolveStockStatus = (order) => {
    if (!order) return "REQUESTED";
    const stockUpper = String(order.franchiseStockStatus || "").toUpperCase();
    const statusLower = String(order.status || order.orderStatus || "").toLowerCase();
    const workflowUpper = String(order.workflowStatus || "").toUpperCase();

    if (
      stockUpper === "CANCELLED" ||
      statusLower === "cancelled" ||
      workflowUpper === "CANCELLED" ||
      Boolean(order.cancelReason)
    ) {
      return "CANCELLED";
    }

    if (
      stockUpper === "DELIVERED" ||
      statusLower === "delivered" ||
      workflowUpper === "DELIVERED"
    ) {
      return "DELIVERED";
    }

    if (
      stockUpper === "DISPATCHED_PENDING_RECEIPT" ||
      statusLower === "shipped" ||
      workflowUpper === "DISPATCHED_PENDING_RECEIPT"
    ) {
      return "DISPATCHED_PENDING_RECEIPT";
    }

    return stockUpper || "REQUESTED";
  };

  const pendingConfirmations = useMemo(() => {
    return stockOrders.filter((o) => resolveStockStatus(o) === "DISPATCHED_PENDING_RECEIPT");
  }, [stockOrders]);

  const getProductPrice = (product) => {
    if (!product) return 0;
    let price = Number(product.salePrice) || Number(product.price) || 0;
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      const defaultVar = product.variants.find((v) => v.salePrice > 0 || v.price > 0) || product.variants[0];
      if (defaultVar && (defaultVar.salePrice > 0 || defaultVar.price > 0)) {
        price = Number(defaultVar.salePrice) || Number(defaultVar.price);
      }
    }
    return price;
  };

  const stats = useMemo(() => {
    const skuCount = items.length;
    const totalUnits = items.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    const estValue = items.reduce(
      (sum, r) => sum + (Number(r.quantity) || 0) * getProductPrice(r.product),
      0,
    );
    return { skuCount, totalUnits, estValue };
  }, [items]);

  const renderStatusBadge = (orderOrStatus) => {
    const status =
      typeof orderOrStatus === "object"
        ? resolveStockStatus(orderOrStatus)
        : orderOrStatus;

    switch (status) {
      case "REQUESTED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <Clock size={12} /> Requested to Hub
          </span>
        );
      case "DISPATCHED_PENDING_RECEIPT":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse">
            <Truck size={12} /> Dispatched — Confirm Receipt
          </span>
        );
      case "DELIVERED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={12} /> Received & Stock Added
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle size={12} /> Cancelled & Refunded
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
            {status || "Pending"}
          </span>
        );
    }
  };

  return (
    <>
      <FranchiseMlmHeader title="My Stock & Purchase Orders" />
      <FranchisePageShell
        title="My stock inventory & hub purchase history"
        subtitle="Products held locally to fulfill customer orders and stock purchase history from Harsh's Hub."
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/mlm/franchise/catalog"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors shadow-xs"
            >
              <ShoppingBag size={14} /> Buy Stock
            </Link>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        }
      >
        {pendingConfirmations.length > 0 && (
          <div className="p-4 rounded-2xl bg-indigo-600 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-white/20 shrink-0">
                <Truck size={22} className="text-white" />
              </div>
              <div>
                <p className="font-extrabold text-sm sm:text-base">
                  {pendingConfirmations.length} Stock Order(s) Dispatched by Harsh's Hub!
                </p>
                <p className="text-xs text-indigo-100 mt-0.5">
                  Confirm receipt once products arrive to update your inventory stock.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className="px-4 py-2 bg-white text-indigo-700 font-bold rounded-xl text-xs hover:bg-indigo-50 transition-colors shrink-0 flex items-center gap-1.5"
            >
              View & Confirm Receipt <ArrowRight size={14} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FranchiseStatCard label="SKUs In Stock" value={loading ? "…" : stats.skuCount} tone="indigo" />
          <FranchiseStatCard label="Total Units" value={loading ? "…" : stats.totalUnits} tone="emerald" />
          <FranchiseStatCard
            label="Est. Stock Value"
            value={loading ? "…" : formatINR(stats.estValue)}
            hint="At hub catalog prices"
            tone="amber"
          />
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center border-b border-slate-200 gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("inventory")}
            className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === "inventory"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Boxes size={18} /> Current Inventory ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("orders")}
            className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors relative ${
              activeTab === "orders"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <FileText size={18} /> Stock Purchase Orders ({stockOrders.length})
            {pendingConfirmations.length > 0 && (
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
            )}
          </button>
        </div>

        {activeTab === "inventory" ? (
          <SectionCard title="My Current Inventory">
            {loading ? (
              <p className="p-6 text-sm text-slate-500 text-center">Loading stock…</p>
            ) : items.length === 0 ? (
              <EmptyState
                message="No stock yet. Purchase inventory from the hub catalog using your wallet."
                action={
                  <Link
                    to="/mlm/franchise/catalog"
                    className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-500 transition-colors"
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
                  <tbody className="divide-y divide-slate-100">
                    {items.map((row) => {
                      let price = getProductPrice(row.product);
                      const vSku = String(row.variantSku || "").trim();
                      const vName = String(row.variantName || "").trim();

                      if (vSku && Array.isArray(row.product?.variants)) {
                        const vHit = row.product.variants.find(
                          (v) => String(v.sku || "").trim() === vSku || String(v.name || "").trim() === vSku
                        );
                        if (vHit) {
                          const vp = Number(vHit.salePrice) > 0 ? Number(vHit.salePrice) : Number(vHit.price);
                          if (vp > 0) price = vp;
                        }
                      }

                      const qty = Number(row.quantity) || 0;
                      return (
                        <tr key={row._id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <ProductThumb product={row.product} size="sm" />
                              <div>
                                <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                                  {row.product?.name || "Product"}
                                  {vName && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-100">
                                      {vName}
                                    </span>
                                  )}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono truncate max-w-[180px]">
                                  {vSku ? `SKU: ${vSku}` : `ID: ${row.productId}`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-medium">{formatINR(price)}</td>
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
        ) : (
          /* Stock Purchase Orders History Tab */
          <SectionCard title="Stock Purchase Orders History">
            {loading ? (
              <p className="p-6 text-sm text-slate-500 text-center">Loading stock orders…</p>
            ) : stockOrders.length === 0 ? (
              <EmptyState
                message="No stock purchase orders placed yet."
                action={
                  <Link
                    to="/mlm/franchise/catalog"
                    className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm"
                  >
                    <ShoppingBag size={16} /> Order Stock from Harsh's Hub
                  </Link>
                }
              />
            ) : (
              <div className="space-y-4">
                {stockOrders.map((order) => {
                  const effectiveStatus = resolveStockStatus(order);
                  const isAwaitingReceipt = effectiveStatus === "DISPATCHED_PENDING_RECEIPT";
                  const total = order.pricing?.grandTotal || order.pricing?.total || 0;
                  const formattedDate = order.createdAt
                    ? new Date(order.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";

                  return (
                    <div
                      key={order._id}
                      className={`border rounded-2xl p-4 transition-all ${
                        isAwaitingReceipt
                          ? "bg-indigo-50/40 border-indigo-200 shadow-sm"
                          : effectiveStatus === "CANCELLED"
                          ? "bg-rose-50/20 border-rose-200 opacity-90"
                          : "bg-white border-slate-200"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 text-sm">#{order.orderId}</span>
                            {renderStatusBadge(order)}
                          </div>
                          <p className="text-xs text-slate-500 mt-1 font-medium">{formattedDate}</p>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3">
                          <span className="text-base font-black text-slate-900">{formatINR(total)}</span>
                          {isAwaitingReceipt && (
                            <button
                              type="button"
                              onClick={() => handleApproveReceipt(order.orderId)}
                              disabled={approvingId === order.orderId}
                              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-xs shadow-sm transition-all disabled:opacity-50"
                            >
                              <CheckCircle2 size={16} />
                              {approvingId === order.orderId ? "Updating Stock…" : "Approve Receipt & Add Stock"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Items list */}
                      <div className="mt-3 divide-y divide-slate-100">
                        {(order.items || []).map((item, idx) => (
                          <div key={idx} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ProductThumb product={item.product} size="sm" />
                              <div className="min-w-0">
                                <p className="font-bold text-slate-800 truncate">
                                  {item.name || item.product?.name || "Product"}
                                </p>
                                {item.variantSku && (
                                  <p className="text-[10px] text-slate-400 font-mono">SKU: {item.variantSku}</p>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-extrabold text-slate-900">
                                Qty: {item.quantity} × {formatINR(item.price)}
                              </p>
                              <p className="font-bold text-indigo-600">{formatINR(item.quantity * item.price)}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {order.cancelReason && (
                        <div className="mt-3 p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-800">
                          <span className="font-bold">Cancellation reason:</span> {order.cancelReason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}
      </FranchisePageShell>
    </>
  );
};

export default FranchiseStockPage;
