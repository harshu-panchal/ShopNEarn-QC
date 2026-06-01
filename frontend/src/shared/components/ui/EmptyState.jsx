import React from 'react';
import { cn } from '@/lib/utils';

/**
 * EmptyState
 *
 * Render this when a list/table has no results. Designed to be wrapped
 * around any icon (lucide-react / heroicons) and an optional action button.
 *
 *   <EmptyState
 *     icon={<Inbox className="h-10 w-10 text-gray-400" />}
 *     title="No orders yet"
 *     description="Orders placed by customers will appear here."
 *     action={<Button onClick={...}>Refresh</Button>}
 *   />
 */
const EmptyState = ({
    icon,
    title,
    description,
    action,
    className,
}) => {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center gap-3 py-12 px-4 text-center',
                className,
            )}
        >
            {icon ? <div className="mb-1">{icon}</div> : null}
            {title ? (
                <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            ) : null}
            {description ? (
                <p className="text-sm text-gray-500 max-w-md">{description}</p>
            ) : null}
            {action ? <div className="mt-2">{action}</div> : null}
        </div>
    );
};

export default EmptyState;
