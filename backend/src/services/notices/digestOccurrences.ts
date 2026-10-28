import type { ScheduleConfig, ScheduleType } from '../../types/agent.js';
import type { PreExecutionNoticeSettings } from '../../types/integrations.js';
import {
  addDays,
  daysInMonth,
  randomWindowForDate,
  resolveRandomizeMode,
  toUTCDate,
} from '../agent/scheduleTime.js';
import { computeDayRelease, computeRunRelease } from './window.js';

/** The notice settings that decide when hosts may start a run. */
export type DigestWindowSettings = Pick<PreExecutionNoticeSettings, 'lead_minutes' | 'pickup_window_minutes'>;

export interface DigestScheduleInput {
  id: string;
  name: string | null;
  schedule_type: ScheduleType;
  schedule_config: ScheduleConfig;
  timezone: string;
}

export interface Occurrence {
  scheduleId: string;
  /** YYYY-MM-DD in the schedule's timezone. */
  runDay: string;
  mode: 'fixed' | 'fleet' | 'per_machine';
  /**
   * The window shown in the email: the earliest release and the pickup
   * deadline the gate would set if the notice were sent on time. A slow
   * mail server on the day shifts both later.
   */
  start: Date;
  end: Date;
}

/** Whether the schedule fires on `day` (YYYY-MM-DD, schedule-local). Pure. */
export function runsOnDay(s: DigestScheduleInput, day: string): boolean {
  const cfg = s.schedule_config;
  switch (s.schedule_type) {
    case 'once':
      return (cfg as { date: string }).date === day;
    case 'daily':
      return true;
    case 'weekly': {
      const dow = new Date(day + 'T12:00:00Z').getUTCDay();
      return ((cfg as { days: number[] }).days ?? []).includes(dow);
    }
    case 'monthly': {
      const [y, m, d] = day.split('-').map(Number);
      const target = Math.min((cfg as { dayOfMonth: number }).dayOfMonth, daysInMonth(y, m));
      return d === target;
    }
    default:
      return false;
  }
}

/** The schedule's mode and its scheduled start (fixed) or random window (fleet, per_machine). */
function scheduledFor(s: DigestScheduleInput, runDay: string) {
  const mode = resolveRandomizeMode(s.schedule_config);
  if (mode === 'fixed') {
    const at = toUTCDate(runDay, (s.schedule_config as { time: string }).time, s.timezone);
    return { mode, start: at, end: at };
  }
  return { mode, ...randomWindowForDate(runDay, s.timezone) };
}

/**
 * The occurrence (mode and window) for a run day the schedule fires on.
 * The window uses the gate's own release rules (window.ts), so the digest
 * promises what getNextTask will enforce on the day.
 */
export function occurrenceFor(
  s: DigestScheduleInput,
  runDay: string,
  settings: DigestWindowSettings,
): Occurrence {
  return windowFor(s.id, runDay, scheduledFor(s, runDay), settings);
}

function windowFor(
  scheduleId: string,
  runDay: string,
  sched: ReturnType<typeof scheduledFor>,
  settings: DigestWindowSettings,
): Occurrence {
  const { mode } = sched;
  if (mode === 'per_machine') {
    // One day notice, sent when the first host's slot comes due.
    const r = computeDayRelease(sched.start, settings, sched.end, 0);
    return { scheduleId, runDay, mode, start: r.releaseAt, end: r.pickupDeadline };
  }
  // fixed / fleet: a run notice at the (random) fire time.
  const start = computeRunRelease(sched.start, settings, 0).releaseAt;
  const end = computeRunRelease(sched.end, settings, 0).pickupDeadline;
  return { scheduleId, runDay, mode, start, end };
}

/**
 * Occurrences whose scheduled start falls inside the digest day, a calendar
 * day in `digestTz`. Candidate run days are the schedule-local days around it.
 * Filtering on the scheduled start (before the lead shift) keeps each run in
 * exactly one digest, even when the lead pushes it past midnight.
 */
export function occurrencesForDigestDay(
  s: DigestScheduleInput,
  digestDay: string,
  digestTz: string,
  settings: DigestWindowSettings,
): Occurrence[] {
  const spanStart = toUTCDate(digestDay, '00:00', digestTz).getTime();
  const spanEnd = toUTCDate(addDays(digestDay, 1), '00:00', digestTz).getTime();
  const out: Occurrence[] = [];
  for (const runDay of [addDays(digestDay, -1), digestDay, addDays(digestDay, 1)]) {
    if (!runsOnDay(s, runDay)) continue;
    const sched = scheduledFor(s, runDay);
    const t = sched.start.getTime();
    if (t >= spanStart && t < spanEnd) out.push(windowFor(s.id, runDay, sched, settings));
  }
  return out;
}
