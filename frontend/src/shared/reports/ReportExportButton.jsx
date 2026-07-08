import React, { useState } from "react";
import { toast } from "sonner";

const ReportExportButton = ({ onExport, label = "Export CSV" }) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    try {
      setLoading(true);
      await onExport?.();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg disabled:opacity-60"
    >
      {loading ? "Exporting..." : label}
    </button>
  );
};

export default ReportExportButton;
