import React from "react";

const ReportKpiGrid = ({ items = [] }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-slate-200 bg-white p-4"
        >
          <p className="text-xs uppercase tracking-wide font-semibold text-slate-500">{item.label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{item.value}</p>
          {item.hint ? <p className="text-xs text-slate-500 mt-1">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
};

export default ReportKpiGrid;
