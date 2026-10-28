import type { PreExecutionNoticeSettings } from '../../types/integrations.js';

const MIN = 60_000;

/** The settings the release rules read; the digest passes just these. */
type ReleaseSettings = Pick<PreExecutionNoticeSettings, 'lead_minutes' | 'pickup_window_minutes'>;

/** `PA-RUN-` + first 6 hex chars of the notice id (hyphens removed). */
export function runTag(noticeId: string): string {
  return `PA-RUN-${noticeId.replace(/-/g, '').slice(0, 6)}`;
}

export function computeRunRelease(
  sentAt: Date,
  s: ReleaseSettings,
  maxExecutionTimeoutSec: number,
): { releaseAt: Date; pickupDeadline: Date; windowEnd: Date } {
  const releaseAt = new Date(sentAt.getTime() + s.lead_minutes * MIN);
  const pickupDeadline = new Date(releaseAt.getTime() + s.pickup_window_minutes * MIN);
  const windowEnd = new Date(pickupDeadline.getTime() + maxExecutionTimeoutSec * 1000);
  return { releaseAt, pickupDeadline, windowEnd };
}

export function computeDayRelease(
  sentAt: Date,
  s: ReleaseSettings,
  dayWindowEnd: Date,
  maxExecutionTimeoutSec: number,
): { releaseAt: Date; pickupDeadline: Date; windowEnd: Date } {
  const releaseAt = new Date(sentAt.getTime() + s.lead_minutes * MIN);
  // A notice accepted near the end of the day window would otherwise release
  // after its own deadline, so its tasks could never be picked up.
  const pickupDeadline = new Date(
    Math.max(dayWindowEnd.getTime(), releaseAt.getTime() + s.pickup_window_minutes * MIN),
  );
  const windowEnd = new Date(pickupDeadline.getTime() + maxExecutionTimeoutSec * 1000);
  return { releaseAt, pickupDeadline, windowEnd };
}

function parts(at: Date, timezone: string, extra: Intl.DateTimeFormatOptions = {}) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...extra,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) out[p.type] = p.value;
  return out;
}

/** HH:MM in the given timezone. */
export function formatClock(at: Date, timezone: string): string {
  const p = parts(at, timezone);
  return `${p.hour}:${p.minute}`;
}

function isUtcZone(timezone: string): boolean {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone === 'UTC';
  } catch {
    return false;
  }
}

/** e.g. "2026-10-23 09:05 AST (13:05 UTC)", or "2026-10-23 13:05 UTC" for a UTC zone. */
export function formatDual(at: Date, timezone: string): string {
  const u = parts(at, 'UTC');
  if (isUtcZone(timezone)) return `${u.year}-${u.month}-${u.day} ${u.hour}:${u.minute} UTC`;
  const p = parts(at, timezone, { timeZoneName: 'short' });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName} (${u.hour}:${u.minute} UTC)`;
}
