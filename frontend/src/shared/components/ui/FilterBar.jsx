import React from 'react';
import { cn } from '@/lib/utils';

/**
 * FilterBar
 *
 * Horizontal flex container for filter controls (selects, date pickers,
 * search inputs, action buttons). Standardizes spacing, wrapping, and
 * alignment so every list page looks the same.
 *
 *   <FilterBar
 *     left={
 *       <>
 *         <Input placeholder="Search..." value={q} onChange={setQ} />
 *         <select ...>
 *       </>
 *     }
 *     right={<Button onClick={onExport}>Export</Button>}
 *   />
 */
const FilterBar = ({ left, right, className, children }) => {
    if (children) {
        return (
            <div
                className={cn(
                    'flex flex-wrap items-center gap-3 pb-4',
                    className,
                )}
            >
                {children}
            </div>
        );
    }

    return (
        <div
            className={cn(
                'flex flex-wrap items-center justify-between gap-3 pb-4',
                className,
            )}
        >
            <div className="flex flex-wrap items-center gap-2">{left}</div>
            {right ? (
                <div className="flex flex-wrap items-center gap-2">{right}</div>
            ) : null}
        </div>
    );
};

export default FilterBar;
