import React, { useEffect, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, Hourglass, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * Customer-MLM-rebuild Phase 8 — Matching Report page.
 *
 * Paginated list of binary pair-match events. Each row surfaces:
 *   - Pair index
 *   - Left + right contributor (name only; phone is masked server-side)
 *   - Bonus amount
 *   - Status: HELD vs CREDITED vs CAPPED
 *   - Created / released timestamps
 */
const MatchingReportPage = () => {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const limit = 20;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const res = await mlmApi.getMatchingReport({ page, limit });
        if (!mounted) return;
        setData(res.data?.result ?? res.data?.data ?? res.data);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Failed to load");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [page]);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Pair Match History
          </h3>
          <span className="text-[11px] text-slate-500">
            {data?.total ?? 0} total
          </span>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500">
              No pair matches yet — complete your first L+R pair to start
              earning.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={String(item._id)} className="px-4 py-3.5">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
                      Pair #{item.pairIndex || "?"}
                    </span>
                    {item.isHeld ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded flex items-center gap-1">
                        <Hourglass size={10} /> Held
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded flex items-center gap-1">
                        <CheckCircle2 size={10} /> Credited
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-black text-slate-900 ml-auto">
                    {formatINR(item.bonusAmount)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ContributorChip
                    label="Left"
                    icon={<ArrowLeft size={12} />}
                    accent="indigo"
                    contributor={item.left}
                  />
                  <ContributorChip
                    label="Right"
                    icon={<ArrowRight size={12} />}
                    accent="emerald"
                    contributor={item.right}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-2">
                  {formatDate(item.createdAt)}
                  {item.releasedAt && (
                    <> · Released {formatDate(item.releasedAt)}</>
                  )}
                  {item.isHeld && (
                    <> · Awaiting downline activation</>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={(p) => setPage(p)}
      />
    </div>
  );
};

const ContributorChip = ({ label, icon, accent, contributor }) => {
  const accents = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return (
    <div
      className={`flex items-center gap-1.5 border rounded-lg px-2 py-1.5 ${accents[accent]}`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">
        {label}
      </span>
      <span className="text-xs font-bold truncate flex-1 text-slate-900">
        {contributor?.name || "—"}
      </span>
    </div>
  );
};

const Pagination = ({ page, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-3 py-2">
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="text-xs font-bold text-slate-600 disabled:opacity-40 flex items-center gap-1"
      >
        <ChevronLeft size={14} /> Prev
      </button>
      <span className="text-xs text-slate-500">
        Page {page} of {totalPages}
      </span>
      <button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="text-xs font-bold text-slate-600 disabled:opacity-40 flex items-center gap-1"
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
};

export default MatchingReportPage;
