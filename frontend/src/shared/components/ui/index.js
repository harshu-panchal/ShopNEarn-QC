/**
 * Shared UI barrel.
 *
 * Single import-surface for the reusable UI primitives. Page-level imports
 * should prefer this barrel:
 *
 *   import { DataTable, FilterBar, ConfirmDialog, StatusBadge } from '@shared/components/ui';
 *
 * Adding a new primitive: drop it under this directory and add the export
 * here. Promote a component to this directory only AFTER a second use case
 * exists (per `shared-ui-component-extraction` skill).
 */

export { default as Badge } from './Badge';
export { default as Button } from './Button';
export { default as Card } from './Card';
export { default as ConfirmDialog } from './ConfirmDialog';
export { default as DataTable } from './DataTable';
export { default as EmptyState } from './EmptyState';
export { default as FilterBar } from './FilterBar';
export { default as FormField } from './FormField';
export { default as Input } from './Input';
export { default as Loader } from './Loader';
export { default as Modal } from './Modal';
export { default as PageHeader } from './PageHeader';
export { default as Pagination } from './Pagination';
export { default as StatCard } from './StatCard';
export { default as StatusBadge } from './StatusBadge';
export { ToastProvider, useToast } from './Toast';
