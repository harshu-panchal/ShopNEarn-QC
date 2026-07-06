import React, { useEffect, useState } from "react";
import {
  MapPin,
  Phone,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Truck,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import {
  FranchisePageShell,
  FranchiseStatCard,
  SectionCard,
  OrderStatusPill,
  EmptyState,
  OrderLineThumb,
  formatINR,
  formatDate,
} from "./franchiseCustomerShared";

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "fulfilled", label: "Fulfilled" },
  { key: "rejected", label: "Rejected" },
];

const getOrderFlowLabel = (order) => {
  if (order.franchiseStatus === "pending") return "pending";
  if (order.franchiseStatus === "rejected") return "rejected";
  if (order.franchiseStatus === "fulfilled") return "fulfilled";
  if (order.shipmentStatus === "pending" || !order.shipmentStatus)
    return "ready_to_ship";
  if (order.shipmentStatus === "created") return "shipment_created";
  return "accepted";
};

const FLOW_LABELS = {
  pending: { text: "Needs your response", tone: "amber" },
  ready_to_ship: { text: "Create shipment", tone: "indigo" },
  shipment_created: { text: "Ready to deliver", tone: "emerald" },
  accepted: { text: "In progress", tone: "indigo" },
  fulfilled: { text: "Delivered", tone: "emerald" },
  rejected: { text: "Rejected", tone: "slate" },
};

const FranchiseOrdersPage = () => {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ pending: 0, accepted: 0, fulfilled: 0 });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);

  const load = async (filter = status) => {
    setLoading(true);
    try {
      const [listRes, allRes] = await Promise.all([
        franchiseApi.listOrders({ limit: 50, status: filter || undefined }),
        franchiseApi.listOrders({ limit: 100 }),
      ]);
      setItems(listRes.data?.result?.items ?? listRes.data?.data?.items ?? []);
      const all = allRes.data?.result?.items ?? allRes.data?.data?.items ?? [];
      setStats({
        pending: all.filter((o) => o.franchiseStatus === "pending").length,
        accepted: all.filter((o) => o.franchiseStatus === "accepted").length,
        fulfilled: all.filter((o) => o.franchiseStatus === "fulfilled").length,
      });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const act = async (fn, orderId) => {
    setActingId(orderId);
    try {
      await fn(orderId);
      toast.success("Order updated");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Action failed");
    } finally {
      setActingId(null);
    }
  };

  const formatAddress = (addr) => {
    if (!addr) return "Address not available";
    const parts = [addr.address, addr.city, addr.landmark].filter(Boolean);
    return parts.join(", ") || "Address not available";
  };

  return (
    <>
      <FranchiseMlmHeader title="Customer Orders" />
      <FranchisePageShell
        title="Customer orders"
        subtitle="Accept customer orders, create shipment, and mark delivered when you fulfill from your local stock."
        actions={
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />{" "}
            Refresh
          </button>
        }>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FranchiseStatCard
            label="Pending"
            value={loading ? "…" : stats.pending}
            hint="Needs your response"
            tone="amber"
          />
          <FranchiseStatCard
            label="Accepted"
            value={loading ? "…" : stats.accepted}
            hint="Shipment / delivery in progress"
            tone="indigo"
          />
          <FranchiseStatCard
            label="Fulfilled"
            value={loading ? "…" : stats.fulfilled}
            tone="emerald"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key || "all"}
              type="button"
              onClick={() => setStatus(tab.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border transition-colors ${
                status === tab.key
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 text-center py-8">
            Loading orders…
          </p>
        ) : items.length === 0 ? (
          <SectionCard>
            <EmptyState message="No orders in this view. New customer orders will appear here when routed to your location." />
          </SectionCard>
        ) : (
          <div className="space-y-4">
            {items.map((order) => {
              const total =
                order.paymentBreakdown?.grandTotal ??
                order.pricing?.total ??
                order.items?.reduce(
                  (s, i) => s + (i.price || 0) * (i.quantity || 0),
                  0,
                ) ??
                0;
              const busy = actingId === order._id;
              const flowKey = getOrderFlowLabel(order);
              const flowMeta = FLOW_LABELS[flowKey] || FLOW_LABELS.accepted;

              return (
                <SectionCard key={order._id}>
                  <div className="p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono font-bold text-slate-900">
                          {order.orderId || order._id}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDate(order.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <OrderStatusPill status={order.franchiseStatus} />
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">
                          {flowMeta.text}
                        </p>
                        <p className="text-lg font-black text-slate-900 mt-1">
                          {formatINR(total)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                          Customer
                        </p>
                        <p className="font-semibold">
                          {order.customer?.name || "Customer"}
                        </p>
                        {order.customer?.phone && (
                          <p className="flex items-center gap-1.5 text-slate-600 mt-1 text-xs">
                            <Phone size={12} /> {order.customer.phone}
                          </p>
                        )}
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                          Delivery
                        </p>
                        <p className="flex items-start gap-1.5 text-xs text-slate-700 leading-relaxed">
                          <MapPin
                            size={14}
                            className="text-indigo-500 shrink-0 mt-0.5"
                          />
                          {formatAddress(order.address)}
                        </p>
                        {order.address?.phone && (
                          <p className="text-xs text-slate-500 mt-1">
                            Contact: {order.address.phone}
                          </p>
                        )}
                      </div>
                    </div>

                    {order.items?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1">
                          <Package size={12} /> Items ({order.items.length})
                        </p>
                        <ul className="space-y-1.5">
                          {order.items.map((line, idx) => (
                            <li
                              key={idx}
                              className="flex items-center gap-3 text-sm bg-white border border-slate-100 rounded-lg px-3 py-2">
                              <OrderLineThumb line={line} size="sm" />
                              <span className="flex-1 min-w-0 truncate">
                                {line.name || "Item"} × {line.quantity}
                              </span>
                              <span className="font-semibold shrink-0">
                                {formatINR(
                                  (line.price || 0) * (line.quantity || 1),
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {order.franchiseStatus === "pending" && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            act(franchiseApi.acceptOrder, order._id)
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                          <CheckCircle2 size={14} /> Accept order
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            act(
                              (id) =>
                                franchiseApi.rejectOrder(id, {
                                  reason: "Unavailable at location",
                                }),
                              order._id,
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                          <XCircle size={14} /> Reject
                        </button>
                      </div>
                    )}

                    {order.franchiseStatus === "accepted" &&
                      (order.shipmentStatus === "pending" ||
                        !order.shipmentStatus) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act(franchiseApi.createShipment, order._id)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                            <Truck size={14} /> Create shipment
                          </button>
                        </div>
                      )}

                    {order.franchiseStatus === "accepted" &&
                      order.shipmentStatus === "created" && (
                        <div className="space-y-3 pt-1">
                          <div className="flex items-start gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-900">
                            <Truck size={14} className="shrink-0 mt-0.5" />
                            <div>
                              <p>
                                Shipment is ready. Deliver to the customer and
                                mark the order as fulfilled when done.
                              </p>
                              {order.shipmentReference && (
                                <p className="mt-1 font-mono text-[11px]">
                                  Ref: {order.shipmentReference}
                                </p>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act(franchiseApi.fulfillOrder, order._id)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl disabled:opacity-50">
                            <CheckCircle2 size={14} /> Mark delivered
                          </button>
                        </div>
                      )}
                  </div>
                </SectionCard>
              );
            })}
          </div>
        )}
      </FranchisePageShell>
    </>
  );
};

export default FranchiseOrdersPage;
