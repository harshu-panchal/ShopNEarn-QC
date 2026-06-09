import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Menu, TrendingUp, Wallet, ScrollText } from "lucide-react";
import { useMlmDrawer } from "../MlmLayout";

/**
 * Customer-MLM-rebuild Phase 8 — Payouts section layout.
 *
 * Header + tab bar that wraps three sub-routes:
 *   /mlm/payouts/earnings        → My Earnings (bonus history)
 *   /mlm/payouts/withdrawals     → My Payout (withdraw form + requests)
 *   /mlm/payouts/wallet-history  → Wallet History (unified ledger feed)
 */
const TABS = [
  {
    to: "/mlm/payouts/earnings",
    label: "Earnings",
    icon: <TrendingUp size={16} />,
  },
  {
    to: "/mlm/payouts/withdrawals",
    label: "Payout",
    icon: <Wallet size={16} />,
  },
  {
    to: "/mlm/payouts/wallet-history",
    label: "Wallet",
    icon: <ScrollText size={16} />,
  },
];

const PayoutsLayout = () => {
  const { openDrawer } = useMlmDrawer();
  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-12">
      {/* Sticky chrome — the back-arrow + page-title row is mobile-
          only (`md:hidden`) because the new `MlmLayout` sidebar
          already shows "My Payouts" via the active sidebar item.
          The tab pill row is always visible: on mobile it sits
          directly under the page title, on desktop it sits as the
          first row of the content column. The desktop section
          title is rendered separately below for visual hierarchy. */}
      <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 md:px-8 pt-4 pb-2 border-b border-slate-200/60">
        {/* Mobile-only hamburger + title row. The hamburger opens
            the same sidebar as a slide-in drawer via
            `useMlmDrawer().openDrawer()`. Desktop renders the
            larger section title below this block. */}
        <div className="md:hidden flex items-center gap-2 mb-3">
          <button
            onClick={openDrawer}
            className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
            aria-label="Open navigation"
          >
            <Menu size={22} className="text-slate-800" />
          </button>
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
            My Payouts
          </h1>
        </div>

        <div className="hidden md:flex items-end justify-between gap-4 mb-3 pt-2">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              My Payouts
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Track earnings, request withdrawals, and review wallet activity.
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

      <div className="max-w-3xl md:max-w-7xl mx-auto px-3 sm:px-4 md:px-8 pt-4 md:pt-6">
        <Outlet />
      </div>
    </div>
  );
};

export default PayoutsLayout;
