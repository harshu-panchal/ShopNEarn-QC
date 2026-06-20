import React from 'react';
import { Search, X } from 'lucide-react';

/**
 * Shared name / public User ID search bar for MLM team list pages.
 * Parent owns debouncing and API calls; this is presentational only.
 */
export function TeamMemberSearch({
    value,
    onChange,
    placeholder = 'Search by name or ID…',
    className = '',
}) {
    return (
        <div className={`relative ${className}`}>
            <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
                type="search"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label="Search team members by name or ID"
                className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
            />
            {value ? (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    aria-label="Clear search"
                >
                    <X size={16} />
                </button>
            ) : null}
        </div>
    );
}

/** Client-side filter for already-loaded referral rows. */
export function filterTeamMembersByQuery(items, query) {
    const term = String(query || '').trim().toLowerCase();
    if (!term || term.length < 2) return items;
    return items.filter((row) => {
        const name = String(row.name || '').toLowerCase();
        const referralCode = String(row.referralCode || '').toLowerCase();
        const publicUserId = String(row.publicUserId || '').toLowerCase();
        return (
            name.includes(term) ||
            referralCode.includes(term) ||
            publicUserId.includes(term)
        );
    });
}

export default TeamMemberSearch;
