import React from "react";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";
import { getOrderItemImage } from "@/shared/utils/orderStatus";

export const FALLBACK_PRODUCT_IMAGE =
  "https://images.unsplash.com/photo-1550989460-0adf9ea622e2?auto=format&fit=crop&q=80&w=400&h=400";

/** Resolve thumbnail URL from catalog product or order line item. */
export function resolveProductImage(source) {
  if (!source) return null;
  const fromLine = getOrderItemImage(source);
  if (fromLine) return fromLine;
  const candidates = [
    source.mainImage,
    source.image,
    source.images?.[0],
    source.galleryImages?.[0],
  ];
  for (const candidate of candidates) {
    const url = String(candidate || "").trim();
    if (url) return url;
  }
  return null;
}

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

export const ProductThumb = ({ product, size = "md", alt = "" }) => {
  const cls = size === "sm" ? "w-12 h-12" : "w-16 h-16";
  const resolved = resolveProductImage(product) || FALLBACK_PRODUCT_IMAGE;
  const src = applyCloudinaryTransform(resolved, "f_auto,q_auto,w_200,h_200,c_fill");

  return (
    <img
      src={src}
      alt={alt || product?.name || "Product"}
      loading="lazy"
      className={`${cls} rounded-xl object-cover border border-slate-200 bg-slate-50 shrink-0`}
      onError={(event) => {
        if (event.currentTarget.src !== FALLBACK_PRODUCT_IMAGE) {
          event.currentTarget.src = FALLBACK_PRODUCT_IMAGE;
        }
      }}
    />
  );
};

export const OrderLineThumb = ({ line, size = "sm" }) => (
  <ProductThumb product={line} size={size} alt={line?.name || "Order item"} />
);
