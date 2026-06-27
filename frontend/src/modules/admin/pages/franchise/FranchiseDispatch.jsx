import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCcw, Truck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import { adminApi } from "../../services/adminApi";
import {
  PageShell,
  FilterTabs,
  DataTable,
  EmptyRow,
  formatINR,
  formatDate,
  formatAddressSnapshot,
} from "./franchiseAdminShared";

const DISPATCH_TABS = [
  { value: "awaiting_dispatch", label: "Awaiting dispatch" },
  { value: "pending_partner", label: "Pending partner" },
  { value: "in_transit", label: "In transit" },
];

const FranchiseDispatch = () => {
  const [dispatchStatus, setDispatchStatus] = useState("awaiting_dispatch");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [riders, setRiders] = useState([]);
  const [assigningId, setAssigningId] = useState(null);
  const [selectedRider, setSelectedRider] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFranchiseApi.listDispatchOrders({
        dispatchStatus,
        limit: 50,
      });
      setItems(res.data?.result?.items ?? res.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load dispatch queue");
    } finally {
      setLoading(false);
    }
  };

  const loadRiders = async () => {
    try {
      const res = await adminApi.getDeliveryPartners({ status: "active", limit: 200 });
      const list = res.data?.result?.deliveryPartners ?? res.data?.data?.deliveryPartners ?? [];
      setRiders(list);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    load();
  }, [dispatchStatus]);

  useEffect(() => {
    loadRiders();
  }, []);

  const assign = async (order) => {
    const riderId = selectedRider[order._id];
    if (!riderId) {
      toast.error("Select a delivery partner first");
      return;
    }
    const publicId = order.orderId || order._id;
    setAssigningId(order._id);
    try {
      await adminFranchiseApi.assignOrderDelivery(publicId, { deliveryBoyId: riderId });
      toast.success(`Rider assigned to ${publicId}`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Assignment failed");
    } finally {
      setAssigningId(null);
    }
  };

  const columns = [
    { key: "order", label: "Order" },
    { key: "partner", label: "Partner" },
    { key: "customer", label: "Customer" },
    { key: "total", label: "Total", align: "right" },
    { key: "rider", label: "Rider / Action" },
  ];

  return (
    <PageShell
      title="Franchise dispatch"
      subtitle="Assign delivery partners to Home Shoppy orders on behalf of franchise partners (Shiprocket desk)."
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
      <FilterTabs options={DISPATCH_TABS} value={dispatchStatus} onChange={setDispatchStatus} />

      <DataTable columns={columns}>
        {loading ? (
          <EmptyRow colSpan={5} message="Loading dispatch queue…" />
        ) : items.length === 0 ? (
          <EmptyRow colSpan={5} message="No orders in this queue." />
        ) : (
          items.map((order) => {
            const total =
              order.paymentBreakdown?.grandTotal ??
              order.pricing?.total ??
              order.items?.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0) ??
              0;
            const publicId = order.orderId || order._id;
            const partner = order.franchisePartnerId;
            const canAssign = dispatchStatus === "awaiting_dispatch";

            return (
              <tr key={order._id} className="border-b border-slate-100 hover:bg-slate-50/80">
                <td className="px-4 py-3 align-top">
                  <Link
                    to={`/admin/orders/view/${publicId}`}
                    className="font-mono font-bold text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    {publicId}
                    <ExternalLink size={12} />
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">{formatDate(order.createdAt)}</p>
                </td>
                <td className="px-4 py-3 align-top text-sm">
                  <p className="font-semibold text-slate-900">
                    {partner?.displayName || "Partner"}
                  </p>
                  <p className="text-xs text-slate-500">{partner?.referralCode}</p>
                </td>
                <td className="px-4 py-3 align-top text-sm">
                  <p className="font-semibold">{order.customer?.name || "—"}</p>
                  <p className="text-xs text-slate-500">{order.customer?.phone}</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[200px] truncate">
                    {formatAddressSnapshot(order.address)}
                  </p>
                </td>
                <td className="px-4 py-3 align-top text-right font-bold text-slate-900">
                  {formatINR(total)}
                </td>
                <td className="px-4 py-3 align-top">
                  {canAssign ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedRider[order._id] || ""}
                        onChange={(e) =>
                          setSelectedRider((prev) => ({ ...prev, [order._id]: e.target.value }))
                        }
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 min-w-[160px]"
                      >
                        <option value="">Select rider…</option>
                        {riders.map((r) => (
                          <option key={r._id} value={r._id}>
                            {r.name} ({r.phone})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={assigningId === order._id}
                        onClick={() => assign(order)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                      >
                        <Truck size={12} /> Assign
                      </button>
                    </div>
                  ) : order.deliveryBoy ? (
                    <div className="text-sm">
                      <p className="font-semibold">{order.deliveryBoy.name}</p>
                      <p className="text-xs text-slate-500">{order.deliveryBoy.phone}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </DataTable>
    </PageShell>
  );
};

export default FranchiseDispatch;
