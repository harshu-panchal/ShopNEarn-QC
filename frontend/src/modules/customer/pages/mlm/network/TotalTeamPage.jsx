import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import mlmApi from "../../../services/mlmApi";
import { useMlmDrawer } from "../MlmLayout";
import TeamMemberSearch from "../../../../../shared/components/mlm/TeamMemberSearch";

const formatStatementDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const TotalTeamPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [legFilter, setLegFilter] = useState("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const limit = 50;

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await mlmApi.getTotalTeam({
          page,
          limit,
          leg: legFilter !== "ALL" ? legFilter : undefined,
          search: search || undefined,
        });
        if (!mounted) return;
        setData(res.data?.result ?? res.data?.data ?? res.data);
      } catch (err) {
        toast.error(err?.response?.data?.message || "Failed to load total team");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [page, legFilter, search]);

  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;
  const total = data?.total || 0;
  const slOffset = (page - 1) * limit;

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
      <Header />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-4 w-full space-y-4">
        {loading && !data ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : !data?.isMember ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <Sparkles className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">
              Your team statement will appear once you become a member.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block pt-2 pb-2 border-b border-slate-200/80">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Total Team
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Full binary team list with sponsor and placement details.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <SummaryCard
                label="Left Team"
                total={data.leftLegCount ?? 0}
                active={data.leftLegActiveCount ?? 0}
                subtitle="team active"
                icon={<ArrowLeft size={18} />}
                onClick={() => {
                  setLegFilter((prev) => (prev === "L" ? "ALL" : "L"));
                  setPage(1);
                }}
                selected={legFilter === "L"}
              />
              <SummaryCard
                label="Pairs Paid"
                total={data.pairsCompleted || 0}
                icon={<Sparkles size={18} />}
                accent
                spanFullOnMobile
              />
              <SummaryCard
                label="Right Team"
                total={data.rightLegCount ?? 0}
                active={data.rightLegActiveCount ?? 0}
                subtitle="team active"
                icon={<ArrowRight size={18} />}
                onClick={() => {
                  setLegFilter((prev) => (prev === "R" ? "ALL" : "R"));
                  setPage(1);
                }}
                selected={legFilter === "R"}
              />
            </div>

            <TeamMemberSearch
              value={searchInput}
              onChange={setSearchInput}
              className="max-w-md"
            />

            <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white">
              <div className="bg-gradient-to-r from-violet-700 to-indigo-800 px-4 py-3">
                <h2 className="text-sm md:text-base font-bold text-white tracking-wide">
                  Total Team List Statement
                </h2>
                <p className="text-[11px] text-violet-100 mt-0.5">
                  {total.toLocaleString("en-IN")} member
                  {total === 1 ? "" : "s"}
                  {legFilter !== "ALL"
                    ? ` · ${legFilter === "L" ? "Left" : "Right"} leg`
                    : ""}
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="bg-slate-800 text-white text-[11px] uppercase tracking-wider">
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Sl. No</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">User ID</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Name</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Sponsor ID</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Sponsor Name</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Placement</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Position</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" />
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                          No team members found.
                        </td>
                      </tr>
                    ) : (
                      items.map((row, idx) => (
                        <tr
                          key={String(row.userId)}
                          className="hover:bg-slate-50/80 transition-colors even:bg-slate-50/40"
                        >
                          <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">
                            {slOffset + idx + 1}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-800">
                            {row.publicUserId || row.referralCode || "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <Link
                              to={`/mlm/network/member/${row.userId}`}
                              className="font-semibold text-indigo-700 hover:underline"
                            >
                              {row.name || "Member"}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-700">
                            {row.sponsorPublicUserId || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-slate-800">
                            {row.sponsorName || "—"}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-700">
                            {row.placementPublicUserId || "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                row.position === "Left"
                                  ? "bg-indigo-100 text-indigo-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {row.position || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700 text-xs whitespace-nowrap">
                            {formatStatementDate(row.joinedAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm bg-white border border-slate-200 text-slate-700 disabled:opacity-50"
                >
                  <ArrowLeft size={16} /> Prev
                </button>
                <span className="text-sm font-semibold text-slate-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm bg-white border border-slate-200 text-slate-700 disabled:opacity-50"
                >
                  Next <ArrowRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const SummaryCard = ({
  label,
  total,
  active,
  subtitle,
  icon,
  accent = false,
  spanFullOnMobile,
  onClick,
  selected,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-2xl border p-4 text-center w-full transition-all ${
      accent
        ? "bg-indigo-50 border-indigo-200"
        : selected
          ? "bg-indigo-50 border-indigo-400 ring-1 ring-indigo-400"
          : "bg-white border-slate-200 hover:border-indigo-300"
    } ${spanFullOnMobile ? "col-span-2 md:col-span-1" : ""}`}
  >
    {icon && (
      <div
        className={`flex justify-center mb-1 ${
          accent ? "text-indigo-700" : "text-slate-600"
        }`}
      >
        {icon}
      </div>
    )}
    <p
      className={`text-2xl font-black ${
        accent ? "text-indigo-700" : "text-slate-900"
      }`}
    >
      {total}
      {active !== undefined && (
        <span className="opacity-70 text-lg"> ({active})</span>
      )}
    </p>
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">
      {label}
    </p>
    {subtitle && (
      <p className="text-[9px] text-slate-400 mt-0.5">{subtitle}</p>
    )}
  </button>
);

function Header() {
  const navigate = useNavigate();
  const { openDrawer } = useMlmDrawer();
  return (
    <div className="md:hidden sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-2 border-b border-slate-200/60 flex items-center gap-3">
      <button
        onClick={openDrawer}
        className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-2"
        aria-label="Open navigation"
      >
        <Menu size={22} className="text-slate-800" />
      </button>
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
        Total Team
      </h1>
      <button
        onClick={() => navigate(-1)}
        className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors"
        aria-label="Go back"
      >
        <ArrowLeft size={20} className="text-slate-700" />
      </button>
    </div>
  );
}

export default TotalTeamPage;
