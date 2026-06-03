import { useEffect, useRef, useState } from "react";
import axiosInstance from "@core/api/axios";

/**
 * Fetch a *published* legal / informational page for the given app.
 *
 * Returns `{ page, loading, error }`. `page` is `null` until either the
 * fetch succeeds or fails — callers should keep their hardcoded fallback
 * UI in place to handle the "admin hasn't published yet" case.
 *
 * The endpoint is public (no auth header required); customer / seller /
 * delivery apps can all consume it the same way.
 *
 * @param {object} params
 * @param {"customer"|"seller"|"delivery"} params.app
 * @param {string} params.slug                e.g. "privacy-policy"
 */
export function useLegalPage({ app, slug } = {}) {
    const [page, setPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const reqRef = useRef(0);

    useEffect(() => {
        if (!app || !slug) {
            setLoading(false);
            return undefined;
        }
        const reqId = ++reqRef.current;
        setLoading(true);
        setError(null);

        axiosInstance
            .get(`/public/legal-pages/${app}/${slug}`)
            .then((res) => {
                if (reqRef.current !== reqId) return;
                const result = res?.data?.result || null;
                setPage(result);
            })
            .catch((err) => {
                if (reqRef.current !== reqId) return;
                // 404 is the "not yet published" case — treat as null page,
                // not an error, so the caller can fall back gracefully.
                if (err?.response?.status === 404) {
                    setPage(null);
                } else {
                    setError(err);
                }
            })
            .finally(() => {
                if (reqRef.current !== reqId) return;
                setLoading(false);
            });

        return () => {
            // Bumping the ref invalidates the in-flight request's setters.
            reqRef.current += 1;
        };
    }, [app, slug]);

    return { page, loading, error };
}

export default useLegalPage;
