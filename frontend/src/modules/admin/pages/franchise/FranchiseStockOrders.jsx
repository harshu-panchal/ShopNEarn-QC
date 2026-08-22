import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Truck, PackageCheck, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import {
  PageShell,
  FilterTabs,
  DataTable,
  EmptyRow,
  StatusPill,
  formatINR,
  formatDate,
  useBodyScrollLock,
} from "./franchiseAdminShared";

/**
 * Admin > Home Shoppy > Stock Orders.
 *
 * A franchise partner's "Buy Stock" purchase (`purchaseFranchiseStock`)
 * requires two admin/partner confirmations before it actually reaches
 * the partner's FranchiseStockLedger:
 *   REQUESTED -> (admin dispatches from hub) -> DISPATCHED_PENDING_RECEIPT
 *   -> (partner or admin confirms receipt) -> DELIVERED
 * The order's top-level `status` is set to "delivered" at creation
 * time regardless, so an order can look finished while its stock is
 * still sitting un-dispatched — this page is the only place admin can
 * actually move it forward.
 */
const STATUS_FILTERS = [
  { value: "REQUESTED", label: "Awaiting Dispatch" },
  { value: "DISPATCHED_PENDING_RECEIPT", label: "Awaiting Receipt" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "ALL", label: "All" },
];

const itemsTotal = (items = []) =>
  items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);

const FranchiseStockOrders = () => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("REQUESTED");
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFranchiseApi.listStockOrders({ status, limit: 100 });
      setItems(res.data?.result?.items ?? res.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load stock orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const dispatch = async (row) => {
    if (!window.confirm(`Dispatch this stock order from the hub to ${row.franchisePartnerId?.displayName || "the franchise"}?`)) return;
    setActionId(row._id);
    try {
      await adminFranchiseApi.dispatchStockOrder(row.orderId);
      toast.success("Stock order dispatched — hub stock decremented");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Dispatch failed");
    } finally {
      setActionId(null);
    }
  };

  const confirmReceipt = async (row) => {
    if (!window.confirm(`Confirm receipt on behalf of ${row.franchisePartnerId?.displayName || "the franchise"}? This credits their stock ledger.`)) return;
    setActionId(row._id);
    try {
      await adminFranchiseApi.approveStockOrderReceipt(row.orderId);
      toast.success("Receipt confirmed — franchise stock ledger updated");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Confirm receipt failed");
    } finally {
      setActionId(null);
    }
  };

  return (
    <PageShell
      title="Franchise Stock Orders"
      subtitle="Every 'Buy Stock' purchase needs a hub dispatch, then a receipt confirmation, before it reaches the franchise's own stock. Nothing here moves automatically."
      actions={<FilterTabs options={STATUS_FILTERS} value={status} onChange={setStatus} />}
    >
      <DataTable
        columns={[
          { key: "submitted", label: "Submitted" },
          { key: "partner", label: "Franchise Partner" },
          { key: "items", label: "Items" },
          { key: "total", label: "Order Total", align: "right" },
          { key: "status", label: "Status" },
          { key: "action", label: "Actions", align: "right" },
        ]}
      >
        {loading ? (
          <EmptyRow colSpan={6} message="Loading stock orders…" />
        ) : items.length === 0 ? (
          <EmptyRow colSpan={6} message="No stock orders in this status." />
        ) : (
          items.map((row) => (
            <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
              <td className="px-4 py-3 text-xs whitespace-nowrap">{formatDate(row.createdAt)}</td>
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-900">{row.franchisePartnerId?.displayName || "—"}</p>
                <p className="text-xs text-slate-500">{row.franchisePartnerId?.referralCode || "—"}</p>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {(row.items || []).length} product{(row.items || []).length === 1 ? "" : "s"}
                {" · "}
                {(row.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0)} units
              </td>
              <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                {formatINR(itemsTotal(row.items))}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={row.franchiseStockStatus || "REQUESTED"} />
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <div className="flex flex-wrap gap-1 justify-end">
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-slate-700 hover:bg-slate-900 text-white rounded inline-flex items-center gap-1"
                  >
                    <Eye size={10} /> View
                  </button>
                  {row.franchiseStockStatus === "REQUESTED" && (
                    <button
                      type="button"
                      onClick={() => dispatch(row)}
                      disabled={actionId === row._id}
                      className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white rounded inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Truck size={10} /> Dispatch
                    </button>
                  )}
                  {row.franchiseStockStatus === "DISPATCHED_PENDING_RECEIPT" && (
                    <button
                      type="button"
                      onClick={() => confirmReceipt(row)}
                      disabled={actionId === row._id}
                      className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <PackageCheck size={10} /> Confirm Receipt
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))
        )}
      </DataTable>

      <StockOrderDetailModal
        row={selected}
        onClose={() => setSelected(null)}
        onDispatch={dispatch}
        onConfirmReceipt={confirmReceipt}
        actionInProgress={selected && actionId === selected._id}
      />
    </PageShell>
  );
};

const StockOrderDetailModal = ({ row, onClose, onDispatch, onConfirmReceipt, actionInProgress }) => {
  useBodyScrollLock(!!row);
  if (!row) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{row.orderId}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {row.franchisePartnerId?.displayName} · {formatDate(row.createdAt)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 min-h-0">
          <div className="flex items-center justify-between mb-3">
            <StatusPill status={row.franchiseStockStatus || "REQUESTED"} />
            <p className="text-sm font-bold text-slate-900">{formatINR(itemsTotal(row.items))}</p>
          </div>
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
            {(row.items || []).map((item, idx) => (
              <div key={item._id || idx} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-slate-700">{item.name || item.product?.name || "Product"}</span>
                <span className="text-slate-500 whitespace-nowrap ml-3">
                  {item.quantity} × {formatINR(item.price)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t border-slate-100 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
            Close
          </button>
          {row.franchiseStockStatus === "REQUESTED" && (
            <button
              type="button"
              onClick={() => onDispatch(row)}
              disabled={actionInProgress}
              className="px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Truck size={14} /> Dispatch
            </button>
          )}
          {row.franchiseStockStatus === "DISPATCHED_PENDING_RECEIPT" && (
            <button
              type="button"
              onClick={() => onConfirmReceipt(row)}
              disabled={actionInProgress}
              className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
            >
              <PackageCheck size={14} /> Confirm Receipt
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FranchiseStockOrders;
