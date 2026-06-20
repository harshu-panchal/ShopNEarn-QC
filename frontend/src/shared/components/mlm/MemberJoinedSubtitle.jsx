import React from 'react';
import { formatMemberJoinedAt } from '../../utils/mlmMemberDisplay';

/**
 * Small "Joined …" line for member list rows (name block or table cell).
 * `joinedAt` is account registration date-time from the API.
 */
export default function MemberJoinedSubtitle({
  joinedAt,
  className = 'text-[11px] text-slate-500',
  prefix = 'Joined ',
}) {
  if (!joinedAt) return null;
  const label = prefix
    ? `${prefix}${formatMemberJoinedAt(joinedAt)}`
    : formatMemberJoinedAt(joinedAt);
  return <p className={className}>{label}</p>;
}
