import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Lets the global admin search bar hand a query to a list page via `?q=`.
 * Pass the page's own search setter; it is called whenever `q` is present/changes.
 */
export default function useUrlSearchQuery(setSearchTerm) {
  const { search } = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(search).get('q');
    if (q !== null) setSearchTerm(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
}
