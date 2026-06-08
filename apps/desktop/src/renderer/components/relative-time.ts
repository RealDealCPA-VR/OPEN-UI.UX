export type Recency = 'today' | 'week' | 'older';

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayDiff(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

/** Coarse recency bucket used to color-code conversation timestamps. */
export function recencyOf(iso: string, now: Date): Recency {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'older';
  const days = dayDiff(then, now);
  if (days <= 0) return 'today';
  if (days < 7) return 'week';
  return 'older';
}

/**
 * Compact, human relative time for the sidebar: "Just now", "12m ago", "3h ago",
 * "Yesterday", "4d ago", "2w ago", then an absolute date for anything older.
 */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return 'Just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const days = dayDiff(then, now);
  if (days <= 0) return `${Math.floor(minutes / 60)}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 28) return `${Math.floor(days / 7)}w ago`;
  return then.toLocaleDateString();
}
