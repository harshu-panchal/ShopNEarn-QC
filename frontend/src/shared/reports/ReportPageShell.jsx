import React from "react";

const ReportPageShell = ({
  title,
  subtitle,
  actions,
  filters,
  children,
}) => {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle ? <p className="text-sm text-slate-500 mt-1">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {filters ? <div className="bg-white border border-slate-200 rounded-2xl p-3">{filters}</div> : null}
      {children}
    </div>
  );
};

export default ReportPageShell;
