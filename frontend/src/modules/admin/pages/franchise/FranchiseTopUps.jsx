import React, { useEffect, useState } from "react";
import { Eye } from "lucide-react";
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
} from "./franchiseAdminShared";

const STATUS_FILTERS = [
  { value: "pending_review", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "ALL", label: "All" },
];

const FranchiseTopUps = () => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("pending_review");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [actionId, setActionId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFranchiseApi.listTopUps({ status, limit: 50 });
      setItems(res.data?.result?.items ?? res.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load top-ups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const approve = async (id) => {
    const row = items.find((r) => r._id === id) || selected;
    const credit = row ? row.amount * (row.creditMultiplierSnapshot || 2) : 0;
    if (!window.confirm(`Approve top-up and credit ${formatINR(credit)} to franchise wallet?`)) return;
    setActionId(id);
    try {
      await adminFranchiseApi.approveTopUp(id, {});
      toast.success("Top-up approved — wallet credited");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Approve failed");
    } finally {
      setActionId(null);
    }
  };

  const reject = async (id) => {
    const reason = window.prompt("Rejection reason:");
    if (!reason?.trim()) return;
    setActionId(id);
    try {
      await adminFranchiseApi.rejectTopUp(id, { reason: reason.trim() });
      toast.success("Top-up rejected");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Reject failed");
    } finally {
      setActionId(null);
    }
  };

  const canAct = (row) => row.status === "pending_review";

  return (
    <PageShell
      title="Franchise Wallet Top-ups"
      subtitle="Review partner wallet deposits and credit 2× product value after verification."
      actions={<FilterTabs options={STATUS_FILTERS} value={status} onChange={setStatus} />}
    >
      <DataTable
        columns={[
          { key: "submitted", label: "Submitted" },
          { key: "partner", label: "Partner" },
          { key: "deposit", label: "Deposit", align: "right" },
          { key: "multiplier", label: "Multiplier", align: "right" },
          { key: "credit", label: "Credit amount", align: "right" },
          { key: "txn", label: "Transaction ID" },
          { key: "status", label: "Status" },
          { key: "action", label: "Actions", align: "right" },
        ]}
      >
        {loading ? (
          <EmptyRow colSpan={8} message="Loading top-up requests…" />
        ) : items.length === 0 ? (
          <EmptyRow colSpan={8} message="No top-ups in this status." />
        ) : (
          items.map((row) => {
            const credit = row.amount * (row.creditMultiplierSnapshot || 2);
            return (
              <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                <td className="px-4 py-3 text-xs">{formatDate(row.manualPaymentDetails?.submittedAt || row.updatedAt)}</td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">
                    {row.partnerInfo?.userId?.name || row.partnerInfo?.displayName || "Partner"}
                  </p>
                  <p className="text-xs text-slate-500">{row.partnerInfo?.referralCode || "—"}</p>
                </td>
                <td className="px-4 py-3 text-right font-bold">{formatINR(row.amount)}</td>
                <td className="px-4 py-3 text-right">{row.creditMultiplierSnapshot || 2}×</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatINR(credit)}</td>
                <td className="px-4 py-3 font-mono text-xs max-w-[140px] truncate">
                  {row.manualPaymentDetails?.transactionId || "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={row.status} />
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
                          className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 text-white rounded disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => reject(row._id)}
                          disabled={actionId === row._id}
                          className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-rose-600 text-white rounded disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </DataTable>

      <PaymentReviewModal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Wallet top-up request"
        subtitle={selected ? `Submitted ${formatDate(selected.manualPaymentDetails?.submittedAt || selected.updatedAt)}` : ""}
        screenshotUrl={selected?.manualPaymentDetails?.screenshotUrl}
        canAct={selected ? canAct(selected) : false}
        onApprove={() => approve(selected._id)}
        onReject={() => reject(selected._id)}
        actionInProgress={selected && actionId === selected._id}
        fields={
          selected
            ? [
                {
                  label: "Partner",
                  content: (
                    <>
                      <p className="font-semibold">{selected.partnerInfo?.userId?.name || selected.partnerInfo?.displayName || "Partner"}</p>
                      <p className="text-xs text-slate-500">{selected.partnerInfo?.referralCode}</p>
                    </>
                  ),
                },
                {
                  label: "Deposit amount",
                  content: <p className="text-xl font-black">{formatINR(selected.amount)}</p>,
                },
                {
                  label: "Credit after approval",
                  content: (
                    <p className="text-xl font-black text-emerald-700">
                      {formatINR(selected.amount * (selected.creditMultiplierSnapshot || 2))}
                    </p>
                  ),
                },
                {
                  label: "Transaction ID",
                  content: (
                    <p className="font-mono text-sm break-all">{selected.manualPaymentDetails?.transactionId || "—"}</p>
                  ),
                },
              ]
            : []
        }
      />
    </PageShell>
  );
};

export default FranchiseTopUps;
