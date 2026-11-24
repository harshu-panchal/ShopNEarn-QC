import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HiOutlineSearch } from 'react-icons/hi';
import { CornerDownLeft, ArrowRight, Search as SearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminApi } from '@/modules/admin/services/adminApi';

/**
 * Extra words an admin might type for a page that aren't in its label.
 * Keyed by route path (matched exactly against the nav item path).
 */
const SYNONYMS = {
  '/admin': 'home overview stats analytics summary',
  '/admin/categories/hierarchy': 'category tree catalog structure',
  '/admin/categories/header': 'top menu navigation category',
  '/admin/categories/level2': 'level 2 main category',
  '/admin/categories/sub': 'subcategory sub category level 3',
  '/admin/products': 'product item catalog stock sku inventory approve moderation',
  '/admin/hero-categories': 'banner hero slider home page',
  '/admin/notifications': 'push notification broadcast message announce',
  '/admin/coupons': 'coupon promo code discount voucher offer',
  '/admin/offer-sections': 'offer deal section home',
  '/admin/shop-by-store': 'store shop brand',
  '/admin/support-tickets': 'ticket help support complaint issue chat',
  '/admin/moderation': 'review rating comment moderate feedback',
  '/admin/sellers/active': 'seller vendor merchant shop store',
  '/admin/sellers/pending': 'seller vendor approval approve kyc application new',
  '/admin/seller-locations': 'seller map location address',
  '/admin/delivery-boys/active': 'delivery boy rider driver partner agent',
  '/admin/delivery-boys/pending': 'delivery boy rider driver approval approve kyc application new',
  '/admin/tracking': 'live map track fleet gps location rider',
  '/admin/delivery-funds': 'payout pay money settle driver cash fund',
  '/admin/wallet': 'wallet balance earnings revenue commission',
  '/admin/withdrawals': 'withdraw payout payment request money seller',
  '/admin/seller-transactions': 'transaction ledger payment seller payout history',
  '/admin/cash-collection': 'cash cod collect collection deposit',
  '/admin/customers': 'customer user buyer client member',
  '/admin/inventory-reports': 'inventory stock report warehouse',
  '/admin/mlm': 'mlm network referral dashboard',
  '/admin/mlm/members': 'mlm member user network referral',
  '/admin/mlm/joining-reviews': 'mlm join payment screenshot approve',
  '/admin/mlm/upgrade-reviews': 'mlm upgrade plan payment approve',
  '/admin/mlm/withdrawals': 'mlm withdraw payout',
  '/admin/mlm/payout-reports': 'mlm payout report income',
  '/admin/mlm/milestones': 'mlm milestone rule reward',
  '/admin/mlm/joining-plans': 'mlm plan package membership price',
  '/admin/mlm/settings': 'mlm config commission level',
  '/admin/franchise': 'franchise home shoppy partner dashboard',
  '/admin/franchise/registrations': 'franchise register application new partner',
  '/admin/franchise/topups': 'franchise topup top-up wallet recharge',
  '/admin/franchise/partners': 'franchise partner owner',
  '/admin/franchise/stock-orders': 'franchise stock order purchase',
  '/admin/franchise/dispatch': 'franchise dispatch ship send',
  '/admin/franchise/settings': 'franchise config',
  '/admin/faqs': 'faq question answer help',
  '/admin/legal-pages': 'terms privacy policy refund legal about',
  '/admin/orders/all': 'order purchase sale',
  '/admin/orders/pending': 'order new placed pending',
  '/admin/orders/processed': 'order preparing processing packed',
  '/admin/orders/out-for-delivery': 'order shipping dispatched transit delivery',
  '/admin/orders/delivered': 'order completed done',
  '/admin/orders/cancelled': 'order cancel',
  '/admin/orders/returned': 'order return refund',
  '/admin/returns': 'return refund request exchange',
  '/admin/billing': 'fee charge delivery charge handling gst tax platform fee billing',
  '/admin/settings': 'settings config general app logo name',
  '/admin/access/roles': 'role permission rbac access',
  '/admin/access/admins': 'admin user staff team access',
  '/admin/profile': 'profile account password me',
  '/admin/env': 'env environment system api key config server',
};

