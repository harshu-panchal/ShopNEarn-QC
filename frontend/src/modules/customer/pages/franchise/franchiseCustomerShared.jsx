import React from "react";

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

export const FranchisePageShell = ({ title, subtitle, actions, children }) => (
  <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Home Shoppy</p>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions}
    </div>
    {children}
  </div>
);

export const FranchiseStatCard = ({ label, value, hint, tone = "indigo" }) => {
  const tones = {
    indigo: "border-indigo-100 bg-indigo-50/50",
    emerald: "border-emerald-100 bg-emerald-50/50",
    amber: "border-amber-100 bg-amber-50/50",
    slate: "border-slate-200 bg-slate-50",
  };
  return (
    <div className={`border rounded-2xl p-4 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="text-xl sm:text-2xl font-black text-slate-900 mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
};

export const OrderStatusPill = ({ status }) => {
  const map = {
    pending: "bg-amber-100 text-amber-800",
    accepted: "bg-blue-100 text-blue-800",
    fulfilled: "bg-emerald-100 text-emerald-800",
    rejected: "bg-rose-100 text-rose-800",
  };
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${map[status] || map.pending}`}
    >
      {status || "pending"}
    </span>
  );
};

export const PaymentStatusPill = ({ status }) => {
  const normalized = String(status || "").replace(/_/g, " ");
  const map = {
    created: "bg-slate-100 text-slate-700",
    "pending review": "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-rose-100 text-rose-800",
  };
  const key = normalized.toLowerCase();
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${map[key] || map.created}`}
    >
      {normalized || "created"}
    </span>
  );
};

export const SectionCard = ({ title, children, action }) => (
  <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
    {(title || action) && (
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        {title && <h2 className="font-bold text-slate-900">{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const EmptyState = ({ message, action }) => (
  <div className="p-8 text-center">
    <p className="text-sm text-slate-500">{message}</p>
    {action}
  </div>
);

export const ProductThumb = ({ product, size = "md" }) => {
  const img = product?.images?.[0] || product?.image;
  const cls = size === "sm" ? "w-12 h-12" : "w-16 h-16";
  if (!img) {
    return (
      <div className={`${cls} rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 text-xs`}>
        N/A
      </div>
    );
  }
  return <img src={img} alt="" className={`${cls} rounded-xl object-cover border border-slate-200`} />;
};
