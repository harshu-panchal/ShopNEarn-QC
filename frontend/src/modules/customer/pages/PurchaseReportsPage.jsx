import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { customerApi } from "../services/customerApi";
import ReportPageShell from "@shared/reports/ReportPageShell";
import ReportKpiGrid from "@shared/reports/ReportKpiGrid";
import ReportDataTable from "@shared/reports/ReportDataTable";
import ReportDateRangePicker from "@shared/reports/ReportDateRangePicker";
import ReportExportButton from "@shared/reports/ReportExportButton";

const PurchaseReportsPage = () => {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ startDate: "", endDate: "" });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("order-lines");

  const load = async () => {
    setLoading(true);
    try {
      const res = await customerApi.getPurchaseReports(filters);
      setData(res?.data?.result || res?.data?.data || null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const kpis = [
    { label: "Orders", value: data?.summary?.totalOrders ?? 0 },
    { label: "Total Spend", value: data?.summary?.totalSpend ?? 0 },
    { label: "Avg Order Value", value: data?.summary?.averageOrderValue ?? 0 },
    { label: "Items Purchased", value: data?.summary?.totalItems ?? 0 },
  ];

  const rows = useMemo(() => {
    if (tab === "order-lines") return data?.lines?.items || [];
    return data?.topProducts || [];
  }, [data, tab]);

  const columns = useMemo(() => {
    if (tab === "order-lines") {
      return [
        { key: "orderId", label: "Order" },
        { key: "productName", label: "Product" },
        { key: "quantity", label: "Qty" },
        { key: "price", label: "Price" },
        { key: "amount", label: "Amount" },
      ];
    }
    return [
      { key: "productName", label: "Product" },
      { key: "units", label: "Units" },
      { key: "spend", label: "Spend" },
    ];
  }, [tab]);

  return (
    <ReportPageShell
      title="Purchase Reports"
      subtitle="Retail purchase analytics based on your order history."
      filters={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReportDateRangePicker
            startDate={filters.startDate}
            endDate={filters.endDate}
            onChange={setFilters}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300"
            >
              Apply
            </button>
            <ReportExportButton
              onExport={async () => {
                const res = await customerApi.exportPurchaseReports(filters);
                const blob = new Blob([res.data], { type: "text/csv" });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "customer-purchase-reports.csv";
                a.click();
                window.URL.revokeObjectURL(url);
              }}
            />
          </div>
        </div>
      }
    >
      <ReportKpiGrid items={kpis} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("order-lines")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
            tab === "order-lines" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
          }`}
        >
          Order Lines
        </button>
        <button
          type="button"
          onClick={() => setTab("top-products")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
            tab === "top-products" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
          }`}
        >
          Top Products
        </button>
      </div>
      <ReportDataTable columns={columns} rows={rows} emptyText={loading ? "Loading..." : "No records"} />
    </ReportPageShell>
  );
};

export default PurchaseReportsPage;
