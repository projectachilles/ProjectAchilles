/**
 * One-time attribution of past tasks to the scheduled run that created them.
 *
 * `tasks.schedule_run` is written by the scheduler from the release that
 * added it. Tasks created before that carry no link to their schedule, so a
 * schedule with a time per machine stays one list entry per agent unless a
 * notice announced it. This pass, run once by the migration that adds the
 * column, stamps a past task when it matches a per-machine schedule exactly.
 *
 * It is inference, kept narrow on purpose:
 *   - only `execute_test` tasks with no notice (those already group by it),
 *     no campaign run (a schedule never creates those), no `schedule_run`
 *     and no `original_task_id`;
 *   - only schedules that give each machine its own time and have fired;
 *   - same organization, creator, test and agent, and the task was created
 *     between the schedule's creation and its last run (a minute of slack
 *     after the last run; none before the creation, because a test tried by
 *     hand just before scheduling it is not the schedule's);
 *   - a task that matches two schedules is left alone.
 * Retries then take the run of their original. Known errors that remain: a
 * test started by hand on one of the schedule's agents inside that window is
 * attributed to the schedule's run (for a recurring schedule the window is
 * its whole life so far); and a past task takes the day it was created, not
 * the day of its slot, so a slot caught up after midnight lands a day late.
 *
 * It must run once only. A later run would pull tasks started by hand into a
 * recurring schedule's window, which keeps growing.
 */
import type Database from 'better-sqlite3';
import type { ScheduleConfig } from '../../types/agent.js';
import { scheduleRunKey, utcMs } from './scheduleRun.js';
import { resolveRandomizeMode } from './scheduleTime.js';

export interface ScheduleRunBackfillResult {
  /** Tasks stamped with a schedule's run. */
  attributed: number;
  /** Tasks left alone because two or more schedules matched. */
  ambiguous: number;
  /** Retries that took the run of their original. */
  retries: number;
}

const GRACE_MS = 60_000;

interface ScheduleRow {
  id: string; org_id: string; created_by: string; test_uuid: string; agent_ids: string;
  schedule_config: string; timezone: string | null; created_at: string; last_run_at: string | null;
}
interface Candidate { id: string; agent_id: string; org_id: string; created_by: string | null; created_at: string; test_uuid: string | null }

export function backfillScheduleRuns(db: Database.Database): ScheduleRunBackfillResult {
  const result: ScheduleRunBackfillResult = { attributed: 0, ambiguous: 0, retries: 0 };

  const rows = db.prepare(`
    SELECT id, org_id, created_by, test_uuid, agent_ids, schedule_config, timezone, created_at, last_run_at
    FROM schedules WHERE last_run_at IS NOT NULL
  `).all() as ScheduleRow[];

  // Schedules that give each machine its own time. Deleted ones count too:
  // their row is kept, and so are the tasks they created.
  const schedules = rows.flatMap((row) => {
    try {
      const config = JSON.parse(row.schedule_config) as ScheduleConfig;
      if (resolveRandomizeMode(config) !== 'per_machine') return [];
      const from = utcMs(row.created_at);
      const to = utcMs(row.last_run_at) + GRACE_MS;
      if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
      return [{ ...row, agents: new Set(JSON.parse(row.agent_ids) as string[]), from, to }];
    } catch {
      return []; // a configuration or agent list that cannot be read attributes nothing
    }
  });
  if (schedules.length === 0) return result;

  const tests = [...new Set(schedules.map((s) => s.test_uuid))];
  const testOfTask = `CASE WHEN json_valid(payload) THEN json_extract(payload, '$.test_uuid') END`;

  db.transaction(() => {
    const candidates = db.prepare(`
      SELECT id, agent_id, org_id, created_by, created_at, ${testOfTask} AS test_uuid
      FROM tasks
      WHERE type = 'execute_test' AND notice_id IS NULL AND schedule_run IS NULL AND original_task_id IS NULL
        AND campaign_run_id IS NULL
        AND ${testOfTask} IN (${tests.map(() => '?').join(', ')})
    `).all(...tests) as Candidate[];

    const stamp = db.prepare('UPDATE tasks SET schedule_run = ? WHERE id = ? AND schedule_run IS NULL');
    for (const task of candidates) {
      const created = utcMs(task.created_at);
      if (!Number.isFinite(created)) continue;
      const matches = schedules.filter(
        (s) =>
          s.org_id === task.org_id &&
          s.created_by === task.created_by &&
          s.test_uuid === task.test_uuid &&
          s.agents.has(task.agent_id) &&
          created >= s.from &&
          created <= s.to,
      );
      if (matches.length > 1) {
        result.ambiguous += 1;
      } else if (matches.length === 1) {
        const [s] = matches;
        result.attributed += stamp.run(scheduleRunKey(s.id, s.timezone, new Date(created)), task.id).changes;
      }
    }

    // A retry belongs to the run of the task it retries, whenever it was made.
    if (result.attributed > 0) {
      result.retries = db.prepare(`
        UPDATE tasks
        SET schedule_run = (SELECT o.schedule_run FROM tasks o WHERE o.id = tasks.original_task_id)
        WHERE schedule_run IS NULL AND original_task_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM tasks o WHERE o.id = tasks.original_task_id AND o.schedule_run IS NOT NULL)
      `).run().changes;
    }
  })();

  return result;
}
