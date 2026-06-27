import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  X,
  Store,
  Users,
  Wallet,
  ClipboardList,
} from "lucide-react";
import { Link } from "react-router-dom";

export const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const formatDate = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function formatAddressSnapshot(snapshot) {
  if (!snapshot?.address) return "—";
  return [snapshot.address, snapshot.locality, snapshot.city, snapshot.state, snapshot.pincode]
    .filter(Boolean)
    .join(", ");
}

export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prev = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
    };
  }, [active]);
}

export const PageShell = ({ title, subtitle, actions, children }) => (
  <div className="p-4 sm:p-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {children}
  </div>
);

export const StatCard = ({ label, value, hint, icon: Icon, tone = "slate", to }) => {
  const tones = {
    indigo: "from-indigo-500 to-violet-600",
    emerald: "from-emerald-500 to-teal-600",
    amber: "from-amber-500 to-orange-500",
    slate: "from-slate-600 to-slate-800",
  };
  const inner = (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-500">
            {label}
          </p>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">{value}</p>
          {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
        </div>
        {Icon && (
          <div
            className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tones[tone]} text-white flex items-center justify-center shrink-0`}
          >
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
};

export const StatusPill = ({ status }) => {
  const map = {
    CREATED: { label: "Started", icon: Clock, color: "bg-slate-100 text-slate-700" },
    PENDING: { label: "Pending", icon: Clock, color: "bg-slate-100 text-slate-700" },
    PENDING_REVIEW: { label: "Under Review", icon: Clock, color: "bg-amber-100 text-amber-800" },
    pending_review: { label: "Under Review", icon: Clock, color: "bg-amber-100 text-amber-800" },
    CAPTURED: { label: "Approved", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-800" },
    approved: { label: "Approved", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-800" },
    FAILED: { label: "Rejected", icon: XCircle, color: "bg-rose-100 text-rose-800" },
    rejected: { label: "Rejected", icon: XCircle, color: "bg-rose-100 text-rose-800" },
    CANCELLED: { label: "Cancelled", icon: AlertCircle, color: "bg-slate-100 text-slate-600" },
    active: { label: "Active", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-800" },
    suspended: { label: "Suspended", icon: AlertCircle, color: "bg-amber-100 text-amber-800" },
  };
  const cfg = map[status] || map.PENDING_REVIEW;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cfg.color}`}
    >
      <Icon size={10} /> {cfg.label}
    </span>
  );
};

export const FilterTabs = ({ options, value, onChange }) => (
  <div className="flex flex-wrap gap-1">
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        onClick={() => onChange(opt.value)}
        className={`px-3 py-1.5 text-xs font-bold rounded-lg uppercase tracking-wider ${
          value === opt.value
            ? "bg-indigo-600 text-white"
            : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export const DataTable = ({ columns, children, minWidth = "900px" }) => (
  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
    <div className="overflow-x-auto">
      <table className={`w-full text-sm min-w-[${minWidth}]`} style={{ minWidth }}>
        <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-bold ${col.align === "right" ? "text-right" : "text-left"}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  </div>
);

export const EmptyRow = ({ colSpan, message }) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-12 text-center text-slate-500">
      {message}
    </td>
  </tr>
);

export const InfoBlock = ({ label, children }) => (
  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{label}</p>
    {children}
  </div>
);

export const QuickLinkCard = ({ to, title, description, count, icon: Icon }) => (
  <Link
    to={to}
    className="block bg-white border border-slate-200 rounded-2xl p-4 hover:border-indigo-300 hover:shadow-md transition-all"
  >
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-slate-900">{title}</p>
          {count != null && (
            <span className="text-xs font-black bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">{description}</p>
      </div>
    </div>
  </Link>
);

export const PaymentReviewModal = ({
  open,
  onClose,
  title,
  subtitle,
  fields = [],
  screenshotUrl,
  canAct = true,
  onApprove,
  onReject,
  actionInProgress,
}) => {
  useBodyScrollLock(open);
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((field) => (
              <InfoBlock key={field.label} label={field.label}>
                {field.content}
              </InfoBlock>
            ))}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
              Payment screenshot
            </p>
            {screenshotUrl ? (
              <a
                href={screenshotUrl}
                target="_blank"
                rel="noreferrer"
                className="block bg-slate-50 border border-slate-200 rounded-xl p-3 hover:bg-slate-100"
              >
                <img
                  src={screenshotUrl}
                  alt="Payment proof"
                  className="w-full max-h-96 object-contain rounded-lg"
                />
                <p className="text-xs text-indigo-600 font-semibold mt-2">Open full image</p>
              </a>
            ) : (
              <p className="text-sm text-slate-500 italic">No screenshot submitted.</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Close
          </button>
          {canAct && (
            <>
              <button
                type="button"
                onClick={onReject}
                disabled={actionInProgress}
                className="px-4 py-2 text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={onApprove}
                disabled={actionInProgress}
                className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
              >
                Approve
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const DASHBOARD_ICONS = { Store, Users, Wallet, ClipboardList };
