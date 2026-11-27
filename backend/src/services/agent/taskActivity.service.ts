import { getDatabase } from './database.js';
import { taskListConditions } from './tasks.service.js';
import { activityBuckets, bucketIndexOf } from '../analytics/activityBuckets.js';
import { bucketResultSql, parseOutcomeResult, taskBucket, type TaskBucket } from '../outcomes/taskOutcome.js';
import { parseSqliteUtc } from '../edr/agent-kill-evidence.js';
import type { TaskStatus, TaskType } from '../../types/agent.js';

/** The Tasks activity strip shows this many days, ending now. */
export const TASK_ACTIVITY_DAYS = 30;
const DAY_MS = 86_400_000;

export interface TaskActivityBucket {
  from: string; // ISO instant, inclusive
  to: string; // ISO instant, inclusive: the next day starts 1 ms later
  unprotected: number;
  failed: number;
  noVerdict: number;
  inProgress: number;
  protected: number;
  completed: number;
}

export interface TaskActivityResponse {
  interval: 'day';
  /** The IANA zone the days were cut in. */
  timeZone: string;
  /** Oldest first, zero-filled, whole local days. */
  buckets: TaskActivityBucket[];
}

export interface TaskActivityFilters {
  org_id?: string;
  types?: TaskType[];
  search?: string;
}

const FIELD: Record<TaskBucket, Exclude<keyof TaskActivityBucket, 'from' | 'to'>> = {
  unprotected: 'unprotected',
  failed: 'failed',
  'no-verdict': 'noVerdict',
  'in-progress': 'inProgress',
  protected: 'protected',
  completed: 'completed',
};

/**
 * Tasks per local day over the last 30 days, by creation time, counted as the
 * run timeline counts them (taskBucket): for the strip above the Tasks list.
 * It narrows by what the list narrows by (taskListConditions: organization,
 * search) and the type pills, never by the status filter or an outcome tile.
 * Days are whole (activityBuckets), so a day's two instants, passed back to the
 * list as created_from / created_to, list exactly the tasks the bar counted.
 *
 * Not cached: the page reads it again after its own actions (a retry, a
 * cancel) and must see them. The work is bounded: 30 days of tasks through
 * idx_tasks_created (also for an organization caller, see taskListConditions),
 * only the part of each result the bucket needs, asked once a minute per open page.
 */
export function getTaskActivity(filters: TaskActivityFilters, tz: string, nowMs = Date.now()): TaskActivityResponse {
  const { buckets: bounds } = activityBuckets(nowMs - TASK_ACTIVITY_DAYS * DAY_MS, nowMs, tz);
  const types = [...new Set(filters.types ?? [])].sort();

  const counts: TaskActivityBucket[] = bounds.map((b) => ({
    from: new Date(b.from).toISOString(),
    to: new Date(b.to).toISOString(),
    unprotected: 0, failed: 0, noVerdict: 0, inProgress: 0, protected: 0, completed: 0,
  }));
  if (bounds.length > 0) {
    const { conditions, params } = taskListConditions({
      org_id: filters.org_id,
      search: filters.search,
      created_from: counts[0].from,
      created_to: counts[counts.length - 1].to,
    });
    if (types.length > 0) {
      conditions.push(`t.type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }
    // Only a finished task has a result to read, and only the part taskBucket reads.
    const rows = getDatabase().prepare(`
      SELECT t.type, t.status, t.created_at,
        CASE WHEN t.status IN ('completed', 'failed') THEN ${bucketResultSql('t')} END AS result
      FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id
      WHERE ${conditions.join(' AND ')}
    `).all(...params) as { type: TaskType; status: TaskStatus; created_at: string; result: string | null }[];
    for (const row of rows) {
      const i = bucketIndexOf(bounds, parseSqliteUtc(row.created_at));
      if (i < 0) continue;
      counts[i][FIELD[taskBucket({ type: row.type, status: row.status, result: parseOutcomeResult(row.result) })]]++;
    }
  }

  return { interval: 'day', timeZone: tz, buckets: counts };
}
