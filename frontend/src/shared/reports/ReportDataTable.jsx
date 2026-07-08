import React from "react";

const ReportDataTable = ({ columns = [], rows = [], emptyText = "No records found." }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-600">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="text-left px-3 py-2 font-semibold">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, idx) => (
                <tr key={row.id || `${idx}`} className="border-b border-slate-100 last:border-0">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2 text-slate-700">
                      {col.render ? col.render(row, idx) : row[col.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length || 1} className="px-3 py-8 text-center text-slate-500">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReportDataTable;
