import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import franchiseApi from "../../services/franchiseApi";
import ReportPageShell from "@shared/reports/ReportPageShell";
import ReportKpiGrid from "@shared/reports/ReportKpiGrid";
import ReportDataTable from "@shared/reports/ReportDataTable";
import ReportDateRangePicker from "@shared/reports/ReportDateRangePicker";
import ReportExportButton from "@shared/reports/ReportExportButton";
import ReportTrendChart from "@shared/reports/ReportTrendChart";

const FranchiseReportsPage = () => {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ startDate: "", endDate: "" });
  const [tab, setTab] = useState("stock-purchases");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await franchiseApi.getInventoryReports(filters);
      setData(res?.data?.result || res?.data?.data || null);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load franchise reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    if (tab === "stock-purchases") return data?.stockPurchases || [];
    if (tab === "fulfillment") return data?.movements?.items?.filter((x) => x.type === "FULFILLMENT") || [];
    if (tab === "inventory") return data?.summary?.items || [];
    return data?.movements?.items || [];
  }, [tab, data]);

  const columns = useMemo(() => {
    if (tab === "stock-purchases") {
      return [
        { key: "orderId", label: "Order" },
        { key: "units", label: "Units" },
        { key: "amount", label: "Amount" },
        { key: "createdAt", label: "Date" },
      ];
    }
    if (tab === "inventory") {
      return [
        { key: "product.name", label: "Product", render: (row) => row.product?.name || "Product" },
        { key: "quantity", label: "On hand" },
      ];
    }
    return [
      { key: "productName", label: "Product" },
      { key: "type", label: "Type" },
      { key: "quantity", label: "Qty" },
      { key: "date", label: "Date" },
    ];
  }, [tab]);

  const kpis = [
    { label: "SKUs", value: data?.summary?.skuCount ?? 0 },
    { label: "Units", value: data?.summary?.totalUnits ?? 0 },
    { label: "Valuation", value: data?.summary?.valuation ?? 0 },
    { label: "Fulfillment units", value: data?.fulfillment?.units ?? 0 },
  ];

  return (
    <ReportPageShell
      title="Franchise Reports"
      subtitle="Stock purchasing, fulfillment, and movement trends for your franchise inventory."
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
                const res = await franchiseApi.exportInventoryReports(filters);
                const blob = new Blob([res.data], { type: "text/csv" });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "franchise-inventory-reports.csv";
                a.click();
                window.URL.revokeObjectURL(url);
              }}
            />
          </div>
        </div>
      }
    >
      <ReportKpiGrid items={kpis} />
      <div className="flex flex-wrap gap-2">
        {[
          ["stock-purchases", "Stock Purchases"],
          ["fulfillment", "Fulfillment"],
          ["inventory", "Inventory Snapshot"],
          ["movements", "Movement Log"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
              tab === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ReportTrendChart data={data?.trends || []} />
      <ReportDataTable columns={columns} rows={rows} emptyText={loading ? "Loading..." : "No records"} />
    </ReportPageShell>
  );
};

export default FranchiseReportsPage;
