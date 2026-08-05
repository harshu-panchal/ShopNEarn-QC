import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  History,
  Download,
  FileText,
  Printer,
  RefreshCcw,
  Plus,
  Edit2,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import PosReceiptPrint from "./PosReceiptPrint";
import EditPosSaleModal from "./EditPosSaleModal";
import Pagination from "@shared/components/ui/Pagination";
import {
  FranchisePageShell,
  FranchiseStatCard,
  SectionCard,
  EmptyState,
  formatINR,
  formatDate,
} from "./franchiseCustomerShared";

const paymentLabel = (method) => {
  if (method === "upi_partner") return "UPI";
  if (method === "cash") return "Cash";
  return method || "—";
};

function downloadBlob(blob, fileName) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

const FranchisePosHistoryPage = () => {
  const navigate = useNavigate();
  const [posEnabled, setPosEnabled] = useState(false);
  const [loadingMe, setLoadingMe] = useState(true);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ startDate: "", endDate: "" });
  const [exporting, setExporting] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await franchiseApi.listPosSales({
        page,
        limit: 20,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      const payload = res.data?.result ?? res.data?.data;
      setItems(payload?.items ?? []);
      setTotalPages(payload?.totalPages || 1);
      setTotal(payload?.total || 0);
    } catch (err) {
      const code = err?.response?.data?.result?.code ?? err?.response?.data?.code;
      if (code === "POS_DISABLED") setPosEnabled(false);
      toast.error(err?.response?.data?.message || "Failed to load POS history");
    } finally {
      setLoading(false);
    }
  }, [page, filters.startDate, filters.endDate]);

  useEffect(() => {
    if (!loadingMe && posEnabled) load();
  }, [loadingMe, posEnabled, load]);

  const totalRevenue = items.reduce((sum, row) => sum + Number(row.grandTotal || 0), 0);

  const handleViewReceipt = async (orderId) => {
    try {
      const res = await franchiseApi.getPosReceipt(orderId);
      setReceipt(res.data?.result ?? res.data?.data);
      setShowReceipt(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load receipt");
    }
  };

  const handleDownloadInvoice = async (orderId) => {
    setDownloadingId(orderId);
    try {
      const res = await franchiseApi.downloadPosInvoice(orderId);
      if (res.data?.type && String(res.data.type).includes("application/json")) {
        const text = await res.data.text();
        const parsed = JSON.parse(text);
        throw new Error(parsed?.message || "Invoice download failed");
      }
      const blob = new Blob([res.data], { type: "application/pdf" });
      downloadBlob(blob, `pos-invoice-${orderId}.pdf`);
      toast.success("Invoice PDF downloaded");
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || "Invoice download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const res = await franchiseApi.exportPosSalesExcel({
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      });
      if (res.data?.type && String(res.data.type).includes("application/json")) {
        const text = await res.data.text();
        const parsed = JSON.parse(text);
        throw new Error(parsed?.message || "Excel export failed");
      }
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `pos-sales-report-${stamp}.xlsx`);
      toast.success("POS report Excel downloaded");
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || "Excel export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loadingMe) {
    return (
      <>
        <FranchiseMlmHeader title="POS history" />
        <div className="p-8 text-center text-slate-500">Loading…</div>
      </>
    );
  }

  if (!posEnabled) {
    return (
      <>
        <FranchiseMlmHeader title="POS history" />
        <FranchisePageShell title="POS order history">
          <EmptyState message="Franchise POS is not enabled. Ask your administrator to turn it on." />
          <Link to="/mlm/franchise" className="text-sm font-semibold text-indigo-600">
            Back to dashboard
          </Link>
        </FranchisePageShell>
      </>
    );
  }

  return (
    <>
      <FranchiseMlmHeader title="POS history" />
      <FranchisePageShell
        title="POS order history"
        subtitle="View walk-in sales, download invoices, and export the full POS report."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/mlm/franchise/pos"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-indigo-600 text-white rounded-lg"
            >
              <Plus size={14} /> New sale
            </Link>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-emerald-600 text-white rounded-lg disabled:opacity-50"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Excel report
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg"
            >
              <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FranchiseStatCard label="Bills (page)" value={loading ? "…" : items.length} tone="indigo" />
          <FranchiseStatCard label="Total bills" value={loading ? "…" : total} tone="slate" />
          <FranchiseStatCard
            label="Page revenue"
            value={loading ? "…" : formatINR(totalRevenue)}
            tone="emerald"
          />
        </div>

        <SectionCard title="Filters">
          <div className="p-4 flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-slate-600">
              From
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => {
                  setPage(1);
                  setFilters((f) => ({ ...f, startDate: e.target.value }));
                }}
                className="mt-1 block border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              To
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => {
                  setPage(1);
                  setFilters((f) => ({ ...f, endDate: e.target.value }));
                }}
                className="mt-1 block border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setFilters({ startDate: "", endDate: "" });
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200"
            >
              Clear
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Sales">
          {loading ? (
            <p className="p-6 text-sm text-slate-500">Loading sales…</p>
          ) : items.length === 0 ? (
            <EmptyState message="No POS sales yet. Complete a walk-in bill to see it here." />
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((row) => (
                <div
                  key={row.orderId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-slate-900">#{row.orderId}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDate(row.createdAt)}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {row.buyer?.name || "Walk-in"}
                      {row.buyer?.phone ? ` · ${row.buyer.phone}` : ""}
                      {" · "}
                      {paymentLabel(row.paymentMethod)}
                      {" · "}
                      {row.itemCount} items
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-900 mr-1">{formatINR(row.grandTotal)}</span>
                    <button
                      type="button"
                      onClick={() => setEditingOrderId(row.orderId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold uppercase rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                    >
                      <Edit2 size={12} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleViewReceipt(row.orderId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold uppercase rounded-lg border border-slate-200"
                    >
                      <Printer size={12} /> View
                    </button>
                    <button
                      type="button"
                      disabled={downloadingId === row.orderId}
                      onClick={() => handleDownloadInvoice(row.orderId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold uppercase rounded-lg bg-slate-900 text-white disabled:opacity-50"
                    >
                      {downloadingId === row.orderId ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <FileText size={12} />
                      )}
                      Invoice
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={20}
            onPageChange={setPage}
            compact
          />
        )}
      </FranchisePageShell>

      {showReceipt && receipt && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 print:hidden">
              <h3 className="font-bold flex items-center gap-2">
                <History size={16} /> Receipt
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadInvoice(receipt.orderId)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold"
                >
                  <Download size={14} /> Invoice
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-bold"
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
            <PosReceiptPrint receipt={receipt} />
          </div>
        </div>
      )}

      {editingOrderId && (
        <EditPosSaleModal
          orderId={editingOrderId}
          onClose={() => setEditingOrderId(null)}
          onUpdated={() => load()}
        />
      )}
    </>
  );
};

export default FranchisePosHistoryPage;
