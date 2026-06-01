import { useApiState } from '@shared/hooks';
import { customerApi } from '../services/customerApi';

/**
 * useOrders
 *
 * Customer-scoped reader for the authenticated user's orders. Wraps the
 * existing `customerApi.getMyOrders()` call in the shared `useApiState`
 * hook so pages don't re-implement loading/error/refetch state.
 *
 * Part of refactor P4.x — customer hooks scaffold.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useOrders();
 *
 *   // Auto-unwraps `response.data` per useApiState convention.
 *   const orders = data?.result?.orders ?? [];
 */
export function useOrders() {
  return useApiState(() => customerApi.getMyOrders(), []);
}

export default useOrders;
