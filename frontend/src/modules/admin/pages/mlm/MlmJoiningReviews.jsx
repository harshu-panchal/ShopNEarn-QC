import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Eye,
  X,
  Search,
} from "lucide-react";
import { createPortal } from "react-dom";
import { adminMlmApi } from "../../services/api/mlmApi";
import MemberJoinedSubtitle from "@shared/components/mlm/MemberJoinedSubtitle";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
const formatDate = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * Status filters mirror the four states a manual-QR row can be in:
 *   PENDING_REVIEW — awaiting admin action (default landing tab)
 *   CREATED        — proof not submitted yet (rare; shows abandoned attempts)
 *   CAPTURED       — approved & activated
 *   FAILED         — rejected by admin
 *   "ALL"          — show everything
 */
const STATUS_FILTERS = [
  { value: "PENDING_REVIEW", label: "Pending" },
  { value: "CREATED", label: "Started" },
  { value: "CAPTURED", label: "Approved" },
  { value: "FAILED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

const MlmJoiningReviews = () => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [actionId, setActionId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [adminRemarks, setAdminRemarks] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: 50, status };
      if (search) params.q = search;
      const res = await adminMlmApi.listJoiningReviews(params);
      const data = res.data?.result ?? res.data?.data;
      setItems(data?.items || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search]);

  const openRow = (row) => {
    setSelected(row);
    setAdminRemarks("");
    setRejectReason("");
  };

  const closeRow = () => {
    setSelected(null);
    setAdminRemarks("");
    setRejectReason("");
  };

  const handleApprove = async () => {
    if (!selected) return;
    if (
      !window.confirm(
        `Approve and activate membership for ${selected.customer?.name || selected.customer?.phone || "this customer"}?\n\nAmount: ${formatINR(selected.amount)}\nTransaction ID: ${selected.transactionId || "—"}`,
      )
    ) {
      return;
    }
    setActionId(selected._id);
    try {
      await adminMlmApi.approveJoiningReview(selected._id, {
        adminRemarks: adminRemarks.trim() || undefined,
      });
      toast.success("Approved — membership activated");
      closeRow();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Approve failed");
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      toast.error("Please provide a rejection reason (≥3 characters).");
      return;
    }
    setActionId(selected._id);
    try {
      await adminMlmApi.rejectJoiningReview(selected._id, { reason });
      toast.success("Rejected — customer will be notified");
      closeRow();
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Reject failed");
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            MLM Joining Reviews
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manual UPI-QR payments awaiting admin verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
            }}
            className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden flex-1 sm:flex-initial min-w-0 sm:w-auto">
            <Search size={14} className="ml-2 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, phone, txn id…"
              className="px-2 py-1.5 text-xs bg-transparent focus:outline-none w-full sm:w-56"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                }}
                className="px-2 text-slate-400 hover:text-slate-600 shrink-0">
                <X size={14} />
              </button>
            )}
          </form>

          <div className="flex gap-1 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg uppercase tracking-wider ${
                  status === s.value
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-700"
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 7-col table wrapped in overflow-x-auto for mobile/tablet
          swipe-to-scroll instead of broken column collisions. */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Submitted</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Transaction ID</th>
              <th className="text-left px-4 py-3">Sponsor</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-slate-500">
                  No requests in this status.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row._id}
                  className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-4 py-3 text-xs">
                    <p>{formatDate(row.submittedAt || row.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">
                      {row.customer?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {row.customer?.phone || "—"}
                    </p>
                    <MemberJoinedSubtitle
                      joinedAt={row.customer?.registeredAt}
                      prefix="Registered "
                      className="text-[10px] text-slate-400 mt-0.5"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    {formatINR(row.amount)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {row.transactionId || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {row.sponsorReferralCode || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.status} />
                    {row.adminRemarks && row.status === "FAILED" && (
                      <p className="text-[10px] text-rose-600 mt-1 max-w-xs">
                        {row.adminRemarks}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openRow(row)}
                      className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-slate-700 hover:bg-slate-900 text-white rounded inline-flex items-center gap-1">
                      <Eye size={10} /> Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {selected && (
        <ReviewModal
          row={selected}
          onClose={closeRow}
          adminRemarks={adminRemarks}
          setAdminRemarks={setAdminRemarks}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          onApprove={handleApprove}
          onReject={handleReject}
          actionInProgress={actionId === selected._id}
        />
      )}
    </div>
  );
};

const StatusPill = ({ status }) => {
  const map = {
    CREATED: {
      label: "Started",
      icon: Clock,
      color: "bg-slate-100 text-slate-700",
    },
    PENDING_REVIEW: {
      label: "Under Review",
      icon: Clock,
      color: "bg-amber-100 text-amber-700",
    },
    CAPTURED: {
      label: "Approved",
      icon: CheckCircle2,
      color: "bg-emerald-100 text-emerald-700",
    },
    FAILED: {
      label: "Rejected",
      icon: XCircle,
      color: "bg-rose-100 text-rose-700",
    },
    CANCELLED: {
      label: "Cancelled",
      icon: AlertCircle,
      color: "bg-slate-100 text-slate-600",
    },
  };
  const cfg = map[status] || map.PENDING_REVIEW;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cfg.color}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
};

const ReviewModal = ({
  row,
  onClose,
  adminRemarks,
  setAdminRemarks,
  rejectReason,
  setRejectReason,
  onApprove,
  onReject,
  actionInProgress,
}) => {
  const canApprove =
    row.status === "PENDING_REVIEW" || row.status === "CREATED";
  const canReject =
    row.status === "PENDING_REVIEW" || row.status === "CREATED";

  // Lock BOTH <html> and <body> scroll while the modal is open.
  // The admin DashboardLayout uses min-h-screen on the root with no
  // explicit body overflow rule, so the actual scroller is the
  // <html> element. Locking only `body` (our previous attempt) lets
  // the page keep scrolling when the user reaches the modal's
  // scroll boundary. Locking both elements is the same pattern used
  // by the admin Returns and ProductDetailSheet modals which work
  // correctly under this layout.
  //
  // We use a ref-stable mount/unmount lifecycle (empty deps) so the
  // effect doesn't re-run on every parent re-render — `onClose` is
  // typically not memoized and recreating the lock each render
  // causes a one-frame unlock that lets the background scroll.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };
    const scrollbarWidth = window.innerWidth - body.clientWidth;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.paddingRight = prev.bodyPaddingRight;
    };
  }, []);

  // Esc-to-close lives in its own effect so it can safely depend on
  // `onClose` without disturbing the scroll lock above.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The dim backdrop is now its own absolutely-positioned sibling,
  // so any click on it is unambiguously a close intent — no need
  // to filter by `e.target === e.currentTarget` anymore.
  const handleBackdropClick = () => onClose?.();

  // The structure mirrors the proven admin/Returns modal:
  //   * Outer overlay = `flex items-center justify-center` with NO
  //     background colour and NO scroll. It only positions the
  //     dialog and traps wheel/touch events inside its bounds via
  //     `overflow-hidden overscroll-none`.
  //   * The dim/blur layer is a separate absolutely-positioned
  //     sibling underneath the dialog. Putting it INSIDE the dialog
  //     (or onto the outer element directly) was the previous
  //     mistake — clicks/scroll events on the dim layer got mixed
  //     up with the dialog's own pointer-events handling on some
  //     touchpad drivers.
  //   * The dialog itself is `relative z-10`, fixed-height-capped
  //     via inline style (more reliable across browsers than the
  //     Tailwind `max-h-[90vh]` arbitrary class for elements that
  //     also act as a flex container with a `flex-1 min-h-0`
  //     scroll child).
  //   * The scrollable inner pane gets `touch-pan-y` so touchpad
  //     two-finger gestures and mobile touch drags are explicitly
  //     allowed to drive vertical scroll on this element. Without
  //     it, some Chromium builds on Windows refuse to scroll a
  //     `flex-1 overflow-y-auto` pane via touchpad once the parent
  //     has `overscroll-behavior: none`.
  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden overscroll-none pointer-events-auto"
      role="dialog"
      aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />
      <div
        className="w-full max-w-3xl relative z-10 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "calc(100vh - 2rem)" }}>
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Joining Payment Review
            </h2>
            <p className="text-xs text-slate-500">
              Submitted {formatDate(row.submittedAt || row.createdAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div
          data-lenis-prevent
          className="p-6 space-y-5 overflow-y-auto overscroll-contain flex-1 min-h-0 touch-pan-y"
          style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoBlock label="Customer">
              <p className="font-semibold text-slate-900">
                {row.customer?.name || "Unknown"}
              </p>
              <p className="text-xs text-slate-500">
                {row.customer?.phone || "—"}
              </p>
              <MemberJoinedSubtitle
                joinedAt={row.customer?.registeredAt}
                prefix="Registered "
                className="text-[10px] text-slate-400"
              />
              {row.customer?.email && (
                <p className="text-xs text-slate-500">{row.customer.email}</p>
              )}
            </InfoBlock>

            <InfoBlock label="Amount">
              <p className="text-xl font-black text-slate-900">
                {formatINR(row.amount)}
              </p>
              <p className="text-xs text-slate-500">
                Shopping credit on activation:{" "}
                {formatINR(row.shoppingCredit)}
              </p>
            </InfoBlock>

            <InfoBlock label="Transaction ID">
              <p className="font-mono text-sm text-slate-900">
                {row.transactionId || "—"}
              </p>
              {row.paidAmount != null && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Customer reported paying: {formatINR(row.paidAmount)}
                </p>
              )}
            </InfoBlock>

            <InfoBlock label="Sponsor Referral Code">
              <p className="font-mono text-sm text-slate-900">
                {row.sponsorReferralCode || "—"}
              </p>
            </InfoBlock>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Payment Screenshot
            </p>
            {row.screenshotUrl ? (
              <a
                href={row.screenshotUrl}
                target="_blank"
                rel="noreferrer"
                className="block bg-slate-50 border border-slate-200 rounded-xl p-3 hover:bg-slate-100">
                <img
                  src={row.screenshotUrl}
                  alt="Payment screenshot"
                  className="w-full max-h-[480px] object-contain rounded-md"
                />
                <p className="text-[11px] text-indigo-600 mt-2 text-center">
                  Click to open full size in new tab
                </p>
              </a>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-xl py-12 text-center">
                <p className="text-sm text-slate-500">
                  No screenshot submitted yet.
                </p>
              </div>
            )}
          </div>

          <StatusPill status={row.status} />

          {(row.adminRemarks || row.failureReason) && (
            <InfoBlock label="Existing Admin Note">
              <p className="text-sm text-slate-700">
                {row.adminRemarks || row.failureReason}
              </p>
              {row.reviewedAt && (
                <p className="text-[11px] text-slate-500 mt-1">
                  {formatDate(row.reviewedAt)}
                </p>
              )}
            </InfoBlock>
          )}

          {(canApprove || canReject) && (
            <>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  Admin Note (optional, attached on approve)
                </label>
                <input
                  type="text"
                  value={adminRemarks}
                  onChange={(e) => setAdminRemarks(e.target.value)}
                  placeholder="e.g. Verified against bank statement"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  maxLength={500}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={onApprove}
                  disabled={actionInProgress || !canApprove}
                  className="px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-60">
                  {actionInProgress ? "Working…" : "Approve & Activate"}
                </button>

                <details className="bg-rose-50 rounded-xl border border-rose-200 px-3 py-2">
                  <summary className="text-rose-700 text-sm font-bold cursor-pointer select-none">
                    Reject this payment
                  </summary>
                  <div className="mt-3 space-y-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason (required, ≥3 chars)"
                      className="w-full px-3 py-2 text-sm border border-rose-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                      maxLength={500}
                    />
                    <button
                      onClick={onReject}
                      disabled={
                        actionInProgress ||
                        !canReject ||
                        rejectReason.trim().length < 3
                      }
                      className="w-full px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs disabled:opacity-60">
                      Confirm Rejection
                    </button>
                  </div>
                </details>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
};

const InfoBlock = ({ label, children }) => (
  <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
      {label}
    </p>
    <div className="mt-1">{children}</div>
  </div>
);

export default MlmJoiningReviews;
