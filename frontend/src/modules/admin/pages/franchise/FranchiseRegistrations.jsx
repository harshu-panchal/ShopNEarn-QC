import React, { useEffect, useState } from "react";
import { Eye, Search, X } from "lucide-react";
import { toast } from "sonner";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import {
  PageShell,
  FilterTabs,
  DataTable,
  EmptyRow,
  StatusPill,
  PaymentReviewModal,
  formatINR,
  formatDate,
  formatAddressSnapshot,
} from "./franchiseAdminShared";

const STATUS_FILTERS = [
  { value: "PENDING_REVIEW", label: "Pending" },
  { value: "CREATED", label: "Started" },
  { value: "CAPTURED", label: "Approved" },
  { value: "FAILED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

const FranchiseRegistrations = () => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState(null);
  const [actionId, setActionId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: 50, status };
      if (search) params.q = search;
      const res = await adminFranchiseApi.listRegistrations(params);
      setItems(res.data?.result?.items ?? res.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load registrations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search]);

  const approve = async (id) => {
    if (!window.confirm("Approve this registration and activate the franchise partner?")) return;
    setActionId(id);
    try {
      await adminFranchiseApi.approveRegistration(id, {});
      toast.success("Registration approved — partner activated");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Approve failed");
    } finally {
      setActionId(null);
    }
  };

  const reject = async (id) => {
    const reason = window.prompt("Rejection reason (required):");
    if (!reason?.trim()) return;
    setActionId(id);
    try {
      await adminFranchiseApi.rejectRegistration(id, { reason: reason.trim() });
      toast.success("Registration rejected");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Reject failed");
    } finally {
      setActionId(null);
    }
  };

  const canAct = (row) => row.status === "PENDING_REVIEW" || row.status === "CREATED";

  return (
    <PageShell
      title="Franchise Registration Reviews"
      subtitle="Verify ₹10,000 manual UPI payments, franchise address, and payment proof before activation."
      actions={
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
            }}
            className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <Search size={14} className="ml-2 text-slate-400 shrink-0" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone, txn id…"
              className="px-2 py-2 text-xs bg-transparent focus:outline-none w-44 sm:w-56"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                }}
                className="px-2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </form>
          <FilterTabs options={STATUS_FILTERS} value={status} onChange={setStatus} />
        </>
      }
    >
      <DataTable
        columns={[
          { key: "submitted", label: "Submitted" },
          { key: "customer", label: "Customer" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "txn", label: "Transaction ID" },
          { key: "address", label: "Franchise address" },
          { key: "status", label: "Status" },
          { key: "action", label: "Actions", align: "right" },
        ]}
      >
        {loading ? (
          <EmptyRow colSpan={7} message="Loading registration requests…" />
        ) : items.length === 0 ? (
          <EmptyRow colSpan={7} message="No requests in this status." />
        ) : (
          items.map((row) => (
            <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
              <td className="px-4 py-3 text-xs whitespace-nowrap">
                {formatDate(row.manualPaymentDetails?.submittedAt || row.createdAt)}
              </td>
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-900">{row.customerInfo?.name || "Customer"}</p>
                <p className="text-xs text-slate-500">{row.customerInfo?.phone || "—"}</p>
                {row.customerInfo?.email && (
                  <p className="text-[10px] text-slate-400">{row.customerInfo.email}</p>
                )}
              </td>
              <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                {formatINR(row.registrationPriceSnapshot)}
              </td>
              <td className="px-4 py-3 font-mono text-xs max-w-[140px] truncate">
                {row.manualPaymentDetails?.transactionId || "—"}
              </td>
              <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                {formatAddressSnapshot(row.addressSnapshot)}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={row.status} />
                {row.adminRemarks && row.status === "FAILED" && (
                  <p className="text-[10px] text-rose-600 mt-1 max-w-xs">{row.adminRemarks}</p>
                )}
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
                  {canAct(row) && (
                    <>
                      <button
                        type="button"
                        onClick={() => approve(row._id)}
                        disabled={actionId === row._id}
                        className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => reject(row._id)}
                        disabled={actionId === row._id}
                        className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white rounded disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))
        )}
      </DataTable>

      <PaymentReviewModal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Registration request"
        subtitle={
          selected
            ? `Submitted ${formatDate(selected.manualPaymentDetails?.submittedAt || selected.createdAt)}`
            : ""
        }
        screenshotUrl={selected?.manualPaymentDetails?.screenshotUrl}
        canAct={selected ? canAct(selected) : false}
        onApprove={() => approve(selected._id)}
        onReject={() => reject(selected._id)}
        actionInProgress={selected && actionId === selected._id}
        fields={
          selected
            ? [
                {
                  label: "Customer",
                  content: (
                    <>
                      <p className="font-semibold text-slate-900">{selected.customerInfo?.name || "Customer"}</p>
                      <p className="text-xs text-slate-500">{selected.customerInfo?.phone || "—"}</p>
                    </>
                  ),
                },
                {
                  label: "Amount",
                  content: (
                    <p className="text-xl font-black text-slate-900">
                      {formatINR(selected.registrationPriceSnapshot)}
                    </p>
                  ),
                },
                {
                  label: "Transaction ID",
                  content: (
                    <p className="font-mono text-sm break-all">
                      {selected.manualPaymentDetails?.transactionId || "—"}
                    </p>
                  ),
                },
                {
                  label: "Status",
                  content: <StatusPill status={selected.status} />,
                },
                {
                  label: "Franchise address",
                  content: (
                    <p className="text-sm text-slate-700">{formatAddressSnapshot(selected.addressSnapshot)}</p>
                  ),
                },
                {
                  label: "Payment ID",
                  content: <p className="font-mono text-xs text-slate-600 break-all">{selected._id}</p>,
                },
              ]
            : []
        }
      />
    </PageShell>
  );
};

export default FranchiseRegistrations;
