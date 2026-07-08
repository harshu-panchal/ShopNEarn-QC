import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import ReportPageShell from "@shared/reports/ReportPageShell";
import ReportKpiGrid from "@shared/reports/ReportKpiGrid";
import ReportDataTable from "@shared/reports/ReportDataTable";
import ReportDateRangePicker from "@shared/reports/ReportDateRangePicker";
import ReportExportButton from "@shared/reports/ReportExportButton";
import inventoryReportsApi from "../../services/api/inventoryReportsApi";

const TABS = [
  { id: "sellers", label: "Sellers" },
  { id: "hub", label: "Hub" },
  { id: "franchise", label: "Franchise" },
  { id: "b2b", label: "B2B Purchases" },
  { id: "customer-retail", label: "Customer Retail" },
  { id: "reconciliation", label: "Reconciliation" },
];

const InventoryReportsHub = () => {
  const [tab, setTab] = useState("sellers");
  const [rows, setRows] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ startDate: "", endDate: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [overviewRes, tabRes] = await Promise.all([
        inventoryReportsApi.getOverview(filters),
        tab === "sellers"
          ? inventoryReportsApi.getSellers(filters)
          : tab === "hub"
            ? inventoryReportsApi.getHub(filters)
            : tab === "franchise"
              ? inventoryReportsApi.getFranchise(filters)
              : tab === "b2b"
                ? inventoryReportsApi.getB2bPurchases(filters)
                : tab === "customer-retail"
                  ? inventoryReportsApi.getCustomerRetail(filters)
                  : inventoryReportsApi.getReconciliation(filters),
      ]);
      setOverview(overviewRes?.data?.result?.overview || null);
      setRows(tabRes?.data?.result?.rows || tabRes?.data?.result?.items || []);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [tab]);

  const columns = useMemo(() => {
    if (tab === "sellers") {
      return [
        { key: "sellerName", label: "Seller" },
        { key: "skuCount", label: "SKUs" },
        { key: "totalUnits", label: "Units" },
        { key: "valuation", label: "Valuation" },
        { key: "lowStock", label: "Low Stock" },
      ];
    }
    if (tab === "hub") {
      return [
        { key: "hubName", label: "Hub" },
        { key: "transferEvents", label: "Transfers" },
        { key: "transferUnits", label: "Units" },
        { key: "purchaseOrders", label: "B2B Orders" },
        { key: "purchaseAmount", label: "Amount" },
      ];
    }
    if (tab === "franchise") {
      return [
        { key: "partnerName", label: "Partner" },
        { key: "skuCount", label: "SKUs" },
        { key: "totalUnits", label: "Units" },
        { key: "valuation", label: "Valuation" },
      ];
    }
    if (tab === "b2b") {
      return [
        { key: "orderId", label: "Order" },
        { key: "partnerName", label: "Partner" },
        { key: "sellerName", label: "Hub" },
        { key: "amount", label: "Amount" },
        { key: "itemCount", label: "Items" },
      ];
    }
    if (tab === "customer-retail") {
      return [
        { key: "orderId", label: "Order" },
        { key: "customerName", label: "Customer" },
        { key: "amount", label: "Amount" },
        { key: "itemCount", label: "Items" },
      ];
    }
    return [
      { key: "transferGroupId", label: "Transfer Group" },
      { key: "hubQuantity", label: "Hub Qty" },
      { key: "franchiseQuantity", label: "Franchise Qty" },
      {
        key: "matched",
        label: "Matched",
        render: (row) => (row.matched ? "Yes" : "No"),
      },
    ];
  }, [tab]);

  const kpis = [
    { label: "Active sellers", value: overview?.activeSellers ?? 0 },
    { label: "Franchise partners", value: overview?.activeFranchisePartners ?? 0 },
    { label: "Retail orders", value: overview?.retailOrders ?? 0 },
    { label: "B2B purchase orders", value: overview?.b2bPurchaseOrders ?? 0 },
  ];

  return (
    <ReportPageShell
      title="Inventory & Purchasing Reports"
      subtitle="Unified admin report hub across sellers, hub, franchise, and customers."
      filters={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReportDateRangePicker
            startDate={filters.startDate}
            endDate={filters.endDate}
            onChange={setFilters}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300"
            >
              Apply
            </button>
            <ReportExportButton
              onExport={async () => {
                const res = await inventoryReportsApi.export({ ...filters, type: tab });
                const blob = new Blob([res.data], { type: "text/csv" });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `admin-inventory-${tab}.csv`;
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
        {TABS.map((item) => (
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
      <ReportDataTable columns={columns} rows={rows} emptyText={loading ? "Loading..." : "No data"} />
    </ReportPageShell>
  );
};

export default InventoryReportsHub;
