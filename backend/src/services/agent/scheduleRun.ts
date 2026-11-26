import { safeTimezone, todayInTimezone } from './scheduleTime.js';

/**
 * Identifies one run of a schedule: the schedule and the local calendar day
 * (in the schedule's timezone) of the slot a task was created for. A schedule
 * fires at most once a day per agent, so the day names the occurrence. Stored
 * on each task as `tasks.schedule_run`; the task list groups by it, so a run
 * that reaches its agents one by one over hours is still one run.
 */
export function scheduleRunKey(scheduleId: string, timezone: string | null | undefined, at: Date): string {
  return `${scheduleId}:${todayInTimezone(safeTimezone(timezone), at)}`;
}
