import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * useApiState
 *
 * Reusable wrapper for the universal `useState + useEffect + axios → loading/
 * error/data` boilerplate that every page currently re-implements. Wraps any
 * async fetcher and exposes a small, predictable interface.
 *
 * Usage:
 *
 *   const { data, loading, error, refetch } = useApiState(
 *     () => api.get('/seller/products', { params: { page } }),
 *     [page],
 *     { initialData: { items: [], total: 0 } }
 *   );
 *
 * Behavior:
 *   - Runs `fetcher` on mount and whenever `deps` change (shallow Array deps).
 *   - Ignores out-of-order responses (only the latest call sets state).
 *   - Sets `loading: true` for the duration of an in-flight call.
 *   - Captures errors as `error` (Error-like). Existing `data` is preserved
 *     across refetches so the UI does not flash blank.
 *   - `refetch()` re-runs the fetcher with the current `fetcher` reference.
 *   - `setData(next)` is exposed for optimistic updates.
 *
 * Notes:
 *   - The fetcher is **not** memoized for you. If it captures fresh closure
 *     state (e.g. filters), pass those values in `deps`.
 *   - Supports a fetcher that returns either a plain response object or an
 *     axios response (`response.data` is auto-unwrapped only if the shape
 *     matches `{ data: ... }` AND `options.unwrap !== false`).
 */
export function useApiState(fetcher, deps = [], options = {}) {
    const { initialData = null, unwrap = true, enabled = true } = options;

    const [data, setData] = useState(initialData);
    const [loading, setLoading] = useState(Boolean(enabled));
    const [error, setError] = useState(null);

    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const callCounter = useRef(0);

    const run = useCallback(async () => {
        const currentCall = ++callCounter.current;
        setLoading(true);
        setError(null);
        try {
            const response = await fetcherRef.current();
            if (currentCall !== callCounter.current) return;
            if (unwrap && response && typeof response === 'object' && 'data' in response) {
                setData(response.data);
            } else {
                setData(response);
            }
        } catch (err) {
            if (currentCall !== callCounter.current) return;
            setError(err);
        } finally {
            if (currentCall === callCounter.current) {
                setLoading(false);
            }
        }
    }, [unwrap]);

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return undefined;
        }
        run();
        return () => {
            callCounter.current++;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, ...deps]);

    return { data, loading, error, refetch: run, setData };
}

export default useApiState;
