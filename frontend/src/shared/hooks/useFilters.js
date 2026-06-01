import { useState, useCallback, useMemo } from 'react';

/**
 * useFilters
 *
 * Lightweight filter-state holder used by list pages. Tracks an object of
 * filter values, exposes a setter per field, and a `reset()` that returns
 * to the initial values.
 *
 *   const { filters, setFilter, reset, hasActiveFilters } = useFilters({
 *     status: 'all',
 *     startDate: '',
 *     endDate: '',
 *   });
 *
 *   <select
 *     value={filters.status}
 *     onChange={(e) => setFilter('status', e.target.value)}
 *   />
 */
export function useFilters(initial = {}) {
    const [filters, setFilters] = useState(initial);

    const setFilter = useCallback((key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
    }, []);

    const replaceAll = useCallback((next) => {
        setFilters(next || {});
    }, []);

    const reset = useCallback(() => {
        setFilters(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const hasActiveFilters = useMemo(() => {
        const initialKeys = Object.keys(initial);
        return initialKeys.some((key) => {
            const cur = filters[key];
            const init = initial[key];
            if (Array.isArray(cur) && Array.isArray(init)) {
                return cur.length !== init.length;
            }
            return cur !== init && cur !== '' && cur != null;
        });
    }, [filters, initial]);

    return { filters, setFilter, replaceAll, reset, hasActiveFilters };
}

export default useFilters;
