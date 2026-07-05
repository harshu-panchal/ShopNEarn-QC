import React, { useEffect, useState } from "react";
import {
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ScrollText,
  RefreshCcw,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import {
  FranchisePageShell,
  PaymentStatusPill,
  OrderStatusPill,
  formatINR,
  formatDate,
} from "./franchiseCustomerShared";

const TYPE_LABEL = {
  FRANCHISE_WALLET_TOPUP_CREDIT: "Wallet Top-up Credit",
  FRANCHISE_WALLET_TOPUP_REQUEST: "Wallet Top-up Request",
  FRANCHISE_STOCK_PURCHASE: "Stock Purchase",
  FRANCHISE_MANUAL_ADJUSTMENT: "Manual Adjustment",
  FRANCHISE_REGISTRATION_PAYMENT: "Registration Payment",
  FRANCHISE_CUSTOMER_ORDER: "Customer Order",
};

const DEFAULT_CATEGORIES = [
  { value: "all", label: "All" },
  { value: "topup", label: "Wallet Top-ups" },
  { value: "stock", label: "Stock Purchases" },
  { value: "orders", label: "Customer Orders" },
  { value: "adjustment", label: "Adjustments" },
];

const DIRECTION_FILTERS = [
  { value: "", label: "All" },
  { value: "CREDIT", label: "Credits" },
  { value: "DEBIT", label: "Debits" },
];

const getTypeLabel = (row) => TYPE_LABEL[row?.type] || row?.type?.replace(/_/g, " ") || "Transaction";

const getDetailLine = (row) => {
  const meta = row?.metadata || {};
  if (row.type === "FRANCHISE_WALLET_TOPUP_CREDIT" && meta.depositedAmount) {
    return `Deposit ${formatINR(meta.depositedAmount)} · ${meta.multiplier || 2}× credit`;
  }
  if (row.type === "FRANCHISE_WALLET_TOPUP_REQUEST") {
    return `Expected credit ${formatINR(meta.expectedCredit)} after approval`;
  }
  if (row.type === "FRANCHISE_STOCK_PURCHASE" && row.orderNumber) {
    return `Order ${row.orderNumber}`;
  }
  if (row.type === "FRANCHISE_CUSTOMER_ORDER") {
    const parts = [
      meta.customerName || "Customer",
      meta.itemCount ? `${meta.itemCount} item${meta.itemCount > 1 ? "s" : ""}` : null,
      meta.paymentMode ? String(meta.paymentMode).replace(/_/g, " ") : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }
  if (row.type === "FRANCHISE_MANUAL_ADJUSTMENT" && meta.reason) {
    return meta.reason;
  }
  return row.description || row.reference || null;
};

const TransactionStatusPill = ({ row }) => {
  if (row.source === "topup_request") {
    return <PaymentStatusPill status={row.status} />;
  }
  if (row.source === "customer_order") {
    return <OrderStatusPill status={row.status} />;
  }
  const status = String(row.status || "COMPLETED").toLowerCase();
  const map = {
    completed: "bg-emerald-100 text-emerald-800",
    pending: "bg-amber-100 text-amber-800",
    failed: "bg-rose-100 text-rose-800",
  };
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${map[status] || map.completed}`}
    >
      {status}
    </span>
  );
};

const FranchiseTransactionHistoryPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState("");
  const [category, setCategory] = useState("all");
  const limit = 25;

  const load = async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (direction) params.direction = direction;
      if (category && category !== "all") params.category = category;
      const res = await franchiseApi.listTransactions(params);
      setData(res.data?.result ?? res.data?.data ?? res.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load transaction history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, direction, category]);

  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;
  const categories = data?.categories?.length ? data.categories : DEFAULT_CATEGORIES;

  return (
    <>
      <FranchiseMlmHeader title="Transaction history" />
      <FranchisePageShell
        title="Transaction history"
        subtitle="Track wallet activity, stock purchases, and customer order fulfillment"
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {categories.map((f) => (
              <button
                key={f.value || "all"}
                type="button"
                onClick={() => {
                  setCategory(f.value || "all");
                  if ((f.value || "all") === "orders") setDirection("");
                  setPage(1);
                }}
                className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                  category === (f.value || "all")
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {DIRECTION_FILTERS.map((f) => (
              <button
                key={f.value || "all-dir"}
                type="button"
                disabled={category === "orders"}
                onClick={() => {
                  setDirection(f.value);
                  setPage(1);
                }}
                className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors disabled:opacity-40 ${
                  direction === f.value
                    ? "bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <ScrollText size={16} className="text-slate-500" />
            <h3 className="text-base font-bold text-slate-900">All transactions</h3>
          </div>

          {loading ? (
            <div className="py-16 flex justify-center text-slate-400">
              <Loader2 size={28} className="animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((row) => {
                const isCredit = row.direction === "CREDIT";
                const isDebit = row.direction === "DEBIT";
                const isOrder = row.source === "customer_order";
                const detail = getDetailLine(row);
                return (
                  <li key={row.id} className="px-4 sm:px-5 py-4 flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isCredit
                          ? "bg-emerald-50 text-emerald-600"
                          : isDebit
                            ? "bg-rose-50 text-rose-600"
                            : isOrder
                              ? "bg-blue-50 text-blue-600"
                              : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {isCredit ? (
                        <ArrowDownLeft size={16} />
                      ) : isDebit ? (
                        <ArrowUpRight size={16} />
                      ) : isOrder ? (
                        <ClipboardList size={16} />
                      ) : (
                        <ScrollText size={16} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900">{getTypeLabel(row)}</p>
                          {row.orderNumber && (
                            <p className="text-xs font-mono text-indigo-600 mt-0.5 truncate">
                              {row.orderNumber}
                            </p>
                          )}
                          {detail && (
                            <p className="text-xs text-slate-500 mt-0.5 truncate">{detail}</p>
                          )}
                          <p className="text-[11px] text-slate-400 mt-1">{formatDate(row.createdAt)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {row.direction !== "NEUTRAL" && (
                            <p
                              className={`text-sm font-black ${
                                isCredit ? "text-emerald-700" : "text-rose-700"
                              }`}
                            >
                              {isCredit ? "+" : "-"}
                              {formatINR(row.amount)}
                            </p>
                          )}
                          {row.direction === "NEUTRAL" && (
                            <p className="text-sm font-black text-slate-700">{formatINR(row.amount)}</p>
                          )}
                          {row.balanceAfter != null && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Bal {formatINR(row.balanceAfter)}
                            </p>
                          )}
                          <div className="mt-1 flex justify-end">
                            <TransactionStatusPill row={row} />
                          </div>
                        </div>
                      </div>
                      {row.metadata?.rejectionReason && (
                        <p className="text-xs text-rose-600 mt-2">{row.metadata.rejectionReason}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 disabled:opacity-40"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-xs text-slate-500">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 disabled:opacity-40"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </FranchisePageShell>
    </>
  );
};

export default FranchiseTransactionHistoryPage;
