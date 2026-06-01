import { useEffect, useState } from 'react';

/**
 * useDebounce
 *
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * stability. Useful for search inputs and filter changes that drive API
 * requests.
 *
 *   const debouncedQuery = useDebounce(query, 300);
 *   useEffect(() => { fetchResults(debouncedQuery); }, [debouncedQuery]);
 */
export function useDebounce(value, delayMs = 250) {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(t);
    }, [value, delayMs]);

    return debounced;
}

export default useDebounce;
