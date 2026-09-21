/**
 * Relative timestamps for list rows.
 *
 * A plain module rather than part of `ui.tsx`: a file that exports both a
 * component and a helper breaks React Fast Refresh, which then reloads
 * the whole page — and loses the state you were looking at — on every
 * edit during development.
 */

/** "now" / "12m" / "3h" / "2d" / "5w" — the compact stamp used in lists. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
