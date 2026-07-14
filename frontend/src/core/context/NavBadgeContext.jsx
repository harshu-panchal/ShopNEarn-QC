import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@core/context/AuthContext";
import { getJSON, setJSON } from "@core/utils/storage";
import axiosInstance from "@core/api/axios";

const NavBadgeContext = createContext(undefined);

const POLL_MS = 45_000;

/** API key → sidebar path for admin */
export const ADMIN_NAV_BADGE_PATHS = Object.freeze({
  joiningReviews: "/admin/mlm/joining-reviews",
  upgradeReviews: "/admin/mlm/upgrade-reviews",
  mlmWithdrawals: "/admin/mlm/withdrawals",
  sellersPending: "/admin/sellers/pending",
  productsModeration: "/admin/products",
  ordersPending: "/admin/orders/pending",
  moneyRequests: "/admin/withdrawals",
  franchiseRegistrations: "/admin/franchise/registrations",
  franchiseTopups: "/admin/franchise/topups",
});

/** API key → sidebar path for seller */
export const SELLER_NAV_BADGE_PATHS = Object.freeze({
  ordersPending: "/seller/orders",
  returnsPending: "/seller/returns",
});

const PATH_TO_ADMIN_KEY = Object.freeze(
  Object.fromEntries(
    Object.entries(ADMIN_NAV_BADGE_PATHS).map(([key, path]) => [path, key]),
  ),
);

const PATH_TO_SELLER_KEY = Object.freeze(
  Object.fromEntries(
    Object.entries(SELLER_NAV_BADGE_PATHS).map(([key, path]) => [path, key]),
  ),
);

