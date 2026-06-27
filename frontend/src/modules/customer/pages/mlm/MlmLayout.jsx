import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  Gift,
  History,
  Home,
  LayoutDashboard,
  LogOut,
  Network,
  ShoppingBag,
  Users,
  User,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@core/context/AuthContext";
import { useSettings } from "@core/context/SettingsContext";
// Default fallback so the sidebar still shows a brand mark before
// the SettingsContext has resolved the admin-configured logo (or
// when that field is empty in the database).
import DefaultLogo from "@/assets/Logo.png";

/**
 * MlmLayout — sidebar chrome for the `/mlm/*` URL tree.
 *
 * Desktop (md:+):
 *   - Fixed left sidebar (256 px wide) is always visible, content
 *     column gets `md:pl-64` to reserve its footprint.
 *
 * Mobile (< md):
 *   - The same sidebar markup is now rendered as a slide-in DRAWER
 *     instead of being hidden completely. Per-page mobile headers
 *     trigger the open via the `useMlmDrawer().openDrawer()` hook
 *     exposed through `MlmDrawerContext`. The drawer auto-closes
 *     when the URL changes (so tapping a nav item closes the panel
 *     before the new page mounts) and when the user taps the
 *     backdrop or presses Escape.
 *
 * Why a context instead of lifting the trigger into MlmLayout:
 *   - Each MLM page still owns its own sticky title bar (the title
 *     copy differs per page and historically lived inside the page
 *     component). Giving them a `useMlmDrawer().openDrawer()` hook
 *     lets them keep their existing chrome but swap the back-arrow
 *     for a hamburger without lifting all five headers into one
 *     central component.
 *
 * Visual language:
 *   - Light sidebar (white card + slate border) so the existing
 *     customer aesthetic — slate-50 page, indigo-violet accents,
 *     white cards — stays cohesive.
 *   - Active item: indigo-tinted background + left accent bar +
 *     matching icon tint. Matches the existing pill-tabs in
 *     `GenealogyLayout` / `PayoutsLayout` so the two chromes feel
 *     like one design system.
 *
 * Sub-route tab bars (`GenealogyLayout`, `PayoutsLayout`) are
 * intentionally left in place — the sidebar takes the user to a
 * section, the in-page tab bar lets them switch within it.
 */

const SIDEBAR_NAV_ITEMS = [
  {
    label: "Dashboard",
    path: "/mlm",
    icon: LayoutDashboard,
    // `end` so `/mlm` doesn't claim "active" while the user is on
    // `/mlm/genealogy` (NavLink default-matches any child path).
    end: true,
  },
  {
    label: "Network",
    path: "/mlm/network",
    icon: Network,
    children: [
      { label: "Direct Referrals", path: "/mlm/network/referrals" },
      { label: "Left Team", path: "/mlm/network/left-team" },
      { label: "Right Team", path: "/mlm/network/right-team" },
      { label: "Genealogy", path: "/mlm/network/genealogy" },
      { label: "Level Team", path: "/mlm/network/level-team" },
    ],
  },
  {
    label: "My Earnings",
    path: "/mlm/payouts/earnings",
    icon: Wallet,
  },
  {
    label: "Withdrawals",
    path: "/mlm/payouts/withdrawals",
    icon: Gift,
  },
  {
    label: "Wallet History",
    path: "/mlm/payouts/wallet-history",
    icon: History,
  },
  {
    label: "Home Shoppy",
    path: "/mlm/franchise",
    icon: ShoppingBag,
  },
  {
    label: "Profile",
    path: "/mlm/profile",
    icon: User,
  },
  // Storefront escape hatch — keeps the customer one click away
  // from the products they came to shop, regardless of how deep
  // they drilled into the MLM tree. Lives at the bottom of the
  // primary nav (separated by a divider in the render layer) so it
  // visually reads as "leave this section" rather than another
  // MLM page.
  {
    label: "Back to Shop",
    path: "/",
    icon: Home,
    end: true,
    isExitLink: true,
  },
];

/* =================================================================
   Drawer context — page-local headers call `openDrawer()` to
   trigger the mobile slide-in panel. `closeDrawer` is exposed too
   so escape hatches inside the drawer can dismiss it.
   ================================================================ */
const MlmDrawerContext = createContext({
  openDrawer: () => {},
  closeDrawer: () => {},
  isOpen: false,
});

export const useMlmDrawer = () => useContext(MlmDrawerContext);

