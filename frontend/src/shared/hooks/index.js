/**
 * Shared hooks barrel.
 *
 * Single import-surface for the reusable hooks introduced in refactor P4.2.
 * Page-level imports should prefer this barrel:
 *
 *   import { useApiState, usePagination, useDebounce } from '@shared/hooks';
 *
 * Note: `useToast` continues to live next to the Toast component file
 * (`@shared/components/ui/Toast`). We re-export it here so consumers can
 * pull all reusable hooks from one place.
 */

export { useApiState } from './useApiState';
export { usePagination } from './usePagination';
export { useDebounce } from './useDebounce';
export { useConfirmDialog } from './useConfirmDialog';
export { useFilters } from './useFilters';
export { useToast } from '../components/ui/Toast';
