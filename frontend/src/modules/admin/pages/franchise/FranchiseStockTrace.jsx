import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Search,
  RefreshCw,
  ShoppingBag,
  Store,
  RotateCcw,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  User,
  Phone,
  Calendar,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  PackageCheck,
  ShieldAlert,
  Boxes,
  Layers,
  Clock,
  CheckCircle2,
  Truck,
  Receipt,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import {
  PageShell,
  StatCard,
  StatusPill,
  formatINR,
  formatDate,
  useBodyScrollLock,
} from "./franchiseAdminShared";

// -------------------------------------------------------------
// Product Trace Modal: Full unit timeline with running balances
// -------------------------------------------------------------
const ProductTraceModal = ({ open, onClose, partnerId, productId, productName }) => {
  useBodyScrollLock(open);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || !partnerId || !productId) return;
    setLoading(true);
    adminFranchiseApi
      .getPartnerProductTrace(partnerId, productId)
      .then((res) => {
        setData(res?.data?.result ?? res?.data?.data ?? null);
      })
      .catch((err) => {
        toast.error(err?.response?.data?.message || "Failed to load product trace");
      })
      .finally(() => setLoading(false));
  }, [open, partnerId, productId]);

  if (!open) return null;

  const product = data?.product;
  const ledger = data?.ledger;
  const trace = data?.trace || [];
  const totalIn = data?.totalIn || 0;
  const totalOut = data?.totalOut || 0;
  const currentStock = ledger?.quantity ?? (totalIn - totalOut);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-3">
            {product?.mainImage ? (
              <img
                src={product.mainImage}
                alt={product.name}
                className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                <Boxes size={22} />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  {product?.name || productName || "Product Unit Trace"}
                </h2>
                {product?.sku && (
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-slate-200/80 text-slate-700">
                    SKU: {product.sku}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Complete chronological unit provenance: assignments, sales, and running stock audit.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-200/70 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="animate-spin text-indigo-500" size={28} />
              <span className="text-sm font-medium">Reconstructing product unit timeline…</span>
            </div>
          ) : !data ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              No movement history found for this product.
            </div>
          ) : (
            <>
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50/70 border border-emerald-100 rounded-xl p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    Total Assigned In
                  </p>
                  <p className="text-2xl font-black text-emerald-900 mt-1">+{totalIn}</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">Transfers & Restocks</p>
                </div>

                <div className="bg-rose-50/70 border border-rose-100 rounded-xl p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                    Total Outgoing
                  </p>
                  <p className="text-2xl font-black text-rose-900 mt-1">-{totalOut}</p>
                  <p className="text-[11px] text-rose-600 mt-0.5">Online, POS & Damage</p>
                </div>

                <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                    Current Balance
                  </p>
                  <p className="text-2xl font-black text-indigo-900 mt-1">{currentStock}</p>
                  <p className="text-[11px] text-indigo-600 mt-0.5">Units in franchise possession</p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Unit Price
                  </p>
                  <p className="text-2xl font-black text-slate-800 mt-1">
                    {formatINR(product?.salePrice ?? product?.price ?? 0)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Franchise selling price</p>
                </div>
              </div>

              {/* Chronological Step-by-Step Provenance Timeline */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-1.5">
                  <Clock size={14} className="text-slate-400" />
                  Chronological Unit Audit Trail ({trace.length} Events)
                </h3>

                {trace.length === 0 ? (
                  <p className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded-xl">
                    No movements recorded yet.
                  </p>
                ) : (
                  <div className="relative border-l-2 border-slate-200 ml-4 pl-6 space-y-6">
                    {trace.map((item, idx) => {
                      const isPositive = item.qty > 0;
                      const isOnline = item.type === "FULFILLMENT";
                      const isPos = item.isPos || item.type === "POS_SALE";
                      const isIncoming = item.type === "TRANSFER_IN" || item.type === "RESTOCK";
                      const isDamage = item.type === "DAMAGE";
                      const isReturn = item.type === "RETURN_IN";

                      return (
                        <div key={item.id || idx} className="relative group">
                          {/* Dot on timeline */}
                          <div
                            className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm flex items-center justify-center ${
                              isIncoming
                                ? "bg-emerald-500"
                                : isOnline
                                ? "bg-blue-500"
                                : isPos
                                ? "bg-violet-500"
                                : isReturn
                                ? "bg-sky-500"
                                : isDamage
                                ? "bg-rose-500"
                                : "bg-slate-500"
                            }`}
                          />

                          <div className="bg-slate-50/70 hover:bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-400">
                                  #{idx + 1}
                                </span>
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide uppercase ${
                                    isIncoming
                                      ? "bg-emerald-100 text-emerald-800"
                                      : isOnline
                                      ? "bg-blue-100 text-blue-800"
                                      : isPos
                                      ? "bg-violet-100 text-violet-800"
                                      : isReturn
                                      ? "bg-sky-100 text-sky-800"
                                      : isDamage
                                      ? "bg-rose-100 text-rose-800"
                                      : "bg-slate-200 text-slate-800"
                                  }`}
                                >
                                  {isIncoming && <ArrowDownLeft size={12} />}
                                  {(isOnline || isPos || isDamage) && <ArrowUpRight size={12} />}
                                  {item.type.replace(/_/g, " ")}
                                </span>

                                {item.variantSku && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                                    Variant: {item.variantSku}
                                  </span>
                                )}
                              </div>

                              <span className="text-xs text-slate-500 font-medium">
                                {formatDate(item.createdAt)}
                              </span>
                            </div>

                            {/* Details row: Quantity & Balance Transition */}
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-4 py-2 px-3 bg-white rounded-lg border border-slate-200/80">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500 font-medium">Change:</span>
                                <span
                                  className={`text-sm font-extrabold font-mono ${
                                    isPositive ? "text-emerald-600" : "text-rose-600"
                                  }`}
                                >
                                  {isPositive ? `+${item.qty}` : item.qty} units
                                </span>
                              </div>

                              <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                                <span>Balance:</span>
                                <span className="font-mono text-slate-500">{item.balanceBefore}</span>
                                <span className="text-slate-400">→</span>
                                <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                                  {item.balanceAfter} units
                                </span>
                              </div>
                            </div>

                            {/* Destination / Customer / Source details */}
                            <div className="mt-3 text-xs text-slate-700 space-y-1">
                              {item.customer && (
                                <div className="flex items-center gap-3">
                                  <span className="text-slate-400 font-medium w-16">Customer:</span>
                                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                                    <User size={13} className="text-slate-400" />
                                    {item.customer.name}
                                  </span>
                                  {item.customer.phone && (
                                    <span className="text-slate-500 flex items-center gap-1">
                                      <Phone size={11} className="text-slate-400" />
                                      {item.customer.phone}
                                    </span>
                                  )}
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                                      item.customer.type === "online"
                                        ? "bg-blue-50 text-blue-700 border border-blue-200"
                                        : "bg-violet-50 text-violet-700 border border-violet-200"
                                    }`}
                                  >
                                    {item.customer.type === "online" ? "Online User" : "POS Buyer"}
                                  </span>
                                </div>
                              )}

                              {item.orderId && (
                                <div className="flex items-center gap-3">
                                  <span className="text-slate-400 font-medium w-16">Order Ref:</span>
                                  <span className="font-mono font-semibold text-indigo-600">
                                    #{item.orderId}
                                  </span>
                                  {item.paymentMode && (
                                    <span className="text-slate-500 uppercase text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
                                      {item.paymentMode}
                                    </span>
                                  )}
                                </div>
                              )}

                              {item.createdBy?.name && (
                                <div className="flex items-center gap-3">
                                  <span className="text-slate-400 font-medium w-16">Processed:</span>
                                  <span className="text-slate-600 font-medium">
                                    By {item.createdBy.name}
                                  </span>
                                </div>
                              )}

                              {item.note && (
                                <div className="flex items-start gap-3 text-slate-500 italic mt-1 bg-slate-100/60 p-2 rounded">
                                  <span className="text-slate-400 not-italic font-medium w-16">Note:</span>
                                  <span>{item.note}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-colors"
          >
            Close Drilldown
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// -------------------------------------------------------------
// Date formatting helper for datewise groups
// -------------------------------------------------------------
function formatGroupDate(dateStr) {
  if (!dateStr) return "Date Unknown";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// -------------------------------------------------------------
// Main FranchiseStockTrace Page
// -------------------------------------------------------------
const FranchiseStockTrace = () => {
  const { id: partnerId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [partner, setPartner] = useState(null);
  const [loadingPartner, setLoadingPartner] = useState(true);

  // Main view tab: "ledger" (Unit movements & ledger) or "orders" (Order-wise intake & deliveries)
  const [activeMainTab, setActiveMainTab] = useState(
    searchParams.get("tab") === "orders" ? "orders" : "ledger"
  );

  const handleSwitchTab = (tab) => {
    setActiveMainTab(tab);
    const newParams = new URLSearchParams(searchParams);
    if (tab === "orders") {
      newParams.set("tab", "orders");
    } else {
      newParams.delete("tab");
    }
    setSearchParams(newParams);
  };

  // Order-wise state
  const [orderScope, setOrderScope] = useState("stock");
  const [orderStatus, setOrderStatus] = useState("ALL");
  const [orderStartDate, setOrderStartDate] = useState("");
  const [orderEndDate, setOrderEndDate] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderViewMode, setOrderViewMode] = useState("datewise"); // "datewise" | "table"
  const [orderData, setOrderData] = useState(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState(new Set());
  const [expandedDates, setExpandedDates] = useState(new Set());

  const toggleOrderExpand = (id) => {
    setExpandedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDateExpand = (date) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  // Filters & State for Unit Movements
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [selectedProductId, setSelectedProductId] = useState(searchParams.get("productId") || "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchLedger, setSearchLedger] = useState("");
  const [page, setPage] = useState(1);
  const limit = 30;

  // Main trace data
  const [traceData, setTraceData] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  // Drilldown modal
  const [activeModalProduct, setActiveModalProduct] = useState(null);

  // Sync productId from URL if query param is set
  useEffect(() => {
    const qPid = searchParams.get("productId");
    if (qPid && qPid !== selectedProductId) {
      setSelectedProductId(qPid);
    }
  }, [searchParams]);

  // Load partner details
  useEffect(() => {
    if (!partnerId) return;
    setLoadingPartner(true);
    adminFranchiseApi
      .getPartner(partnerId)
      .then((res) => {
        const payload = res?.data?.result ?? res?.data?.data;
        setPartner(payload?.partner || payload || null);
      })
      .catch((err) => {
        toast.error(err?.response?.data?.message || "Failed to load franchise partner");
      })
      .finally(() => setLoadingPartner(false));
  }, [partnerId]);

  // Load stock trace movements & ledger
  const loadTrace = useCallback(async () => {
    if (!partnerId) return;
    setLoadingData(true);
    try {
      const params = {
        page,
        limit,
      };
      if (channelFilter !== "ALL") params.channel = channelFilter;
      if (selectedProductId) params.productId = selectedProductId;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await adminFranchiseApi.getPartnerStockTrace(partnerId, params);
      setTraceData(res?.data?.result ?? res?.data?.data ?? null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load stock audit data");
    } finally {
      setLoadingData(false);
    }
  }, [partnerId, page, channelFilter, selectedProductId, startDate, endDate]);

  useEffect(() => {
    loadTrace();
  }, [loadTrace]);

  // Load order-wise intake & delivery entries
  const loadOrders = useCallback(async () => {
    if (!partnerId) return;
    setLoadingOrders(true);
    try {
      const params = {
        page: orderPage,
        limit: 50,
        scope: orderScope,
      };
      if (orderStatus !== "ALL") params.status = orderStatus;
      if (orderStartDate) params.startDate = orderStartDate;
      if (orderEndDate) params.endDate = orderEndDate;

      const res = await adminFranchiseApi.getPartnerStockOrders(partnerId, params);
      const payload = res?.data?.result ?? res?.data?.data ?? null;
      setOrderData(payload);
      if (payload?.groupedByDate?.length) {
        setExpandedDates(new Set(payload.groupedByDate.slice(0, 3).map((d) => d.date)));
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load order-wise stock records");
    } finally {
      setLoadingOrders(false);
    }
  }, [partnerId, orderPage, orderScope, orderStatus, orderStartDate, orderEndDate]);

  useEffect(() => {
    if (activeMainTab === "orders") {
      loadOrders();
    }
  }, [activeMainTab, loadOrders]);

  const stats = traceData?.stats || {
    totalAssigned: 0,
    totalOnlineSold: 0,
    totalPosSold: 0,
    totalReturned: 0,
    totalDamage: 0,
  };

  const ledger = traceData?.ledger || [];
  const movements = traceData?.movements?.items || [];
  const totalMovements = traceData?.movements?.total || 0;
  const totalPages = traceData?.movements?.totalPages || 1;

  // Filtered ledger based on search
  const filteredLedger = useMemo(() => {
    if (!searchLedger.trim()) return ledger;
    const q = searchLedger.toLowerCase();
    return ledger.filter(
      (item) =>
        item.productName?.toLowerCase().includes(q) ||
        item.sku?.toLowerCase().includes(q) ||
        item.variantSku?.toLowerCase().includes(q)
    );
  }, [ledger, searchLedger]);

  const partnerDisplayName =
    partner?.franchiseName ||
    partner?.businessName ||
    partner?.displayName ||
    partner?.userId?.name ||
    partner?.name ||
    "Franchise Partner";

  const partnerCode = partner?.referralCode || partner?.franchiseCode || "—";
  const partnerContact =
    partner?.userId?.phone || partner?.phone || partner?.userId?.email || partner?.email || "—";

  return (
    <PageShell
      title={`Stock Traceability Audit — ${partnerDisplayName}`}
      subtitle={`Franchise Code: ${partnerCode} | Contact: ${partnerContact}`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to={`/admin/franchise/partners/${partnerId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold shadow-sm transition-colors"
          >
            <ArrowLeft size={14} /> Back to Partner
          </Link>
          <button
            type="button"
            onClick={activeMainTab === "orders" ? loadOrders : loadTrace}
            disabled={activeMainTab === "orders" ? loadingOrders : loadingData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={(activeMainTab === "orders" ? loadingOrders : loadingData) ? "animate-spin" : ""}
            />{" "}
            Refresh Audit
          </button>
        </div>
      }
    >
      {/* Top Main Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2.5 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/80">
        <button
          type="button"
          onClick={() => handleSwitchTab("ledger")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all ${
            activeMainTab === "ledger"
              ? "bg-white text-indigo-700 shadow-sm border border-slate-200/80"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}
        >
          <Boxes size={16} className={activeMainTab === "ledger" ? "text-indigo-600" : "text-slate-400"} />
          <span>Unit Movements & Ledger</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
              activeMainTab === "ledger" ? "bg-indigo-100 text-indigo-800 font-bold" : "bg-slate-200/70 text-slate-600"
            }`}
          >
            {ledger.length} SKUs
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSwitchTab("orders")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all ${
            activeMainTab === "orders"
              ? "bg-white text-indigo-700 shadow-sm border border-slate-200/80"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}
        >
          <Receipt size={16} className={activeMainTab === "orders" ? "text-indigo-600" : "text-slate-400"} />
          <span>Order-Wise Intake & Deliveries (Datewise)</span>
          {orderData?.total !== undefined && (
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-mono ${
                activeMainTab === "orders" ? "bg-indigo-100 text-indigo-800 font-bold" : "bg-slate-200/70 text-slate-600"
              }`}
            >
              {orderData.total} Orders
            </span>
          )}
        </button>
      </div>

      {activeMainTab === "ledger" ? (
        <>
          {/* 5 KPI Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard
          label="Total Assigned In"
          value={`+${stats.totalAssigned}`}
          hint="From Hub / Warehouse"
          icon={ArrowDownLeft}
          tone="emerald"
        />
        <StatCard
          label="Online Orders Sold"
          value={`-${stats.totalOnlineSold}`}
          hint="Shipped to App Users"
          icon={ShoppingBag}
          tone="indigo"
        />
        <StatCard
          label="POS Store Sold"
          value={`-${stats.totalPosSold}`}
          hint="Sold at Local Counter"
          icon={Store}
          tone="amber"
        />
        <StatCard
          label="Customer Returns"
          value={`+${stats.totalReturned}`}
          hint="Returned to Stock"
          icon={RotateCcw}
          tone="slate"
        />
        <StatCard
          label="Damaged / Loss"
          value={`-${stats.totalDamage}`}
          hint="Written off"
          icon={AlertTriangle}
          tone="slate"
        />
      </div>

      {/* Product On-Hand Stock Ledger & Quick Drilldown */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Boxes size={18} className="text-indigo-600" />
              On-Hand Inventory Ledger ({ledger.length} Products)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Current balance per SKU with direct access to single-unit timeline audit.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Filter ledger by name/SKU…"
                value={searchLedger}
                onChange={(e) => setSearchLedger(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-52 sm:w-64"
              />
            </div>
            {selectedProductId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedProductId("");
                  setSearchParams({});
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1 bg-indigo-50 rounded-lg"
              >
                Clear SKU Filter
              </button>
            )}
          </div>
        </div>

        {filteredLedger.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {ledger.length === 0
              ? "No stock has been assigned to this franchise yet."
              : "No products match the search filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-100 font-bold">
                <tr>
                  <th className="px-4 py-3">Product / SKU</th>
                  <th className="px-4 py-3">Variant</th>
                  <th className="px-4 py-3 text-right">Current Units</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Last Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLedger.map((row, idx) => {
                  const isSelected = selectedProductId === String(row.productId);
                  const isOutOfStock = row.currentStock <= 0;
                  const isLowStock = row.currentStock > 0 && row.currentStock <= 5;

                  return (
                    <tr
                      key={row.productId + (row.variantSku || "") + idx}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected ? "bg-indigo-50/40" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {row.image ? (
                            <img
                              src={row.image}
                              alt={row.productName}
                              className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                              <Boxes size={16} />
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-slate-900 line-clamp-1">
                              {row.productName}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500">
                              {row.sku || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {row.variantName || row.variantSku ? (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                            {row.variantName || row.variantSku}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-black text-sm font-mono ${
                            isOutOfStock
                              ? "text-rose-600"
                              : isLowStock
                              ? "text-amber-600"
                              : "text-slate-900"
                          }`}
                        >
                          {row.currentStock}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-center">
                        {isOutOfStock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-100 text-rose-800">
                            Out of Stock
                          </span>
                        ) : isLowStock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800">
                            Low ({row.currentStock})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">
                            In Stock
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-500 text-[11px]">
                        {formatDate(row.lastUpdated)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!row.productId}
                            onClick={() => {
                              if (row.productId) {
                                setActiveModalProduct({
                                  id: row.productId,
                                  name: row.productName,
                                });
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-indigo-700 font-bold rounded-lg transition-colors text-[11px]"
                            title={row.productId ? "Drilldown single-unit timeline" : "Archived item without product ID"}
                          >
                            <Eye size={12} /> Unit Provenance
                          </button>

                          <button
                            type="button"
                            disabled={!row.productId}
                            onClick={() => {
                              if (!row.productId) return;
                              if (isSelected) {
                                setSelectedProductId("");
                                setSearchParams({});
                              } else {
                                setSelectedProductId(String(row.productId));
                                setSearchParams({ productId: String(row.productId) });
                              }
                              setPage(1);
                            }}
                            className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-colors disabled:opacity-40 ${
                              isSelected
                                ? "bg-indigo-600 text-white"
                                : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                            }`}
                          >
                            {isSelected ? "Filtering Logs" : "Filter Logs"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movement Audit Trail Table with Channel Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm space-y-4">
        {/* Filter Controls Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers size={18} className="text-indigo-600" />
                Every Unit Movement Log ({totalMovements} Total Records)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Exact log of stock intake from Hub, online customer shipments, and POS store sales.
              </p>
            </div>

            {/* Channel Tabs */}
            <div className="flex flex-wrap gap-1">
              {[
                { label: "All Movements", value: "ALL" },
                { label: "Stock Assigned (Hub)", value: "incoming" },
                { label: "Online Orders", value: "online" },
                { label: "POS Sales", value: "pos" },
              ].map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setChannelFilter(tab.value);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                    channelFilter === tab.value
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range & SKU active filter bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/60 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <Calendar size={13} /> Date Range:
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1 border border-slate-200 rounded-lg bg-white text-xs text-slate-700"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1 border border-slate-200 rounded-lg bg-white text-xs text-slate-700"
              />
              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                    setPage(1);
                  }}
                  className="text-xs text-rose-600 hover:text-rose-800 font-bold ml-1"
                >
                  Reset Dates
                </button>
              )}
            </div>

            {selectedProductId && (
              <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-lg text-indigo-800">
                <span className="font-medium">Filtered by Product ID:</span>
                <span className="font-mono font-bold">{selectedProductId}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProductId("");
                    setSearchParams({});
                    setPage(1);
                  }}
                  className="hover:text-indigo-950 font-bold ml-1"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Movements Table */}
        {loadingData ? (
          <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="animate-spin text-indigo-600" size={26} />
            <span className="text-xs font-semibold">Loading stock movement logs…</span>
          </div>
        ) : movements.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            No stock movements found matching the active filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-y border-slate-200/80 font-bold">
                <tr>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Product / SKU</th>
                  <th className="px-4 py-3">Movement Type</th>
                  <th className="px-4 py-3">Customer / Destination</th>
                  <th className="px-4 py-3">Order Ref</th>
                  <th className="px-4 py-3 text-right">Units (±)</th>
                  <th className="px-4 py-3 text-right">Balance After</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => {
                  const isPositive = m.quantity > 0;
                  const isOnline = m.channel === "online";
                  const isPos = m.channel === "pos" || m.channel === "pos_restore";
                  const isIncoming = m.channel === "incoming";
                  const isReturn = m.channel === "return";
                  const isDamage = m.channel === "damage";

                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Date */}
                      <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap">
                        <p className="font-semibold text-slate-800">{formatDate(m.createdAt)}</p>
                        {m.createdBy?.name && (
                          <p className="text-[10px] text-slate-400">By: {m.createdBy.name}</p>
                        )}
                      </td>

                      {/* Product */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          {m.product?.image ? (
                            <img
                              src={m.product.image}
                              alt={m.product.name}
                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                              <Boxes size={14} />
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-slate-900 line-clamp-1 max-w-[180px]">
                              {m.product?.name || "Product"}
                            </p>
                            <p className="text-[10px] font-mono text-slate-500">
                              {m.product?.sku || m.variantSku || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Type Badge */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                            isIncoming
                              ? "bg-emerald-100 text-emerald-800"
                              : isOnline
                              ? "bg-blue-100 text-blue-800"
                              : isPos
                              ? "bg-violet-100 text-violet-800"
                              : isReturn
                              ? "bg-sky-100 text-sky-800"
                              : isDamage
                              ? "bg-rose-100 text-rose-800"
                              : "bg-slate-100 text-slate-800"
                          }`}
                        >
                          {isIncoming && <ArrowDownLeft size={11} />}
                          {(isOnline || isPos || isDamage) && <ArrowUpRight size={11} />}
                          {m.type.replace(/_/g, " ")}
                        </span>
                        {m.note && (
                          <p className="text-[10px] text-slate-400 italic mt-0.5 max-w-[160px] truncate">
                            {m.note}
                          </p>
                        )}
                      </td>

                      {/* Customer / Destination */}
                      <td className="px-4 py-3.5">
                        {isIncoming ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                              <PackageCheck size={11} /> Warehouse Dispatch
                            </span>
                            {m.transferGroupId && (
                              <p className="text-[10px] font-mono text-slate-400">
                                Batch: {m.transferGroupId}
                              </p>
                            )}
                          </div>
                        ) : m.customer ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <User size={12} className="text-slate-400" />
                              <span>{m.customer.name}</span>
                              <span
                                className={`text-[9px] px-1 py-0.2 rounded font-extrabold uppercase ${
                                  m.customer.type === "online"
                                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                                    : "bg-violet-50 text-violet-700 border border-violet-200"
                                }`}
                              >
                                {m.customer.type === "online" ? "Online" : "POS"}
                              </span>
                            </div>
                            {m.customer.phone && (
                              <p className="text-[10px] text-slate-500 flex items-center gap-1">
                                <Phone size={10} className="text-slate-400" />
                                {m.customer.phone}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Direct Franchise Action</span>
                        )}
                      </td>

                      {/* Order Ref */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {m.order?.orderId ? (
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-indigo-600">
                              #{m.order.orderId}
                            </span>
                            {m.order.paymentMode && (
                              <span className="block text-[10px] text-slate-500 uppercase">
                                {m.order.paymentMode}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-mono">—</span>
                        )}
                      </td>

                      {/* Units Quantity (±) */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <span
                          className={`font-black font-mono text-sm ${
                            isPositive ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {isPositive ? `+${m.quantity}` : m.quantity}
                        </span>
                      </td>

                      {/* Running Balance */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <span className="font-bold font-mono text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                          {m.balanceAfter ?? "—"} units
                        </span>
                      </td>

                      {/* Action: Open drilldown */}
                      <td className="px-4 py-3.5 text-center">
                        {m.product?.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveModalProduct({
                                id: m.product.id,
                                name: m.product.name,
                              });
                            }}
                            className="p-1.5 text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Open unit provenance audit for this product"
                          >
                            <Eye size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 bg-slate-50/50">
            <span>
              Showing Page <strong className="text-slate-900">{page}</strong> of{" "}
              <strong className="text-slate-900">{totalPages}</strong> ({totalMovements} movements)
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 transition-colors flex items-center gap-1 font-semibold"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 transition-colors flex items-center gap-1 font-semibold"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  ) : (
        /* Order-Wise Stock Intake & Deliveries (Datewise) Section */
        <div className="space-y-5">
          {/* Order-Wise KPI Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            <StatCard
              label="Total Orders"
              value={orderData?.stats?.totalOrders ?? orderData?.total ?? 0}
              hint={`${orderData?.orders?.length || 0} loaded on this page`}
              icon={Receipt}
              tone="indigo"
            />
            <StatCard
              label="Units Ordered (Intake)"
              value={`+${orderData?.stats?.totalUnitsOrdered ?? 0}`}
              hint="Requested from Hub / Supplier"
              icon={ArrowDownLeft}
              tone="amber"
            />
            <StatCard
              label="Units Delivered"
              value={`+${orderData?.stats?.totalUnitsDelivered ?? 0}`}
              hint={`${orderData?.stats?.deliveredCount ?? 0} orders received`}
              icon={PackageCheck}
              tone="emerald"
            />
            <StatCard
              label="Pending / In Transit"
              value={`${orderData?.stats?.totalUnitsPending ?? 0}`}
              hint={`${orderData?.stats?.pendingCount ?? 0} orders awaiting receipt`}
              icon={Truck}
              tone="slate"
            />
            <StatCard
              label="Total Order Value"
              value={formatINR(orderData?.stats?.totalValue ?? 0)}
              hint="Gross replenishment amount"
              icon={Boxes}
              tone="slate"
            />
          </div>

          {/* Filters & View Controls */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Receipt size={18} className="text-indigo-600" />
                  Order-Wise Stock Intake & Deliveries
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Track when stock orders were placed/got by admin, dispatched from Hub, and delivered to franchise datewise.
                </p>
              </div>

              {/* Scope Tabs: Stock Orders, Customer Orders, All */}
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "Stock Replenishment (Hub Intake)", value: "stock" },
                  { label: "Customer Orders (Online/POS)", value: "customer" },
                  { label: "All Orders", value: "all" },
                ].map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => {
                      setOrderScope(s.value);
                      setOrderPage(1);
                    }}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      orderScope === s.value
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Bar: Status, Date Range, View Mode */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                {/* Status select */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-semibold">Status:</span>
                  <select
                    value={orderStatus}
                    onChange={(e) => {
                      setOrderStatus(e.target.value);
                      setOrderPage(1);
                    }}
                    className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="DELIVERED">Delivered / Received</option>
                    <option value="DISPATCHED_PENDING_RECEIPT">In Transit (Dispatched)</option>
                    <option value="REQUESTED">Awaiting Dispatch (Requested)</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>

                {/* Date range */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-semibold flex items-center gap-1">
                    <Calendar size={13} /> Dates:
                  </span>
                  <input
                    type="date"
                    value={orderStartDate}
                    onChange={(e) => {
                      setOrderStartDate(e.target.value);
                      setOrderPage(1);
                    }}
                    className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
                  />
                  <span className="text-slate-400">to</span>
                  <input
                    type="date"
                    value={orderEndDate}
                    onChange={(e) => {
                      setOrderEndDate(e.target.value);
                      setOrderPage(1);
                    }}
                    className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
                  />
                  {(orderStartDate || orderEndDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setOrderStartDate("");
                        setOrderEndDate("");
                        setOrderPage(1);
                      }}
                      className="text-xs text-rose-600 hover:text-rose-800 font-bold ml-1"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setOrderViewMode("datewise")}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                    orderViewMode === "datewise"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  📅 Date-Grouped View
                </button>
                <button
                  type="button"
                  onClick={() => setOrderViewMode("table")}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                    orderViewMode === "table"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  📋 Master Table View
                </button>
              </div>
            </div>
          </div>

          {/* Orders Content */}
          {loadingOrders ? (
            <div className="bg-white border border-slate-200 rounded-2xl py-24 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="animate-spin text-indigo-600" size={28} />
              <span className="text-xs font-semibold">Loading order-wise intake & delivery logs…</span>
            </div>
          ) : !orderData || orderData.orders.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center text-slate-400 text-sm">
              No stock orders found matching the filter criteria.
            </div>
          ) : orderViewMode === "datewise" ? (
            /* Datewise Grouped Timeline View */
            <div className="space-y-4">
              {orderData.groupedByDate.map((group) => {
                const isDateExpanded = expandedDates.has(group.date);

                return (
                  <div
                    key={group.date}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm transition-all"
                  >
                    {/* Date Group Header */}
                    <div
                      onClick={() => toggleDateExpand(group.date)}
                      className="px-5 py-3.5 bg-slate-50 hover:bg-slate-100/70 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                          <Calendar size={16} />
                        </div>
                        <div>
                          <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                            {formatGroupDate(group.date)}
                          </h3>
                          <p className="text-[11px] font-mono text-slate-500">{group.date}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-200/80 text-slate-800 font-bold">
                            {group.orderCount} {group.orderCount === 1 ? "Order" : "Orders"}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                            {group.totalUnits} Units Total
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                            {group.deliveredUnits} Units Delivered
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-bold font-mono">
                            {formatINR(group.totalValue)}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="p-1 text-slate-400 hover:text-slate-700 transition-colors"
                        >
                          {isDateExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>
                      </div>
                    </div>

                    {/* Orders list in this Date */}
                    {isDateExpanded && (
                      <div className="p-4 sm:p-5 space-y-4 divide-y divide-slate-100">
                        {group.orders.map((order) => {
                          const isOrderExpanded = expandedOrderIds.has(order.id);
                          const isStock = order.orderType === "stock";

                          return (
                            <div key={order.id} className="pt-4 first:pt-0 space-y-3">
                              {/* Order Card Header */}
                              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 p-3 rounded-xl border border-slate-200/60">
                                <div className="flex flex-wrap items-center gap-2.5">
                                  <span className="font-mono font-black text-sm text-indigo-700">
                                    #{order.orderId || String(order.id).slice(-8)}
                                  </span>

                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                                      isStock
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                        : order.orderType === "online"
                                        ? "bg-blue-50 text-blue-700 border-blue-200"
                                        : "bg-violet-50 text-violet-700 border-violet-200"
                                    }`}
                                  >
                                    {isStock
                                      ? "Hub Stock Order"
                                      : order.orderType === "online"
                                      ? "Online Order"
                                      : "POS In-Store Sale"}
                                  </span>

                                  <StatusPill status={order.status} />

                                  {order.paymentMode && (
                                    <span className="text-[11px] font-mono uppercase bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded">
                                      {order.paymentMode}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-4 text-xs">
                                  <div className="text-right">
                                    <span className="font-extrabold text-slate-900 text-sm">
                                      {order.totalUnits} Units
                                    </span>
                                    <span className="text-slate-400 text-[11px] ml-1">
                                      ({order.productsCount} {order.productsCount === 1 ? "product" : "products"})
                                    </span>
                                  </div>
                                  <div className="text-right font-black font-mono text-sm text-slate-900">
                                    {formatINR(order.totalValue)}
                                  </div>
                                </div>
                              </div>

                              {/* Lifecycle Timeline: Ordered -> Dispatched -> Delivered */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-white rounded-xl p-3 border border-slate-100">
                                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                                    <Clock size={11} className="text-amber-500" /> 1. Ordered (Got by Admin)
                                  </p>
                                  <p className="font-semibold text-slate-900 mt-1">
                                    {formatDate(order.orderedAt)}
                                  </p>
                                  <p className="text-[10px] text-slate-500 mt-0.5">
                                    {isStock ? "Stock request received" : `By: ${order.buyer?.name || "Customer"}`}
                                  </p>
                                </div>

                                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                                    <Truck size={11} className="text-indigo-500" /> 2. Dispatched from Hub
                                  </p>
                                  <p className="font-semibold text-slate-900 mt-1">
                                    {order.dispatchedAt ? formatDate(order.dispatchedAt) : "—"}
                                  </p>
                                  <p className="text-[10px] text-slate-500 mt-0.5">
                                    {order.dispatchedAt ? "Dispatched from warehouse" : "Awaiting hub dispatch"}
                                  </p>
                                </div>

                                <div
                                  className={`p-2.5 rounded-lg border ${
                                    order.isDelivered
                                      ? "bg-emerald-50/60 border-emerald-100"
                                      : "bg-slate-50 border-slate-100"
                                  }`}
                                >
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                                    <PackageCheck size={11} className="text-emerald-600" /> 3. Delivered to Admin / Franchise
                                  </p>
                                  <p className="font-semibold text-slate-900 mt-1">
                                    {order.deliveredAt ? formatDate(order.deliveredAt) : order.isDelivered ? "Delivered" : "—"}
                                  </p>
                                  <p className="text-[10px] text-emerald-600 mt-0.5">
                                    {order.isDelivered ? "Verified & stocked in inventory" : "Pending delivery / receipt"}
                                  </p>
                                </div>
                              </div>

                              {/* Line Items Toggle & Table */}
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() => toggleOrderExpand(order.id)}
                                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 py-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                                >
                                  <Boxes size={13} />
                                  <span>
                                    {isOrderExpanded ? "Hide Products" : `View Products in Order (${order.items.length})`}
                                  </span>
                                  {isOrderExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>

                                {isOrderExpanded && (
                                  <div className="mt-2.5 border border-slate-200 rounded-xl overflow-hidden">
                                    <table className="w-full text-xs text-left">
                                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-200/70">
                                        <tr>
                                          <th className="px-3.5 py-2">Product / SKU</th>
                                          <th className="px-3.5 py-2 text-right">Unit Price</th>
                                          <th className="px-3.5 py-2 text-right">Quantity</th>
                                          <th className="px-3.5 py-2 text-right">Line Total</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {order.items.map((item, itmIdx) => (
                                          <tr key={itmIdx} className="hover:bg-slate-50/70">
                                            <td className="px-3.5 py-2.5">
                                              <div className="flex items-center gap-2.5">
                                                {item.image ? (
                                                  <img
                                                    src={item.image}
                                                    alt={item.name}
                                                    className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                                                  />
                                                ) : (
                                                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                                                    <Boxes size={14} />
                                                  </div>
                                                )}
                                                <div>
                                                  <p className="font-bold text-slate-900">{item.name}</p>
                                                  <p className="text-[10px] font-mono text-slate-500">
                                                    {item.sku || "—"}
                                                  </p>
                                                </div>
                                              </div>
                                            </td>
                                            <td className="px-3.5 py-2.5 text-right font-mono text-slate-700">
                                              {formatINR(item.unitPrice)}
                                            </td>
                                            <td className="px-3.5 py-2.5 text-right font-mono font-black text-slate-900">
                                              {item.quantity} units
                                            </td>
                                            <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900">
                                              {formatINR(item.lineTotal)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Master Table View */
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 font-bold">
                    <tr>
                      <th className="px-4 py-3">Order Ref</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Ordered (Got by Admin)</th>
                      <th className="px-4 py-3">Dispatched</th>
                      <th className="px-4 py-3">Delivered to Admin</th>
                      <th className="px-4 py-3 text-right">Units</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Products</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orderData.orders.map((order) => {
                      const isOrderExpanded = expandedOrderIds.has(order.id);
                      const isStock = order.orderType === "stock";

                      return (
                        <React.Fragment key={order.id}>
                          <tr className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-4 py-3 font-mono font-bold text-indigo-700">
                              #{order.orderId || String(order.id).slice(-8)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                                  isStock
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-blue-50 text-blue-700 border border-blue-200"
                                }`}
                              >
                                {isStock ? "Stock" : order.orderType}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                              {formatDate(order.orderedAt)}
                            </td>
                            <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                              {order.dispatchedAt ? formatDate(order.dispatchedAt) : "—"}
                            </td>
                            <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                              {order.deliveredAt ? formatDate(order.deliveredAt) : order.isDelivered ? "Delivered" : "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-black font-mono text-slate-900">
                              {order.totalUnits}
                            </td>
                            <td className="px-4 py-3 text-right font-bold font-mono text-slate-900">
                              {formatINR(order.totalValue)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <StatusPill status={order.status} />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => toggleOrderExpand(order.id)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[11px] font-bold text-slate-700 transition-colors"
                              >
                                {isOrderExpanded ? "Hide" : `${order.items.length} items`}
                              </button>
                            </td>
                          </tr>
                          {isOrderExpanded && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={9} className="px-6 py-3">
                                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                                  <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                                      <tr>
                                        <th className="px-3.5 py-2">Product</th>
                                        <th className="px-3.5 py-2 text-right">Price</th>
                                        <th className="px-3.5 py-2 text-right">Qty</th>
                                        <th className="px-3.5 py-2 text-right">Line Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {order.items.map((item, itmIdx) => (
                                        <tr key={itmIdx}>
                                          <td className="px-3.5 py-2 font-medium text-slate-900">
                                            {item.name} {item.sku && <span className="font-mono text-slate-400">({item.sku})</span>}
                                          </td>
                                          <td className="px-3.5 py-2 text-right font-mono text-slate-600">
                                            {formatINR(item.unitPrice)}
                                          </td>
                                          <td className="px-3.5 py-2 text-right font-mono font-black text-slate-900">
                                            {item.quantity}
                                          </td>
                                          <td className="px-3.5 py-2 text-right font-mono font-bold text-slate-900">
                                            {formatINR(item.lineTotal)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination */}
          {orderData && orderData.totalPages > 1 && (
            <div className="p-4 bg-white border border-slate-200 rounded-2xl flex items-center justify-between text-xs text-slate-600 shadow-sm">
              <span>
                Showing Page <strong className="text-slate-900">{orderPage}</strong> of{" "}
                <strong className="text-slate-900">{orderData.totalPages}</strong> ({orderData.total} Total Orders)
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={orderPage <= 1}
                  onClick={() => setOrderPage((p) => Math.max(p - 1, 1))}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors flex items-center gap-1 font-semibold"
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <button
                  type="button"
                  disabled={orderPage >= orderData.totalPages}
                  onClick={() => setOrderPage((p) => Math.min(p + 1, orderData.totalPages))}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors flex items-center gap-1 font-semibold"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {activeModalProduct && (
        <ProductTraceModal
          open={Boolean(activeModalProduct)}
          onClose={() => setActiveModalProduct(null)}
          partnerId={partnerId}
          productId={activeModalProduct.id}
          productName={activeModalProduct.name}
        />
      )}
    </PageShell>
  );
};

export default FranchiseStockTrace;
