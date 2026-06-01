/**
 * Barrel for sub-components and helpers extracted from
 * `modules/seller/pages/Orders.jsx`.
 *
 * Per refactor plan P4.6 / P4.7. Add new extractions one at a time, paired
 * with a single-PR change in Orders.jsx that swaps inline code for the
 * extracted component. Do not promote anything to `@shared/components/ui`
 * until a second consumer (e.g. the admin Orders page) needs it.
 */
export { getOrderStatusVariant } from './orderStatusUtils';
