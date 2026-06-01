/**
 * Customer-scoped hooks barrel.
 *
 * Scaffolded in refactor P4.x (Part 3) to give monolithic customer pages
 * (especially CheckoutPage.jsx at 43 KB) a small, well-defined surface to
 * gradually migrate inline state machines to.
 *
 *   import { useOrders, useOrderDetails, useCheckout } from '@modules/customer/hooks';
 *
 * Note: `useCart` already exists as a context hook
 * (`@modules/customer/context/CartContext`). We deliberately do NOT shadow
 * it here — page-level code keeps using `useCart()` from the context. The
 * hooks here cover read-side fetches (orders, order details) and the
 * checkout action API.
 */
export { useOrders } from './useOrders';
export { useOrderDetails } from './useOrderDetails';
export { useCheckout } from './useCheckout';
export {
  useOrderIdentifiers,
  resolveOrderIdentifiers,
} from './useOrderIdentifiers';