/** List pages that understand `?q=` (see useUrlSearchQuery). */
const SEARCHABLE = [
  { path: '/admin/orders/all', label: 'Orders' },
  { path: '/admin/products', label: 'Products' },
  { path: '/admin/customers', label: 'Customers' },
  { path: '/admin/sellers/active', label: 'Active Sellers' },
  { path: '/admin/sellers/pending', label: 'Pending Sellers' },
  { path: '/admin/delivery-boys/active', label: 'Active Drivers' },
  { path: '/admin/support-tickets', label: 'Help Tickets' },
  { path: '/admin/coupons', label: 'Coupons' },
];

const norm = (s) => String(s || '').toLowerCase().trim();

function flattenNav(navItems) {
  const out = [];
  (navItems || []).forEach((item) => {
    if (item.path) {
      out.push({ label: item.label, parent: '', path: item.path, icon: item.icon });
    }
    (item.children || []).forEach((child) => {
      if (child.path) {
        out.push({
          label: child.label,
          parent: item.label,
          path: child.path,
          icon: item.icon,
        });
      }
    });
  });
  return out;
}

function scorePage(entry, tokens) {
  const label = norm(entry.label);
  const parent = norm(entry.parent);
  const extra = norm(SYNONYMS[entry.path]);
  const hay = `${label} ${parent} ${extra}`;
  let total = 0;
  for (const t of tokens) {
    if (label === t) total += 100;
    else if (label.startsWith(t)) total += 60;
    else if (label.split(/\s+/).some((w) => w.startsWith(t))) total += 45;
    else if (label.includes(t)) total += 30;
    else if (parent.includes(t)) total += 20;
    else if (hay.split(/\s+/).some((w) => w.startsWith(t))) total += 12;
    else if (hay.includes(t)) total += 6;
    else return 0; // every word must match something
  }
  return total;
}

