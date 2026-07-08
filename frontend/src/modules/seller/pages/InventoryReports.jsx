import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { sellerApi } from "../services/sellerApi";
import ReportPageShell from "@shared/reports/ReportPageShell";
import ReportKpiGrid from "@shared/reports/ReportKpiGrid";
import ReportDataTable from "@shared/reports/ReportDataTable";
import ReportDateRangePicker from "@shared/reports/ReportDateRangePicker";
import ReportExportButton from "@shared/reports/ReportExportButton";
import ReportTrendChart from "@shared/reports/ReportTrendChart";

const BASE_TABS = [
  { id: "movements", label: "Movements" },
  { id: "low-stock", label: "Low Stock" },
];
const HUB_TABS = [
  { id: "hub-transfers", label: "B2B Transfers" },
  { id: "reconciliation", label: "Reconciliation" },
];

const InventoryReports = () => {
  const [report, setReport] = useState(null);
  const [tab, setTab] = useState("movements");
  const [filters, setFilters] = useState({ startDate: "", endDate: "" });
  const [loading, setLoading] = useState(true);
  const [isHubSeller, setIsHubSeller] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const profileRes = await sellerApi.getProfile();
      const seller = profileRes?.data?.result || profileRes?.data?.data || {};
      const isHub = Boolean(seller?.isPlatformHub || seller?.isFranchiseCatalogSource);
      setIsHubSeller(isHub);

      if (tab === "hub-transfers") {
        const res = await sellerApi.getHubTransferReports(filters);
        setReport(res?.data?.result || res?.data?.data || null);
      } else if (tab === "reconciliation") {
        const res = await sellerApi.getTransferReconciliation(filters);
        setReport(res?.data?.result || res?.data?.data || null);
      } else {
        const res = await sellerApi.getInventoryReports(filters);
        setReport(res?.data?.result || res?.data?.data || null);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [tab]);

  const kpis = [
    { label: "SKUs", value: report?.summary?.skuCount ?? 0 },
    { label: "Total units", value: report?.summary?.totalUnits ?? 0 },
    { label: "Valuation", value: report?.summary?.valuation ?? 0 },
    { label: "Low stock", value: report?.summary?.lowStock ?? 0 },
  ];

  const rows = useMemo(() => {
    if (tab === "movements") return report?.movements?.items || [];
    if (tab === "low-stock") return report?.lowStock || [];
    if (tab === "hub-transfers") return report?.transfers?.items || [];
    if (tab === "reconciliation") return report?.items || [];
    return [];
  }, [tab, report]);

  const columns = useMemo(() => {
    if (tab === "movements") {
      return [
        { key: "productName", label: "Product" },
        { key: "type", label: "Type" },
        { key: "direction", label: "Direction" },
        { key: "quantity", label: "Qty" },
        { key: "date", label: "Date" },
      ];
    }
    if (tab === "low-stock") {
      return [
        { key: "name", label: "Product" },
        { key: "sku", label: "SKU" },
        { key: "stock", label: "Stock" },
        { key: "lowStockAlert", label: "Threshold" },
      ];
    }
    if (tab === "hub-transfers") {
      return [
        { key: "transferGroupId", label: "Transfer Group" },
        { key: "productName", label: "Product" },
        { key: "quantity", label: "Qty" },
        { key: "createdAt", label: "Date" },
      ];
    }
    return [
      { key: "transferGroupId", label: "Transfer Group" },
      { key: "hubQuantity", label: "Hub Qty" },
      { key: "franchiseQuantity", label: "Franchise Qty" },
      { key: "matched", label: "Matched", render: (row) => (row.matched ? "Yes" : "No") },
    ];
  }, [tab]);

  const tabs = isHubSeller ? [...BASE_TABS, ...HUB_TABS] : BASE_TABS;

  return (
    <ReportPageShell
      title="Inventory Reports"
      subtitle="Track stock movement, low-stock products, and hub transfer reconciliation."
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
                const res = await sellerApi.exportInventoryReports(filters);
                const blob = new Blob([res.data], { type: "text/csv" });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "seller-inventory-reports.csv";
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
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
              tab === item.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <ReportTrendChart data={report?.trends || []} />
      <ReportDataTable columns={columns} rows={rows} emptyText={loading ? "Loading..." : "No records"} />
    </ReportPageShell>
  );
};

export default InventoryReports;