function getCurrentPathname() {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function emptyCountsForRole(role) {
  const r = normalizeRole(role);
  const keys =
    r === "admin"
      ? Object.keys(ADMIN_NAV_BADGE_PATHS)
      : r === "seller"
        ? Object.keys(SELLER_NAV_BADGE_PATHS)
        : [];
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

function pathsForRole(role) {
  const r = normalizeRole(role);
  if (r === "admin") return ADMIN_NAV_BADGE_PATHS;
  if (r === "seller") return SELLER_NAV_BADGE_PATHS;
  return {};
}

function keyForPath(role, pathname) {
  const r = normalizeRole(role);
  const map = r === "admin" ? PATH_TO_ADMIN_KEY : r === "seller" ? PATH_TO_SELLER_KEY : {};
  if (map[pathname]) return map[pathname];
  // Allow nested product detail routes under /admin/products/*
  if (r === "admin" && pathname.startsWith("/admin/products")) {
    return "productsModeration";
  }
  return null;
}

function seedLastSeen(role, existing) {
  const paths = pathsForRole(role);
  const now = new Date().toISOString();
  const next = { ...(existing && typeof existing === "object" ? existing : {}) };
  let changed = false;
  for (const key of Object.keys(paths)) {
    if (!next[key]) {
      next[key] = now;
      changed = true;
    }
  }
  return { map: next, changed };
}

async function fetchNavBadges(role, sinceByKey) {
  const r = normalizeRole(role);
  const url = r === "admin" ? "/admin/nav-badges" : "/seller/nav-badges";
  const response = await axiosInstance.get(url, {
    params: { since: JSON.stringify(sinceByKey || {}) },
  });
  const counts = response?.data?.result?.counts;
  return counts && typeof counts === "object" ? counts : emptyCountsForRole(role);
}

export const NavBadgeProvider = ({ children }) => {
  const { token, role, user } = useAuth();
  const [pathname, setPathname] = useState(getCurrentPathname);
  const [countsByKey, setCountsByKey] = useState(() => emptyCountsForRole(role));
  const lastSeenRef = useRef({});
  const pollInFlightRef = useRef(false);

  const userId = useMemo(
    () => String(user?._id || user?.id || "").trim(),
    [user?._id, user?.id],
  );

  const normalizedRole = normalizeRole(role);

  const storageKey = useMemo(() => {
    if (
      !userId ||
      (normalizedRole !== "admin" && normalizedRole !== "seller")
    ) {
      return "";
    }
    return `navBadgesLastSeen:${normalizedRole}:${userId}`;
  }, [normalizedRole, userId]);

  // Track SPA navigations the same way SupportUnreadContext does.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const updatePathname = () => setPathname(window.location.pathname);
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      updatePathname();
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      updatePathname();
      return result;
    };

    window.addEventListener("popstate", updatePathname);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", updatePathname);
    };
  }, []);

  // Load + seed lastSeen map when auth identity is ready.
  useEffect(() => {
    if (!storageKey) {
      lastSeenRef.current = {};
      setCountsByKey(emptyCountsForRole(normalizedRole));
      return;
    }
    const parsed = getJSON(storageKey, {});
    const { map, changed } = seedLastSeen(normalizedRole, parsed);
    lastSeenRef.current = map;
    if (changed) {
      setJSON(storageKey, map);
    }
    setCountsByKey(emptyCountsForRole(normalizedRole));
  }, [storageKey, normalizedRole]);

  const persistLastSeen = useCallback(
    (nextMap) => {
      lastSeenRef.current = nextMap;
      if (!storageKey) return;
      setJSON(storageKey, nextMap);
    },
    [storageKey],
  );

  const refreshCounts = useCallback(async () => {
    if (!token || !storageKey) return;
    if (normalizedRole !== "admin" && normalizedRole !== "seller") return;
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const viewingKey = keyForPath(normalizedRole, getCurrentPathname());
      // While viewing a queue, advance lastSeen so arrivals during the visit
      // don't re-badge the moment the admin navigates away.
      if (viewingKey) {
        const bumped = {
          ...lastSeenRef.current,
          [viewingKey]: new Date().toISOString(),
        };
        persistLastSeen(bumped);
      }

      const since = lastSeenRef.current || {};
      const counts = await fetchNavBadges(normalizedRole, since);
      const next = { ...emptyCountsForRole(normalizedRole), ...counts };
      if (viewingKey) next[viewingKey] = 0;
      setCountsByKey(next);
    } catch (err) {
      console.warn("Nav badge poll failed", err?.message || err);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [token, storageKey, normalizedRole, persistLastSeen]);

  // Clear badge for the queue matching the current route.
  useEffect(() => {
    if (!storageKey) return;
    const key = keyForPath(normalizedRole, pathname);
    if (!key) return;

    const now = new Date().toISOString();
    const next = { ...lastSeenRef.current, [key]: now };
    persistLastSeen(next);
    setCountsByKey((prev) => ({ ...prev, [key]: 0 }));
  }, [pathname, storageKey, normalizedRole, persistLastSeen]);

  // Poll + focus refresh.
  useEffect(() => {
    if (!token || !storageKey) return undefined;
    if (normalizedRole !== "admin" && normalizedRole !== "seller") return undefined;

    refreshCounts();
    const id = setInterval(refreshCounts, POLL_MS);
    const onFocus = () => refreshCounts();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [token, storageKey, normalizedRole, refreshCounts]);

  const countsByPath = useMemo(() => {
    const pathMap = pathsForRole(normalizedRole);
    const viewingKey = keyForPath(normalizedRole, pathname);
    const out = {};
    for (const [key, path] of Object.entries(pathMap)) {
      out[path] = viewingKey === key ? 0 : Number(countsByKey?.[key] || 0);
    }
    return out;
  }, [countsByKey, normalizedRole, pathname]);

  const getBadge = useCallback(
    (path) => Number(countsByPath[path] || 0),
    [countsByPath],
  );

  const value = useMemo(
    () => ({
      countsByKey,
      countsByPath,
      getBadge,
      refreshCounts,
    }),
    [countsByKey, countsByPath, getBadge, refreshCounts],
  );

  return (
    <NavBadgeContext.Provider value={value}>{children}</NavBadgeContext.Provider>
  );
};

export const useNavBadges = () => {
  const ctx = useContext(NavBadgeContext);
  if (!ctx) {
    throw new Error("useNavBadges must be used within NavBadgeProvider");
  }
  return ctx;
};

/** Optional hook that returns zeros when provider is absent (safe for shared layouts). */
export const useNavBadgesOptional = () => {
  return useContext(NavBadgeContext) || {
    countsByKey: {},
    countsByPath: {},
    getBadge: () => 0,
    refreshCounts: async () => {},
  };
};

export default NavBadgeContext;
