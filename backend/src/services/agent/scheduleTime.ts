import type { RandomizeMode, ScheduleConfig } from '../../types/agent.js';

/**
 * Convert a date/time in a given timezone to a UTC Date.
 * Uses Intl.DateTimeFormat for timezone support without external deps.
 */
export function toUTCDate(dateStr: string, timeStr: string, timezone: string): Date {
  // Build an ISO-like string in the target timezone, then resolve to UTC.
  // Strategy: create a Date from the local values, then compute the offset.
  const [hours, minutes] = timeStr.split(':').map(Number);
  const [year, month, day] = dateStr.split('-').map(Number);

  // Create a date and use Intl to figure out the offset
  const target = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));

  // Get the timezone offset by formatting the date in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(target);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);

  const tzYear = get('year');
  const tzMonth = get('month');
  const tzDay = get('day');
  const tzHour = get('hour') === 24 ? 0 : get('hour');
  const tzMinute = get('minute');

  // Compute offset: UTC time of `target` - what the timezone shows for `target`
  const utcMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0, 0);
  const offsetMs = target.getTime() - utcMs;

  // The actual UTC time for "year-month-day hours:minutes in timezone"
  // is the naive UTC interpretation + the offset
  const naiveUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  return new Date(naiveUtc + offsetMs);
}

/**
 * Get today's date string (YYYY-MM-DD) in a specific timezone.
 */
export function todayInTimezone(timezone: string, referenceDate?: Date): string {
  const d = referenceDate ?? new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(d);
}

/**
 * Get the current day of the week (0=Sun..6=Sat) in a timezone.
 */
export function dayOfWeekInTimezone(timezone: string, referenceDate?: Date): number {
  const d = referenceDate ?? new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const dayStr = formatter.format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr] ?? 0;
}

/**
 * Office-hours bounds (local hours) for the random-run window on a date.
 * Weekdays (Mon-Fri): 9-17. Weekends (Sat-Sun): 0-24 (anytime).
 */
export function randomWindowBoundsForDate(
  dateStr: string,
  timezone: string,
): { startHour: number; endHour: number } {
  // Use noon to avoid DST edge cases
  const refDate = new Date(dateStr + 'T12:00:00Z');
  const dow = dayOfWeekInTimezone(timezone, refDate);
  const isWeekend = dow === 0 || dow === 6;
  return { startHour: isWeekend ? 0 : 9, endHour: isWeekend ? 24 : 17 };
}

/**
 * Generate a random HH:MM time string appropriate for the given date.
 * Weekdays (Mon-Fri): 09:00-16:59 (office hours).
 * Weekends (Sat-Sun): 00:00-23:59 (anytime).
 */
export function randomTimeForDate(dateStr: string, timezone: string): string {
  const { startHour, endHour } = randomWindowBoundsForDate(dateStr, timezone);
  const totalMinutes = (endHour - startHour) * 60;
  const randomMinutes = Math.floor(Math.random() * totalMinutes);
  const hour = startHour + Math.floor(randomMinutes / 60);
  const minute = randomMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * UTC instants bounding where randomTimeForDate can place a run on a date.
 * endHour=24 resolves to the next local day at 00:00.
 */
export function randomWindowForDate(
  dateStr: string,
  timezone: string,
): { start: Date; end: Date } {
  const { startHour, endHour } = randomWindowBoundsForDate(dateStr, timezone);
  const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const start = toUTCDate(dateStr, hhmm(startHour), timezone);
  let end: Date;
  if (endHour === 24) {
    const next = new Date(dateStr + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    end = toUTCDate(next.toISOString().slice(0, 10), '00:00', timezone);
  } else {
    end = toUTCDate(dateStr, hhmm(endHour), timezone);
  }
  return { start, end };
}

/**
 * A random whole minute inside the date's random window, strictly after
 * `notBefore` when given (a one-off schedule created during its own day only
 * uses what is left of the window). Null when no minute is left.
 */
export function randomInstantInWindow(dateStr: string, timezone: string, notBefore?: Date): Date | null {
  const MIN = 60_000;
  const { start, end } = randomWindowForDate(dateStr, timezone);
  const from = notBefore
    ? Math.max(start.getTime(), Math.ceil((notBefore.getTime() + 1) / MIN) * MIN)
    : start.getTime();
  const minutes = Math.floor((end.getTime() - from) / MIN);
  if (minutes <= 0) return null;
  return new Date(from + Math.floor(Math.random() * minutes) * MIN);
}

/** Add N days to a date string (YYYY-MM-DD). */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Resolve the effective randomization mode for a schedule config, bridging the
 * legacy `randomize_time` boolean to the newer `randomize_mode` enum.
 * Explicit `randomize_mode` always wins; otherwise legacy `randomize_time:true`
 * means the whole fleet shared one random time ('fleet'), and anything else is 'fixed'.
 */
export function resolveRandomizeMode(config: ScheduleConfig): RandomizeMode {
  const c = config as { randomize_mode?: RandomizeMode; randomize_time?: boolean };
  if (c.randomize_mode) return c.randomize_mode;
  return c.randomize_time ? 'fleet' : 'fixed';
}

/** A valid IANA timezone, or 'UTC' when `tz` is missing or invalid. */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return tz;
  } catch {
    return 'UTC';
  }
}
