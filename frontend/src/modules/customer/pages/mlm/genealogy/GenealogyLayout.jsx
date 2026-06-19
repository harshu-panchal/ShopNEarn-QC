import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Menu, Network, GitBranch, FileBarChart2, UserSquare2 } from "lucide-react";
import { useMlmDrawer } from "../MlmLayout";

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
  { to: "/mlm/network/genealogy/tree", label: "Tree View", icon: <Network size={16} /> },
  { to: "/mlm/network/genealogy/binary", label: "Binary", icon: <GitBranch size={16} /> },
  {
    to: "/mlm/network/genealogy/matching-report",
    label: "Matching",
    icon: <FileBarChart2 size={16} />,
  },
  {
    to: "/mlm/network/genealogy/direct-sponsor",
    label: "Sponsor",
    icon: <UserSquare2 size={16} />,
  },
];

const GenealogyLayout = () => {
  const { openDrawer } = useMlmDrawer();
  return (
    // EXACT viewport height, never more. `CustomerLayout` detects the
    // `/mlm/genealogy` prefix and skips its default `pb-16` gutter
    // + desktop `<Footer />` so this layout owns the whole screen.
    //
    // The internal `pb-[80px] md:pb-0` reserves clearance for the
    // mobile `BottomNav` (which is `position:fixed h-[70px]` + safe
    // area) — without it the bottom of the tree canvas would be
    // hidden under the nav on mobile. On desktop the nav is
    // `md:hidden`, so no reservation is needed.
    //
    // `overflow-hidden` guarantees no internal element can push the
    // body into a scroll state — every scrollable region (canvas
    // pan, list-page scroll) lives strictly inside the
    // `flex-1 min-h-0` outlet below.
    <div className="h-dvh bg-slate-50 flex flex-col overflow-hidden pb-[80px] md:pb-0">
      <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 md:px-8 pt-4 pb-2 border-b border-slate-200/60 shrink-0">
        {/* Mobile-only hamburger + title row. On desktop the
            `MlmLayout` sidebar already shows "Genealogy" as the
            active item, and the tab pills below this block carry
            the section label via the active tab — so we suppress
            the duplicate chrome on `md:+`. The hamburger opens the
            same sidebar as a slide-in drawer. */}
        <div className="md:hidden flex items-center gap-2 mb-3">
          <button
            onClick={openDrawer}
            className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
            aria-label="Open navigation"
          >
            <Menu size={22} className="text-slate-800" />
          </button>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
            Genealogy
          </h1>
        </div>

        <div className="hidden md:flex items-end justify-between gap-4 mb-3 pt-2">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Genealogy
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Visualise your binary tree, audit pairs, and review your sponsor chain.
            </p>
          </div>
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

      <div className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </div>
    </div>
  );
};

export default GenealogyLayout;
