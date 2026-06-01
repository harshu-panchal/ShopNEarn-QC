import { useApiState } from '@shared/hooks';
import { customerApi } from '../services/customerApi';

/**
 * useOrderDetails
 *
 * Reader for a single order's live workflow + return details. Re-fetches
 * whenever `orderId` changes. Disable the fetch by passing a falsy id.
 *
 * Part of refactor P4.x — customer hooks scaffold.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useOrderDetails(orderId);
 */
export function useOrderDetails(orderId) {
  return useApiState(
    () => customerApi.getOrderDetails(orderId),
    [orderId],
    { enabled: Boolean(orderId) },
  );
}

export default useOrderDetails;
