import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Wallet,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatDate = (d) =>
  new Date(d).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const statusBadge = {
  pending: {
    label: "Pending",
    icon: Clock,
    color: "bg-amber-50 text-amber-700 border-amber-200",
  },
  approved: {
    label: "Approved",
    icon: CheckCircle2,
    color: "bg-blue-50 text-blue-700 border-blue-200",
  },
  paid: {
    label: "Paid",
    icon: CheckCircle2,
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    color: "bg-rose-50 text-rose-700 border-rose-200",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    color: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

/**
 * Customer-MLM-rebuild Phase 8 — My Payout (under Payouts layout).
 *
 * Same logic as the legacy `MlmWithdrawalPage` but rendered without
 * its own page header (the parent `PayoutsLayout` provides it).
 */
const MyPayoutPage = () => {
  const [membership, setMembership] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    amount: "",
    method: "upi",
    upiId: "",
    accountHolderName: "",
    accountNumber: "",
    ifsc: "",
    panNumber: "",
  });
  const [preview, setPreview] = useState(null);

  const loadData = async () => {
    try {
      const [m, w] = await Promise.all([
        mlmApi.getMembership(),
        mlmApi.listWithdrawals({ limit: 25 }),
      ]);
      setMembership(m.data?.result ?? m.data?.data);
      setRequests((w.data?.result ?? w.data?.data)?.items || []);
    } catch (err) {
      toast.error(
        err?.response?.data?.message || "Failed to load withdrawals",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const amount = Number(form.amount);
    if (!amount || !membership?.config) {
      setPreview(null);
      return;
    }
    const adminPct = membership.config.withdrawalAdminChargePercent || 0;
    const gstPct = membership.config.withdrawalGstOnAdminChargePercent || 0;
    const adminCharge = Math.round(((amount * adminPct) / 100) * 100) / 100;
    const gst = Math.round(((adminCharge * gstPct) / 100) * 100) / 100;
    setPreview({
      amount,
      adminCharge,
      gst,
      net: Math.round((amount - adminCharge - gst) * 100) / 100,
    });
  }, [form.amount, membership]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    const minAmt = membership?.config?.withdrawalMinAmount || 0;
    if (!amount || amount < minAmt) {
      toast.error(`Minimum withdrawal: ${formatINR(minAmt)}`);
      return;
    }
    if ((membership?.wallet?.earningsBalance || 0) < amount) {
      toast.error("Insufficient earnings balance");
      return;
    }
    const beneficiary = { method: form.method };
    if (form.method === "upi") {
      if (!form.upiId.trim()) {
        toast.error("UPI ID is required");
        return;
      }
      beneficiary.upiId = form.upiId.trim();
    } else {
      if (!form.accountHolderName.trim()) {
        toast.error("Account holder name is required");
        return;
      }
      if (!form.accountNumber.trim()) {
        toast.error("Account number is required");
        return;
      }
      if (!form.ifsc.trim()) {
        toast.error("IFSC is required");
        return;
      }
      beneficiary.accountHolderName = form.accountHolderName.trim();
      beneficiary.accountNumber = form.accountNumber.trim();
      beneficiary.ifsc = form.ifsc.trim().toUpperCase();
    }
    if (form.panNumber)
      beneficiary.panNumber = form.panNumber.trim().toUpperCase();

    setSubmitting(true);
    try {
      await mlmApi.requestWithdrawal({ amount, beneficiary });
      toast.success("Withdrawal request submitted");
      setForm({ ...form, amount: "" });
      await loadData();
    } catch (err) {
      toast.error(
        err?.response?.data?.message || "Failed to submit request",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm("Cancel this withdrawal request?")) return;
    try {
      await mlmApi.cancelWithdrawal(id);
      toast.success("Cancelled");
      await loadData();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to cancel");
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!membership?.isMember) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
        Become a member to start earning and withdrawing.
      </div>
    );
  }

  const earnings = membership.wallet?.earningsBalance || 0;
  const minAmt = membership.config?.withdrawalMinAmount || 0;
  const canWithdraw = earnings >= minAmt;

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-2xl p-5">
        <p className="text-xs font-bold uppercase tracking-widest opacity-80">
          Withdrawable Earnings
        </p>
        <h2 className="text-2xl sm:text-3xl font-black mt-1 break-all">
          {formatINR(earnings)}
        </h2>
        <p className="text-xs opacity-80 mt-2">
          Min withdrawal {formatINR(minAmt)} · Fees:{" "}
          {membership.config?.withdrawalAdminChargePercent}% admin +{" "}
          {membership.config?.withdrawalGstOnAdminChargePercent}% GST
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4"
      >
        <h3 className="text-base font-bold text-slate-900">New Withdrawal</h3>

        <Field label="Amount (₹)">
          <input
            type="number"
            step="0.01"
            min={minAmt}
            max={earnings}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base font-bold text-slate-900 outline-none focus:border-indigo-500"
            placeholder="0"
            disabled={!canWithdraw}
          />
        </Field>

        {preview && (
          <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span>Requested</span>
              <span className="font-bold">{formatINR(preview.amount)}</span>
            </div>
            <div className="flex justify-between text-rose-600">
              <span>Admin charge</span>
              <span className="font-bold">
                -{formatINR(preview.adminCharge)}
              </span>
            </div>
            <div className="flex justify-between text-rose-600">
              <span>GST on charge</span>
              <span className="font-bold">-{formatINR(preview.gst)}</span>
            </div>
            <div className="flex justify-between text-emerald-700 border-t border-slate-200 pt-1.5 mt-1">
              <span className="font-bold">You receive</span>
              <span className="font-black">{formatINR(preview.net)}</span>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-2">
            Method
          </p>
          <div className="grid grid-cols-2 gap-2">
            {["upi", "bank"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm({ ...form, method: m })}
                className={`py-2 rounded-xl text-sm font-bold uppercase tracking-wider transition-colors ${
                  form.method === m
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {form.method === "upi" ? (
          <Field label="UPI ID">
            <input
              type="text"
              value={form.upiId}
              onChange={(e) => setForm({ ...form, upiId: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500"
              placeholder="yourname@upi"
            />
          </Field>
        ) : (
          <>
            <Field label="Account Holder Name">
              <input
                type="text"
                value={form.accountHolderName}
                onChange={(e) =>
                  setForm({ ...form, accountHolderName: e.target.value })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500"
              />
            </Field>
            <Field label="Account Number">
              <input
                type="text"
                value={form.accountNumber}
                onChange={(e) =>
                  setForm({
                    ...form,
                    accountNumber: e.target.value.replace(/\D/g, ""),
                  })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500"
              />
            </Field>
            <Field label="IFSC">
              <input
                type="text"
                value={form.ifsc}
                onChange={(e) =>
                  setForm({ ...form, ifsc: e.target.value.toUpperCase() })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 uppercase"
                maxLength={11}
              />
            </Field>
          </>
        )}

        <Field label="PAN Number (optional)">
          <input
            type="text"
            value={form.panNumber}
            onChange={(e) =>
              setForm({ ...form, panNumber: e.target.value.toUpperCase() })
            }
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 uppercase"
            maxLength={10}
          />
        </Field>

        {!canWithdraw && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              You need at least {formatINR(minAmt)} in earnings to withdraw.
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canWithdraw || submitting}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-3.5 rounded-xl text-sm transition-colors"
        >
          {submitting ? "Submitting..." : "Submit Request"}
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">
            Recent Requests
          </h3>
        </div>
        {requests.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No withdrawals yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => {
              const badge = statusBadge[r.status] || statusBadge.pending;
              const Icon = badge.icon;
              return (
                <li key={r._id} className="px-4 sm:px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                        <Wallet size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900">
                          {formatINR(r.amount)}
                        </p>
                        <p className="text-[11px] text-slate-500 break-words">
                          Net: {formatINR(r.netPayoutAmount)} ·{" "}
                          {formatDate(r.createdAt)}
                        </p>
                        {r.payoutReference && (
                          <p className="text-[10px] text-emerald-700 mt-0.5 break-all">
                            Ref: {r.payoutReference}
                          </p>
                        )}
                        {r.rejectionReason && (
                          <p className="text-[10px] text-rose-600 mt-0.5 break-words">
                            {r.rejectionReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${badge.color}`}
                      >
                        <Icon size={11} /> {badge.label}
                      </span>
                      {r.status === "pending" && (
                        <button
                          onClick={() => handleCancel(r._id)}
                          className="text-[11px] text-rose-600 font-semibold"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-1.5 block">
      {label}
    </span>
    {children}
  </label>
);

export default MyPayoutPage;
