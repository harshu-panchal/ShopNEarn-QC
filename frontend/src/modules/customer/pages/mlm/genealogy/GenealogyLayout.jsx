import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ChevronLeft, Network, GitBranch, FileBarChart2, UserSquare2 } from "lucide-react";

/**
 * Customer-MLM-rebuild Phase 8 — Genealogy section layout.
 *
 * Renders a sticky page header and a horizontal tab bar with four
 * destinations:
 *   /mlm/genealogy/tree            → Tree View (pan/zoom/drag canvas)
 *   /mlm/genealogy/binary          → Binary Genealogy (flat per-leg lists)
 *   /mlm/genealogy/matching-report → Matching Report
 *   /mlm/genealogy/direct-sponsor  → Direct Sponsor card
 *
 * Each tab is a `NavLink` so the active styling is driven entirely by
 * URL state — no local tab state needed.
 */
const TABS = [
  { to: "/mlm/genealogy/tree", label: "Tree View", icon: <Network size={16} /> },
  { to: "/mlm/genealogy/binary", label: "Binary", icon: <GitBranch size={16} /> },
  {
    to: "/mlm/genealogy/matching-report",
    label: "Matching",
    icon: <FileBarChart2 size={16} />,
  },
  {
    to: "/mlm/genealogy/direct-sponsor",
    label: "Sponsor",
    icon: <UserSquare2 size={16} />,
  },
];

const GenealogyLayout = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-2 border-b border-slate-200/60">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => navigate("/mlm")}
            className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
            aria-label="Back to dashboard"
          >
            <ChevronLeft size={22} className="text-slate-800" />
          </button>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
            Genealogy
          </h1>
        </div>

        <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 no-scrollbar">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-indigo-600 text-white shadow"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                }`
              }
            >
              {tab.icon}
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Tree canvas, leg lists, and report tables can be wide;
          allow the layout to grow up to 6xl on desktop while
          keeping comfortable mobile padding. */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 pt-4">
        <Outlet />
      </div>
    </div>
  );
};

export default GenealogyLayout;
