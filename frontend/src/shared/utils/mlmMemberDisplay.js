/**
 * Consistent registration date+time formatting for MLM member list rows.
 * The API `joinedAt` field carries account registration time (not plan activation).
 */
export function formatMemberJoinedAt(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
