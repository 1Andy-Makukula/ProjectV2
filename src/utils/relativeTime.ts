// Timestamp formatting shared by the notification panel and message threads,
// so "3m ago" means the same thing and looks the same everywhere.

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const diffS = diffMs / 1_000;
  const diffM = diffMs / 60_000;
  const diffH = diffMs / 3_600_000;
  const diffD = diffMs / 86_400_000;

  if (diffS < 10) return 'Just now';
  if (diffM < 1) return `${Math.floor(diffS)}s ago`;
  if (diffM < 60) return `${Math.floor(diffM)}m ago`;
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Time only — used inside a message bubble where the day is already a divider. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Day divider label for a message thread. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
