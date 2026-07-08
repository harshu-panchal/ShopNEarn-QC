import React from "react";

const ReportDateRangePicker = ({ startDate, endDate, onChange }) => {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-semibold text-slate-600">
        Start
        <input
          type="date"
          value={startDate || ""}
          onChange={(e) => onChange({ startDate: e.target.value, endDate })}
          className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        End
        <input
          type="date"
          value={endDate || ""}
          onChange={(e) => onChange({ startDate, endDate: e.target.value })}
          className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
};

export default ReportDateRangePicker;