/**
 * Single nav item used in both the desktop sidebar and the mobile
 * drawer. The `isActive` matcher mirrors react-router's behaviour
 * but with our own `end` semantic so `/mlm` doesn't claim "active"
 * for every `/mlm/*` URL.
 */
function NavItem({ item, currentPathname, onNavigate }) {
  const Icon = item.icon;
  const isActive = item.end
    ? currentPathname === item.path
    : currentPathname === item.path ||
      currentPathname.startsWith(`${item.path}/`);

  const hasChildren = Boolean(item.children && item.children.length > 0);
  const [isOpen, setIsOpen] = useState(isActive);

  // Keep accordion open if the route becomes active externally
  useEffect(() => {
    if (isActive && hasChildren) {
      setIsOpen(true);
    }
  }, [isActive, hasChildren]);

  if (hasChildren) {
    return (
      <div className="space-y-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={[
            "w-full group relative flex items-center gap-3 rounded-xl pl-3 pr-2 py-2.5 text-sm font-semibold transition-colors",
            isActive
              ? "bg-indigo-50 text-indigo-700"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          ].join(" ")}
        >
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute -left-px top-2 bottom-2 w-1 rounded-full bg-indigo-600"
            />
          )}
          <span
            className={[
              "shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
              isActive
                ? "bg-indigo-100 text-indigo-700"
                : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700",
            ].join(" ")}
          >
            <Icon size={16} />
          </span>
          <span className="flex-1 truncate text-left">{item.label}</span>
          <ChevronDown
            size={14}
            className={[
              "transition-transform",
              isOpen ? "rotate-180" : "",
              isActive
                ? "text-indigo-400 opacity-100"
                : "text-slate-300 opacity-0 group-hover:opacity-100",
            ].join(" ")}
          />
        </button>
        {isOpen && (
          <div className="pl-12 pr-2 space-y-1 mt-1">
            {item.children.map((child) => {
              const isChildActive = currentPathname === child.path || currentPathname.startsWith(`${child.path}/`);
              return (
                <NavLink
                  key={child.path}
                  to={child.path}
                  onClick={onNavigate}
                  className={[
                    "block px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isChildActive
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
                  ].join(" ")}
                >
                  {child.label}
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      end={item.end}
      onClick={onNavigate}
      className={() =>
        [
          "group relative flex items-center gap-3 rounded-xl pl-3 pr-2 py-2.5 text-sm font-semibold transition-colors",
          isActive
            ? "bg-indigo-50 text-indigo-700"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        ].join(" ")
      }
    >
      {/* Left accent bar — only on active. Lives inside the link so
          the click target stays one unit, but is absolutely
          positioned so it sits flush to the rounded edge. */}
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute -left-px top-2 bottom-2 w-1 rounded-full bg-indigo-600"
        />
      )}
      <span
        className={[
          "shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
          isActive
            ? "bg-indigo-100 text-indigo-700"
            : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700",
        ].join(" ")}
      >
        <Icon size={16} />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      <ChevronRight
        size={14}
        className={
          isActive
            ? "text-indigo-400 opacity-100"
            : "text-slate-300 opacity-0 group-hover:opacity-100"
        }
      />
    </NavLink>
  );
}

/**
 * SidebarPanel — the actual sidebar content (brand strip + nav +
 * sign-out footer). Rendered twice: once as the fixed desktop
 * sidebar and once inside the mobile drawer. Accepts a per-item
 * `onNavigate` so the drawer instance can close itself the moment
 * a nav item is tapped.
 *
 * The `closeButton` slot is rendered in the mobile drawer's
 * version so tapping it dismisses the drawer without needing to
 * swipe / tap the backdrop. Desktop renders nothing for it.
 */
function SidebarPanel({
  pathname,
  logoUrl,
  appName,
  onLogout,
  onNavigate,
  closeButton = null,
}) {
  const primaryItems = SIDEBAR_NAV_ITEMS.filter((it) => !it.isExitLink);
  const exitItems = SIDEBAR_NAV_ITEMS.filter((it) => it.isExitLink);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Brand strip — admin-configured brand logo + section
          label. Same on desktop and mobile so the visual identity
          stays consistent across the customer surface. The mobile
          drawer additionally hosts its close button on the right
          of this row. */}
      <div className="px-4 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
            <img
              src={logoUrl}
              alt={`${appName} logo`}
              className="h-full w-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-900 leading-tight truncate">
              My Rewards
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Shop&amp;Earn Network
            </p>
          </div>
          {closeButton}
        </div>
      </div>

      {/* Primary nav — scrollable middle column so the brand
          strip and the sign-out footer stay pinned even when the
          item list grows. "Back to Shop" sits at the bottom of
          this list (separated by a thin divider) so it reads as
          a peer of the other nav items rather than a footer link. */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {primaryItems.map((item) => (
          <NavItem
            key={item.path}
            item={item}
            currentPathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
        {exitItems.length > 0 && (
          <>
            <div className="my-2 mx-3 border-t border-slate-100" />
            {exitItems.map((item) => (
              <NavItem
                key={item.path}
                item={item}
                currentPathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </nav>

      {/* Sign-out footer — destructive-tinted button pinned to
          the bottom. Uses the shared `logout` from AuthContext
          so push-token cleanup, storage purge, and post-logout
          redirect all stay in one place. */}
      <div className="px-2 pb-3 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onLogout}
          className="group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-rose-50 text-rose-500 group-hover:bg-rose-100 group-hover:text-rose-600 transition-colors">
            <LogOut size={16} />
          </span>
          <span className="flex-1 text-left truncate">Sign out</span>
        </button>
      </div>
    </div>
  );
}

const MlmLayout = () => {
  const { pathname } = useLocation();
  const { logout } = useAuth();
  const { settings } = useSettings();
  // Same resolution pattern used by `Footer`, `Header`, `Sidebar`,
  // `MainLocationHeader`, etc.: prefer the admin-configured logo
  // and fall back to the bundled default asset.
  const logoUrl = settings?.logoUrl || DefaultLogo;
  const appName = settings?.appName || "Shop&Earn";

  // Mobile drawer open state. The `openDrawer` / `closeDrawer`
  // callbacks are exposed via context so per-page mobile headers
  // can trigger the drawer without lifting their entire chrome
  // up into this layout component.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Auto-close the drawer whenever the URL changes — covers nav
  // item taps (drawer closes before the new page mounts so there's
  // no flash of "drawer over the wrong page") and the browser
  // back/forward gestures.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape-to-close + body scroll lock while the drawer is open.
  // Without the lock the page below scrolls under the drawer on
  // iOS, which feels broken; restoring `overflow` on unmount keeps
  // us from corrupting the document state for any unrelated page.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  return (
    <MlmDrawerContext.Provider value={{ openDrawer, closeDrawer, isOpen: drawerOpen }}>
      <div className="min-h-screen bg-slate-50">
        {/* DESKTOP SIDEBAR — fixed-position, gated `hidden md:flex`.
            Fixed (not absolute) so it stays visible while the main
            content scrolls; mirrors the admin shell pattern. */}
        <aside
          className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 flex-col border-r border-slate-200 z-30"
          aria-label="MLM navigation"
        >
          <SidebarPanel
            pathname={pathname}
            logoUrl={logoUrl}
            appName={appName}
            onLogout={logout}
          />
        </aside>

        {/* MOBILE DRAWER — slide-in panel + backdrop, rendered only
            on `< md` widths. Opening / closing is animated via a
            transform on the panel and an opacity transition on the
            backdrop so the gesture feels native. Pointer events on
            the backdrop are disabled when closed so clicks pass
            through to the page beneath. */}
        <div
          className={`md:hidden fixed inset-0 z-50 transition-opacity duration-200 ${
            drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-hidden={!drawerOpen}
        >
          {/* Backdrop — tap to dismiss. */}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawer}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] w-full h-full"
          />
          {/* Panel — slides in from the left. Width matches the
              desktop sidebar so the layout muscle-memory carries
              between the two sizes. */}
          <aside
            className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl transform transition-transform duration-200 ease-out ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="MLM navigation"
          >
            <SidebarPanel
              pathname={pathname}
              logoUrl={logoUrl}
              appName={appName}
              onLogout={logout}
              // Tapping a nav item closes the drawer before the
              // route transitions, preventing a one-frame flash of
              // the drawer over the new page on slower devices.
              onNavigate={closeDrawer}
              closeButton={
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="shrink-0 w-9 h-9 -mr-1 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
                  aria-label="Close navigation"
                >
                  <X size={18} />
                </button>
              }
            />
          </aside>
        </div>

        {/* MAIN COLUMN — `md:pl-64` reserves the sidebar's
            footprint on desktop. On mobile there's no fixed
            sidebar so the padding is zero and each MLM page
            renders edge-to-edge. */}
        <main className="min-h-screen md:pl-64">
          <Outlet />
        </main>
      </div>
    </MlmDrawerContext.Provider>
  );
};

export default MlmLayout;