const AdminSearch = ({ navItems }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const pages = useMemo(() => flattenNav(navItems), [navItems]);

  const [entities, setEntities] = useState([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const seqRef = useRef(0);

  // Live record search (orders, customers, sellers, products, drivers), debounced.
  useEffect(() => {
    const q = query.trim();
    const seq = ++seqRef.current;
    if (q.length < 2 || !open) {
      setEntities([]);
      setLoadingEntities(false);
      return undefined;
    }
    const allowed = new Set(pages.map((p) => p.path));
    const unwrap = (res) => {
      const d = res?.data;
      const r = d?.result || {};
      return Array.isArray(r.items) ? r.items : Array.isArray(d?.results) ? d.results : [];
    };
    const jobs = [];
    if (allowed.has('/admin/orders/all')) {
      jobs.push(() =>
        adminApi.getOrders({ page: 1, limit: 5, search: q }).then((res) =>
          unwrap(res).map((o) => ({
            group: 'Orders',
            label: `#${o.orderId || o._id}`,
            sub: [o.customer?.name, o.pricing?.total != null ? `₹${o.pricing.total}` : null, o.status]
              .filter(Boolean)
              .join(' · '),
            path: `/admin/orders/view/${o.orderId || o._id}`,
          })),
        ),
      );
    }
    if (allowed.has('/admin/customers')) {
      jobs.push(() =>
        adminApi.getUsers({ page: 1, limit: 5, search: q }).then((res) =>
          unwrap(res).map((c) => ({
            group: 'Customers',
            label: c.name || c.email || c.phone || 'Customer',
            sub: [c.email, c.phone].filter(Boolean).join(' · '),
            path: `/admin/customers/${c.id || c._id}`,
          })),
        ),
      );
    }
    if (allowed.has('/admin/sellers/active')) {
      jobs.push(() =>
        adminApi.getActiveSellers({ page: 1, limit: 5, q }).then((res) =>
          unwrap(res).map((x) => ({
            group: 'Sellers',
            label: x.shopName || x.ownerName || x.email || 'Seller',
            sub: [x.ownerName, x.phone || x.email].filter(Boolean).join(' · '),
            path: `/admin/sellers/active/${x.id || x._id}`,
          })),
        ),
      );
    }
    if (allowed.has('/admin/products')) {
      jobs.push(() =>
        adminApi.getProductModerationList({ page: 1, limit: 5, search: q }).then((res) =>
          unwrap(res).map((p) => ({
            group: 'Products',
            label: p.name || 'Product',
            sub: [p.sku, p.price != null ? `₹${p.price}` : null].filter(Boolean).join(' · '),
            path: `/admin/products?q=${encodeURIComponent(p.name || q)}`,
          })),
        ),
      );
    }
    if (allowed.has('/admin/delivery-boys/active')) {
      jobs.push(() =>
        adminApi.getDeliveryPartners({ page: 1, limit: 5, search: q }).then((res) =>
          unwrap(res).map((d) => ({
            group: 'Drivers',
            label: d.name || d.phone || 'Driver',
            sub: [d.phone, d.email].filter(Boolean).join(' · '),
            path: `/admin/delivery-boys/active?q=${encodeURIComponent(d.name || d.phone || q)}`,
          })),
        ),
      );
    }

    setLoadingEntities(true);
    const timer = setTimeout(async () => {
      const settled = await Promise.allSettled(jobs.map((run) => run()));
      if (seq !== seqRef.current) return;
      setEntities(
        settled
          .filter((r) => r.status === 'fulfilled')
          .flatMap((r) => r.value)
          .map((e) => ({ type: 'entity', ...e })),
      );
      setLoadingEntities(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open, pages]);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) {
      return pages.map((p) => ({ type: 'page', ...p }));
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const pageHits = pages
      .map((p) => ({ type: 'page', ...p, score: scorePage(p, tokens) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const allowed = new Set(pages.map((p) => p.path));
    const searchHits = SEARCHABLE.filter((s) => allowed.has(s.path)).map((s) => ({
      type: 'search',
      label: s.label,
      path: s.path,
      query: query.trim(),
    }));

    return [...pageHits, ...entities, ...searchHits];
  }, [pages, query, entities]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Close when clicking outside.
  useEffect(() => {
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Ctrl/Cmd+K or "/" focuses the search box from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Keep the highlighted row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const go = (item) => {
    if (!item) return;
    const target =
      item.type === 'search'
        ? `${item.path}?q=${encodeURIComponent(item.query)}`
        : item.path;
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    navigate(target);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const groupOf = (r) =>
    r.type === 'page'
      ? query.trim() ? 'Go to page' : 'All pages'
      : r.type === 'entity'
        ? r.group
        : `Search "${query.trim()}" in`;

  return (
    <div ref={wrapRef} className="relative w-full md:w-[400px] group hidden md:block">
      <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-primary transition-all duration-300 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="admin-search-list"
        autoComplete="off"
        placeholder="Search pages, order IDs, customers, products…  ( / )"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full pl-10 pr-4 py-2 bg-gray-100/50 border border-transparent rounded-xl text-xs font-medium focus:bg-white focus:ring-2 focus:ring-primary/10 focus:border-primary/20 transition-all duration-500 outline-none"
      />

      {open && (
        <div
          id="admin-search-list"
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-2 max-h-[420px] overflow-y-auto rounded-2xl bg-white border border-gray-100 shadow-2xl shadow-black/10 z-50 py-2"
        >
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-xs font-semibold text-gray-400">
              {loadingEntities ? 'Searching…' : 'No matches'}
            </p>
          )}
          {loadingEntities && results.length > 0 && (
            <p className="px-4 pb-1 text-[10px] font-semibold text-gray-400">Searching records…</p>
          )}
          {results.map((r, idx) => {
            const Icon = r.type === 'search' || r.type === 'entity' ? SearchIcon : r.icon;
            const isActive = idx === active;
            return (
              <React.Fragment key={`${r.type}:${r.group || ''}:${r.path}`}>
                {(idx === 0 || groupOf(results[idx - 1]) !== groupOf(r)) && (
                  <p
                    className={cn(
                      'px-4 pb-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400',
                      idx === 0 ? 'pt-1' : 'pt-3 mt-1 border-t border-gray-100',
                    )}
                  >
                    {groupOf(r)}
                  </p>
                )}
                {r.type === 'search' && !query.trim() ? null : (
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-idx={idx}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(r)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                      isActive ? 'bg-primary/5' : 'hover:bg-gray-50',
                    )}
                  >
                    <span
                      className={cn(
                        'h-7 w-7 rounded-lg flex items-center justify-center shrink-0',
                        isActive ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500',
                      )}
                    >
                      {Icon ? <Icon className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-gray-900 truncate">
                        {r.label}
                      </span>
                      {(r.parent || r.sub) && (
                        <span className="block text-[10px] font-medium text-gray-400 truncate">
                          {r.type === 'page' ? r.parent : r.sub}
                        </span>
                      )}
                    </span>
                    {r.path === location.pathname && r.type === 'page' && (
                      <span className="text-[9px] font-bold uppercase text-gray-400">Current</span>
                    )}
                    {isActive && <CornerDownLeft className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminSearch;
