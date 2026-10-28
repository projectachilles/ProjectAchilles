import type { ScheduleConfig, ScheduleType } from '../../types/agent.js';
import {
  addDays,
  daysInMonth,
  randomWindowForDate,
  resolveRandomizeMode,
  toUTCDate,
} from '../agent/scheduleTime.js';

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
  /** The window shown in the email. */
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

/** The occurrence (mode and window) for a run day the schedule fires on. */
export function occurrenceFor(
  s: DigestScheduleInput,
  runDay: string,
  pickupWindowMinutes: number,
): Occurrence {
  const mode = s.schedule_type === 'once' ? 'fixed' : resolveRandomizeMode(s.schedule_config);
  if (mode === 'fixed') {
    const start = toUTCDate(runDay, (s.schedule_config as { time: string }).time, s.timezone);
    const end = new Date(start.getTime() + pickupWindowMinutes * 60_000);
    return { scheduleId: s.id, runDay, mode, start, end };
  }
  const { start, end } = randomWindowForDate(runDay, s.timezone);
  return { scheduleId: s.id, runDay, mode, start, end };
}

/**
 * Occurrences whose window start falls inside the digest day, a calendar day
 * in `digestTz`. Candidate run days are the schedule-local days around it.
 */
export function occurrencesForDigestDay(
  s: DigestScheduleInput,
  digestDay: string,
  digestTz: string,
  pickupWindowMinutes: number,
): Occurrence[] {
  const spanStart = toUTCDate(digestDay, '00:00', digestTz).getTime();
  const spanEnd = toUTCDate(addDays(digestDay, 1), '00:00', digestTz).getTime();
  const out: Occurrence[] = [];
  for (const runDay of [addDays(digestDay, -1), digestDay, addDays(digestDay, 1)]) {
    if (!runsOnDay(s, runDay)) continue;
    const occ = occurrenceFor(s, runDay, pickupWindowMinutes);
    const t = occ.start.getTime();
    if (t >= spanStart && t < spanEnd) out.push(occ);
  }
  return out;
}
