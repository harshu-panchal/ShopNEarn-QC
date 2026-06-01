import { useCallback, useState } from 'react';
import { customerApi } from '../services/customerApi';

/**
 * useCheckout
 *
 * Encapsulates the "preview → place order" two-step flow that every
 * checkout page re-implements inline today. Exposes a small action API
 * plus the in-flight state machine.
 *
 * Part of refactor P4.x — customer hooks scaffold. CheckoutPage.jsx is the
 * intended first consumer (currently 43 KB of inline checkout logic per the
 * refactor plan).
 *
 * Usage:
 *   const { preview, placeOrder, previewing, placing, error, lastPreview } =
 *     useCheckout();
 *
 *   const { data } = await preview({ addressId, paymentMode, couponCode });
 *   const { data } = await placeOrder({ addressId, paymentMode, couponCode });
 */
export function useCheckout() {
  const [previewing, setPreviewing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);
  const [lastPreview, setLastPreview] = useState(null);

  const preview = useCallback(async (payload) => {
    setPreviewing(true);
    setError(null);
    try {
      const response = await customerApi.checkoutPreview(payload);
      setLastPreview(response?.data ?? null);
      return response;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setPreviewing(false);
    }
  }, []);

  const placeOrder = useCallback(async (payload) => {
    setPlacing(true);
    setError(null);
    try {
      const response = await customerApi.placeOrder(payload);
      return response;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setPlacing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setLastPreview(null);
  }, []);

  return {
    preview,
    placeOrder,
    previewing,
    placing,
    error,
    lastPreview,
    reset,
  };
}

export default useCheckout;
