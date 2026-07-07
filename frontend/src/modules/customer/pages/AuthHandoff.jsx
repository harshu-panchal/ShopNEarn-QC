import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@core/context/AuthContext';
import { setActiveRole, ROLES } from '@core/auth/activeRoleStore';

/**
 * AuthHandoff — public landing page that installs a customer
 * session from a JWT delivered in the URL hash, then forwards the
 * browser to a destination route.
 *
 * Used by the admin "Log in as Member" support flow:
 *   1. Admin clicks the button on `/admin/mlm/members/:id`.
 *   2. Frontend POSTs `/admin/mlm/members/:id/impersonation-token`
 *      and receives a short-lived customer JWT.
 *   3. Admin frontend calls `window.open` on this page with
 *      `/auth/handoff#token=…&redirect=/mlm` so the new tab can
 *      install the token, scrub it from the URL, and land the
 *      admin on the customer's MLM dashboard pre-authenticated.
 *
 * Also used by the admin "Log in to Harsh's Hub" flow:
 *   1. Admin clicks the button on `/admin/franchise`.
 *   2. Frontend POSTs `/admin/franchise/hub-seller/impersonation-token`.
 *   3. New tab opens `/auth/handoff#token=…&role=seller&redirect=/seller`.
 *
 * Why a hash fragment instead of a query string:
 *   - Hashes are NEVER sent to the server in a Referer header or
 *     access log. A querystring token would leak to every analytics
 *     pixel and reverse-proxy log on the way to the SPA.
 *
 * Why a public route (not behind ProtectedRoute):
 *   - The whole point is to install a session for an UNauthenticated
 *     browser context. Wrapping it in the auth guard would bounce it
 *     to `/login` before the token could be processed.
 *
 * Tab isolation:
 *   - JWTs are stored under role-specific keys (`auth_customer`,
 *     `auth_seller`, etc.) in localStorage, separate from the admin's
 *     `auth_admin` token. So the admin's existing tab remains
 *     authenticated as admin while this new tab runs as the target role.
 *   - WARNING: if the admin already had ANOTHER customer session
 *     open in a different tab (e.g. logged in to their personal
 *     account), this handoff overwrites it. That's the unavoidable
 *     cost of using localStorage; sessionStorage would lose the
 *     session on refresh, which is worse for the support workflow.
 *
 * Scrub behaviour:
 *   - Immediately replaces `location.hash` with an empty string via
 *     `history.replaceState` so the JWT doesn't survive in
 *     bookmarks, screenshots, or the browser's back/forward stack.
 */
const ALLOWED_REDIRECT_PREFIXES = {
    customer: ['/mlm', '/profile', '/orders', '/wallet', '/'],
    seller: ['/seller'],
};

const DEFAULT_REDIRECT = {
    customer: '/mlm',
    seller: '/seller',
};

const isSafeRedirect = (raw, role = 'customer') => {
    if (!raw || typeof raw !== 'string') return false;
    // Reject anything that isn't a same-origin path — guards
    // against `//evil.com` and `https://evil.com` open redirects.
    if (!raw.startsWith('/') || raw.startsWith('//')) return false;
    const prefixes = ALLOWED_REDIRECT_PREFIXES[role] || ALLOWED_REDIRECT_PREFIXES.customer;
    return prefixes.some(
        (prefix) => raw === prefix || raw.startsWith(`${prefix}/`),
    );
};

const parseHashParams = () => {
    const raw = window.location.hash || '';
    const cleaned = raw.startsWith('#') ? raw.slice(1) : raw;
    const params = new URLSearchParams(cleaned);
    const role = params.get('role') === 'seller' ? 'seller' : 'customer';
    return {
        token: params.get('token') || '',
        redirect: params.get('redirect') || DEFAULT_REDIRECT[role],
        role,
    };
};

const AuthHandoff = () => {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [error, setError] = useState(null);

    useEffect(() => {
        const { token, redirect, role } = parseHashParams();

        // Immediately clear the hash so the token never persists in
        // the URL bar / bookmarks / browser history.
        try {
            window.history.replaceState(
                {},
                '',
                `${window.location.pathname}${window.location.search}`,
            );
        } catch {
            // History mutation can fail in some embedded contexts —
            // not fatal, the redirect below moves us off this URL.
        }

        if (!token) {
            setError('Missing impersonation token. Re-open from the admin panel.');
            return;
        }

        const target = isSafeRedirect(redirect, role)
            ? redirect
            : DEFAULT_REDIRECT[role];

        // Flip the in-memory role store BEFORE writing the token so
        // the AuthContext effect (keyed on `[token, currentRole]`)
        // fires exactly once with the right role.
        setActiveRole(role === 'seller' ? ROLES.SELLER : ROLES.CUSTOMER);

        login({ role, token });

        // Replace history entry instead of pushing so the back
        // button doesn't return the admin to the handoff splash.
        navigate(target, { replace: true });
    // We intentionally run this exactly once on mount. `login` and
    // `navigate` are stable across renders; including them as deps
    // would only risk a double-fire if React's strict-mode double-
    // invoke ever caches them differently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 font-outfit px-6">
                <div className="max-w-md w-full bg-white border border-rose-200 rounded-2xl p-6 text-center shadow-sm">
                    <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 flex items-center justify-center mb-3">
                        <ShieldAlert size={22} className="text-rose-600" />
                    </div>
                    <h1 className="text-base font-bold text-slate-900 mb-1">
                        Handoff failed
                    </h1>
                    <p className="text-sm text-slate-600">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 font-outfit">
            <div className="flex flex-col items-center gap-3 text-slate-600">
                <Loader2 size={28} className="animate-spin text-indigo-600" />
                <p className="text-sm font-semibold">Signing you in…</p>
            </div>
        </div>
    );
};

export default AuthHandoff;
