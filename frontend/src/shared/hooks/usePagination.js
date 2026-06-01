import { useState, useMemo, useCallback } from 'react';

/**
 * usePagination
 *
 * Tiny state holder for paginated lists. Default page size 20, clamps page to
 * `[1, totalPages]` once total is known.
 *
 * Usage:
 *   const { page, limit, setPage, nextPage, prevPage, reset, totalPages } =
 *     usePagination({ initialPage: 1, initialLimit: 20, total: data?.total });
 */
export function usePagination({
    initialPage = 1,
    initialLimit = 20,
    total = 0,
} = {}) {
    const [page, setPageRaw] = useState(initialPage);
    const [limit, setLimit] = useState(initialLimit);

    const totalPages = useMemo(
        () => (limit > 0 ? Math.max(1, Math.ceil(Number(total || 0) / limit)) : 1),
        [total, limit],
    );

    const setPage = useCallback(
        (next) => {
            const n = Number(next) || 1;
            if (n < 1) return setPageRaw(1);
            if (n > totalPages) return setPageRaw(totalPages);
            setPageRaw(n);
        },
        [totalPages],
    );

    const nextPage = useCallback(() => setPage(page + 1), [page, setPage]);
    const prevPage = useCallback(() => setPage(page - 1), [page, setPage]);
    const reset = useCallback(() => setPageRaw(initialPage), [initialPage]);

    return {
        page,
        limit,
        setPage,
        setLimit,
        nextPage,
        prevPage,
        reset,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
    };
}

export default usePagination;
