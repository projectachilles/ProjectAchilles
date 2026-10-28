import crypto from 'crypto';
import { getDatabase } from './database.js';
import { createTasks } from './tasks.service.js';
import { createSchedulerTick } from '../notices/notices.service.js';
import { toUTCDate, todayInTimezone, dayOfWeekInTimezone, randomTimeForDate, addDays, daysInMonth, resolveRandomizeMode } from './scheduleTime.js';

export { resolveRandomizeMode } from './scheduleTime.js';
import { AppError } from '../../middleware/error.middleware.js';
import type {
  Schedule,
  ScheduleType,
  ScheduleConfig,
  ScheduleStatus,
  ScheduleConfigOnce,
  ScheduleConfigDaily,
  ScheduleConfigWeekly,
  ScheduleConfigMonthly,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  TaskTestMetadata,
} from '../../types/agent.js';

// ============================================================================
// HELPERS
// ============================================================================

interface ScheduleRow {
  id: string;
  name: string | null;
  agent_ids: string;
  org_id: string;
  test_uuid: string;
  test_name: string;
  binary_name: string;
  execution_timeout: number;
  priority: number;
  metadata: string;
  schedule_type: string;
  schedule_config: string;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  target_index: string | null;
  agent_next_runs: string | null;
}

function parseScheduleRow(row: ScheduleRow): Schedule {
  return {
    ...row,
    agent_ids: JSON.parse(row.agent_ids) as string[],
    metadata: JSON.parse(row.metadata) as TaskTestMetadata,
    schedule_config: JSON.parse(row.schedule_config) as ScheduleConfig,
    schedule_type: row.schedule_type as ScheduleType,
    status: row.status as ScheduleStatus,
    agent_next_runs: row.agent_next_runs
      ? (JSON.parse(row.agent_next_runs) as Record<string, string>)
      : null,
  };
}

/**
 * How far past due a schedule (or a per_machine agent slot) must be before
 * listSchedules/getSchedule advance it. Within this window the 60-second
 * scheduler tick still fires the run; advancing it on a read would silently
 * skip it (the Dashboard and Tasks pages poll every 10-15 seconds).
 */
export const FRESHEN_GRACE_MS = 5 * 60_000;

/**
 * For active recurring schedules whose next_run_at is more than
 * FRESHEN_GRACE_MS in the past (e.g. after the machine was off and missed a
 * run), recompute next_run_at to the next future occurrence and persist it to
 * the DB so the cron tick reads the same value the UI shows. Missed runs are
 * skipped, not backfilled, and today's slot is still allowed (no afterFire).
 *
 * Persistence matters: previously this function only mutated the returned
 * object, leaving the DB row stale. processSchedules's WHERE clause read the
 * stale value, which (combined with the ISO/space-format SQL bug above) led
 * to schedules firing multiple times at the wrong moment, or never firing.
 *
 * Persistence is conditional: we only write when next_run_at is past the
 * grace period. Active future values are left untouched, so a casual
 * page-refresh that triggers `listSchedules()` does NOT randomise the next
 * run on every call (which would defeat `randomize_time` and change displayed
 * "Next" on every refresh). A run inside the grace period is left for the
 * tick, so the UI can show a past "Next" for up to FRESHEN_GRACE_MS.
 *
 * The write only applies if the row still holds the values read here; if the
 * tick advanced it in between, the tick's value wins and is returned.
 */
function freshenNextRun(row: ScheduleRow): Schedule {
  const schedule = parseScheduleRow(row);
  if (
    schedule.status !== 'active' ||
    schedule.schedule_type === 'once' ||
    !row.next_run_at
  ) {
    return schedule;
  }

  const cutoffMs = Date.now() - FRESHEN_GRACE_MS;
  if (new Date(row.next_run_at).getTime() >= cutoffMs) return schedule;

  const db = getDatabase();
  const reread = (): Schedule => {
    const current = db.prepare('SELECT * FROM schedules WHERE id = ?').get(schedule.id) as ScheduleRow | undefined;
    return current ? parseScheduleRow(current) : schedule;
  };

  // per_machine: advance each agent slot past the grace period and re-min.
  // Mirrors the fleet semantics below — missed runs are skipped, not backfilled.
  if (resolveRandomizeMode(schedule.schedule_config) === 'per_machine' && schedule.agent_next_runs) {
    const map = { ...schedule.agent_next_runs };
    let advanced = false;
    for (const id of Object.keys(map)) {
      if (new Date(map[id]).getTime() >= cutoffMs) continue;
      const next = computeNextRun(schedule.schedule_type, schedule.schedule_config, schedule.timezone);
      if (next) map[id] = next.toISOString();
      else delete map[id];
      advanced = true;
    }
    if (!advanced) return schedule;
    const freshMin = minNextRun(map);
    const { changes } = db
      .prepare(
        'UPDATE schedules SET next_run_at = ?, agent_next_runs = ?, updated_at = datetime(\'now\') ' +
        'WHERE id = ? AND next_run_at = ? AND agent_next_runs = ?',
      )
      .run(freshMin, JSON.stringify(map), schedule.id, row.next_run_at, row.agent_next_runs);
    if (changes === 0) return reread();
    return { ...schedule, next_run_at: freshMin, agent_next_runs: map };
  }

  const freshNext = computeNextRun(
    schedule.schedule_type,
    schedule.schedule_config,
    schedule.timezone,
  );

  if (!freshNext) return schedule;

  const freshNextIso = freshNext.toISOString();

  // Persist so the cron tick (processSchedules) reads the fresh value too.
  const { changes } = db
    .prepare('UPDATE schedules SET next_run_at = ?, updated_at = datetime(\'now\') WHERE id = ? AND next_run_at = ?')
    .run(freshNextIso, schedule.id, row.next_run_at);
  if (changes === 0) return reread();

  return {
    ...schedule,
    next_run_at: freshNextIso,
  };
}

export interface ComputeNextRunOptions {
  /**
   * Set when advancing a schedule right after it fired (processSchedules).
   * For randomized modes, every slot on the fire's local calendar day
   * (`todayInTimezone(timezone, after)`) is skipped, so a fresh roll later the
   * same day can't schedule a second run. Fixed mode ignores it: its slot
   * equals the fire time, so it already moves to the next occurrence.
   */
  afterFire?: boolean;
}

/**
 * Compute the next run time (as UTC ISO string) for a given schedule config.
 * Returns null if the schedule should not run again (completed one-time).
 *
 * Without `opts.afterFire` today's slot is still allowed (creation, update,
 * freshenNextRun).
 */
export function computeNextRun(
  type: ScheduleType,
  config: ScheduleConfig,
  timezone: string,
  after?: Date,
  opts?: ComputeNextRunOptions,
): Date | null {
  const now = after ?? new Date();

  // Both 'fleet' and 'per_machine' modes randomize the time-of-day; only 'fixed'
  // uses the configured `time`. (For 'per_machine', the caller invokes this once
  // per agent so each agent gets an independent random roll.)
  const randomize = type !== 'once' && resolveRandomizeMode(config) !== 'fixed';
  // A randomized schedule that just fired must not land on the same local day.
  const skipToday = randomize && opts?.afterFire === true;

  switch (type) {
    case 'once': {
      const c = config as ScheduleConfigOnce;
      const runDate = toUTCDate(c.date, c.time, timezone);
      return runDate > now ? runDate : null;
    }

    case 'daily': {
      const c = config as ScheduleConfigDaily;
      const todayStr = todayInTimezone(timezone, now);
      if (!skipToday) {
        const time = randomize ? randomTimeForDate(todayStr, timezone) : c.time;
        const candidate = toUTCDate(todayStr, time, timezone);
        if (candidate > now) return candidate;
      }
      const tomorrowStr = addDays(todayStr, 1);
      const tomorrowTime = randomize ? randomTimeForDate(tomorrowStr, timezone) : c.time;
      return toUTCDate(tomorrowStr, tomorrowTime, timezone);
    }

    case 'weekly': {
      const c = config as ScheduleConfigWeekly;
      if (c.days.length === 0) return null;

      const todayStr = todayInTimezone(timezone, now);
      const currentDay = dayOfWeekInTimezone(timezone, now);

      // Check each of the next 8 days (covers wrapping around a week)
      for (let offset = 0; offset <= 7; offset++) {
        if (skipToday && offset === 0) continue;
        const checkDay = (currentDay + offset) % 7;
        if (c.days.includes(checkDay)) {
          const dateStr = addDays(todayStr, offset);
          const time = randomize ? randomTimeForDate(dateStr, timezone) : c.time;
          const candidate = toUTCDate(dateStr, time, timezone);
          if (candidate > now) return candidate;
        }
      }
      return null;
    }

    case 'monthly': {
      const c = config as ScheduleConfigMonthly;
      const todayStr = todayInTimezone(timezone, now);
      const [year, month] = todayStr.split('-').map(Number);

      // Try this month
      const dayStr = String(Math.min(c.dayOfMonth, daysInMonth(year, month))).padStart(2, '0');
      const thisMonthDate = `${year}-${String(month).padStart(2, '0')}-${dayStr}`;
      if (!(skipToday && thisMonthDate === todayStr)) {
        const thisTime = randomize ? randomTimeForDate(thisMonthDate, timezone) : c.time;
        const candidate = toUTCDate(thisMonthDate, thisTime, timezone);
        if (candidate > now) return candidate;
      }

      // Next month
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      const nextDayStr = String(Math.min(c.dayOfMonth, daysInMonth(nextYear, nextMonth))).padStart(2, '0');
      const nextMonthDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${nextDayStr}`;
      const nextTime = randomize ? randomTimeForDate(nextMonthDate, timezone) : c.time;
      return toUTCDate(nextMonthDate, nextTime, timezone);
    }
  }
}

/**
 * Compute an independent next-run time for each agent. Used by `per_machine`
 * schedules so every machine executes at its own random time-of-day rather than
 * the whole fleet firing together. Calls `computeNextRun` once per agent — each
 * call re-rolls `randomTimeForDate`, yielding distinct times.
 *
 * Returns a map of agentId → UTC ISO string. Agents whose schedule has no next
 * occurrence (should not happen for recurring types) are omitted.
 */
export function computePerAgentNextRuns(
  type: ScheduleType,
  config: ScheduleConfig,
  timezone: string,
  agentIds: string[],
  after?: Date,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const agentId of agentIds) {
    const next = computeNextRun(type, config, timezone, after);
    if (next) map[agentId] = next.toISOString();
  }
  return map;
}

/**
 * The minimum ISO timestamp among a per-agent map, or null if empty.
 * Kept as the schedule's `next_run_at` so the cron due-query and UI work unchanged.
 */
function minNextRun(map: Record<string, string>): string | null {
  const values = Object.values(map);
  if (values.length === 0) return null;
  return values.reduce((min, v) => (v < min ? v : min));
}

// ============================================================================
// SERVICE METHODS
// ============================================================================

export function createSchedule(
  request: CreateScheduleRequest,
  userId: string
): Schedule {
  const db = getDatabase();

  const {
    name,
    agent_ids,
    org_id,
    test_uuid,
    test_name,
    binary_name,
    execution_timeout = 300,
    priority = 1,
    metadata,
    schedule_type,
    schedule_config,
    timezone = 'UTC',
    target_index,
  } = request;

  if (!agent_ids || agent_ids.length === 0) {
    throw new AppError('At least one agent_id is required', 400);
  }
  if (!test_uuid || !test_name || !binary_name) {
    throw new AppError('test_uuid, test_name, and binary_name are required', 400);
  }
  if (!schedule_type || !schedule_config) {
    throw new AppError('schedule_type and schedule_config are required', 400);
  }

  // Per-machine mode (recurring only): each agent gets its own random time.
  // We store the per-agent map and keep next_run_at as its minimum.
  const perMachine =
    schedule_type !== 'once' && resolveRandomizeMode(schedule_config) === 'per_machine';
  const agentNextRuns = perMachine
    ? computePerAgentNextRuns(schedule_type, schedule_config, timezone, agent_ids)
    : null;

  const perMachineMin = perMachine ? minNextRun(agentNextRuns!) : null;
  const nextRun = perMachine
    ? (perMachineMin ? new Date(perMachineMin) : null)
    : computeNextRun(schedule_type, schedule_config, timezone);
  if (!nextRun && schedule_type === 'once') {
    throw new AppError('Scheduled time must be in the future', 400);
  }

  const id = crypto.randomUUID();
  const defaultMetadata: TaskTestMetadata = {
    category: '', subcategory: '', severity: '', techniques: [], tactics: [],
    threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [],
  };

  db.prepare(`
    INSERT INTO schedules (
      id, name, agent_ids, org_id, test_uuid, test_name, binary_name,
      execution_timeout, priority, metadata, schedule_type, schedule_config,
      timezone, next_run_at, status, created_by, target_index, agent_next_runs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    id,
    name ?? null,
    JSON.stringify(agent_ids),
    org_id,
    test_uuid,
    test_name,
    binary_name,
    execution_timeout,
    priority,
    JSON.stringify(metadata ?? defaultMetadata),
    schedule_type,
    JSON.stringify(schedule_config),
    timezone,
    nextRun ? nextRun.toISOString() : null,
    userId,
    target_index ?? null,
    agentNextRuns ? JSON.stringify(agentNextRuns) : null,
  );

  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow;
  return parseScheduleRow(row);
}

export function listSchedules(
  filters: { org_id?: string; status?: ScheduleStatus } = {}
): Schedule[] {
  const db = getDatabase();

  const conditions: string[] = ["status != 'deleted'"];
  const params: string[] = [];

  if (filters.org_id) {
    conditions.push('org_id = ?');
    params.push(filters.org_id);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const rows = db.prepare(
    `SELECT * FROM schedules ${whereClause} ORDER BY created_at DESC`
  ).all(...params) as ScheduleRow[];

  return rows.map(freshenNextRun);
}

export function getSchedule(id: string): Schedule {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
  if (!row) throw new AppError('Schedule not found', 404);
  return freshenNextRun(row);
}

export function updateSchedule(
  id: string,
  updates: UpdateScheduleRequest
): Schedule {
  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
  if (!existing) throw new AppError('Schedule not found', 404);
  if (existing.status === 'deleted') throw new AppError('Schedule not found', 404);

  const sets: string[] = ["updated_at = datetime('now')"];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    params.push(updates.name);
  }
  if (updates.agent_ids) {
    sets.push('agent_ids = ?');
    params.push(JSON.stringify(updates.agent_ids));
  }
  if (updates.priority !== undefined) {
    sets.push('priority = ?');
    params.push(updates.priority);
  }
  if (updates.execution_timeout !== undefined) {
    sets.push('execution_timeout = ?');
    params.push(updates.execution_timeout);
  }
  if (updates.timezone !== undefined) {
    sets.push('timezone = ?');
    params.push(updates.timezone);
  }
  if (updates.schedule_config) {
    sets.push('schedule_config = ?');
    params.push(JSON.stringify(updates.schedule_config));
  }
  if (updates.status) {
    sets.push('status = ?');
    params.push(updates.status);
  }

  params.push(id);
  db.prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  // Recompute next_run_at if config, timezone, status, or the agent list changed.
  // (agent_ids matters because per_machine schedules track a time per agent.)
  if (updates.schedule_config || updates.timezone || updates.status || updates.agent_ids) {
    const updated = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow;
    const schedule = parseScheduleRow(updated);

    if (schedule.status === 'active') {
      const mode = schedule.schedule_type !== 'once'
        ? resolveRandomizeMode(schedule.schedule_config)
        : 'fixed';

      if (mode === 'per_machine') {
        // Reconcile the per-agent map. When the time basis changed
        // (schedule_config/timezone/status), recompute every agent; when only
        // the agent list changed, retain existing times and roll just the new agents.
        const existingMap = schedule.agent_next_runs ?? {};
        const recomputeAll =
          updates.schedule_config !== undefined ||
          updates.timezone !== undefined ||
          updates.status !== undefined;
        const newMap: Record<string, string> = {};
        for (const agentId of schedule.agent_ids) {
          if (!recomputeAll && existingMap[agentId]) {
            newMap[agentId] = existingMap[agentId];
          } else {
            const next = computeNextRun(schedule.schedule_type, schedule.schedule_config, schedule.timezone);
            if (next) newMap[agentId] = next.toISOString();
          }
        }
        db.prepare('UPDATE schedules SET next_run_at = ?, agent_next_runs = ? WHERE id = ?')
          .run(minNextRun(newMap), JSON.stringify(newMap), id);
      } else {
        // fixed / fleet: single next_run_at, and clear any stale per-agent map.
        const nextRun = computeNextRun(schedule.schedule_type, schedule.schedule_config, schedule.timezone);
        db.prepare('UPDATE schedules SET next_run_at = ?, agent_next_runs = NULL WHERE id = ?')
          .run(nextRun ? nextRun.toISOString() : null, id);
      }
    }
  }

  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow;
  return parseScheduleRow(row);
}

export function deleteSchedule(id: string): void {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
  if (!existing) throw new AppError('Schedule not found', 404);

  db.prepare("UPDATE schedules SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").run(id);
}

// ============================================================================
// SCHEDULER TICK
// ============================================================================

/**
 * `clock` is for tests: it drives both the due-row query and every time used
 * below. Without it the query keeps using SQLite's own clock, as before.
 */
export function processSchedules(clock?: Date): { processed: number; errors: string[] } {
  const db = getDatabase();
  const now = clock ?? new Date();
  const tick = createSchedulerTick(now);
  const errors: string[] = [];
  let processed = 0;

  // SQLite has two textual datetime conventions: ISO 8601 with `T` separator
  // (what `Date.toISOString()` writes — used by createSchedule/processSchedules
  // when persisting next_run_at) and the space-separated form (`'YYYY-MM-DD
  // HH:MM:SS'`) returned by `datetime('now')`. Raw `<=` does a char-by-char
  // string compare, and 'T' (0x54) > ' ' (0x20), so any next_run_at written in
  // ISO form would NEVER match this WHERE — even when many hours overdue. This
  // silently broke all weekly/monthly schedules on tpsgl.projectachilles.io
  // (last fire 2026-05-01; verified directly against the production DB).
  // Wrap both sides in `datetime()` to normalise to space-form before compare.
  const dueRows = db.prepare(`
    SELECT * FROM schedules
    WHERE status = 'active'
      AND next_run_at IS NOT NULL
      AND datetime(next_run_at) <= datetime(${clock ? '?' : "'now'"})
  `).all(...(clock ? [clock.toISOString()] : [])) as ScheduleRow[];

  for (const row of dueRows) {
    const schedule = parseScheduleRow(row);

    // Filter out decommissioned agents — they'll never pick up tasks
    const placeholders = schedule.agent_ids.map(() => '?').join(', ');
    const activeAgentRows = db.prepare(
      `SELECT id FROM agents WHERE id IN (${placeholders}) AND status != 'decommissioned'`
    ).all(...schedule.agent_ids) as { id: string }[];
    const eligibleAgentIds = activeAgentRows.map(r => r.id);

    const mode = schedule.schedule_type !== 'once'
      ? resolveRandomizeMode(schedule.schedule_config)
      : 'fixed';

    // ----- per_machine: each agent fires at its own time -----
    if (mode === 'per_machine' && schedule.agent_next_runs) {
      const map = { ...schedule.agent_next_runs };
      const nowIso = now.toISOString();
      const eligibleSet = new Set(eligibleAgentIds);

      // Dispatch only agents whose individual time is due AND still eligible.
      const dueAgentIds = Object.keys(map).filter(
        (id) => eligibleSet.has(id) && map[id] <= nowIso,
      );

      // Agents advanced below as if they had fired: the past-due ones, plus
      // (R24) the late tail swept onto a run notice. An unparseable entry is
      // advanced too (from now), so it heals instead of sticking forever.
      const fired = new Set(
        Object.keys(map).filter((id) => map[id] <= nowIso || !Number.isFinite(Date.parse(map[id]))),
      );

      if (dueAgentIds.length > 0) {
        // Rulings R23/R24: today's day notice is already announced and its
        // pickup deadline is (nearly) past, e.g. a slot at the end of the
        // window or a catch-up after a restart. Its window is never extended,
        // so these runs get this tick's run notice instead. To send one email
        // per window end rather than one per late minute, every remaining
        // eligible agent slotted before the window end goes with them (held
        // until the run notice's release_at like any other task).
        const closed = tick.closedDayNotice(schedule);
        const tail = closed
          ? Object.keys(map).filter(
              (id) => eligibleSet.has(id) && map[id] > nowIso && Date.parse(map[id]) < closed.dayWindowEnd.getTime(),
            )
          : [];
        const request = {
          agent_ids: [...dueAgentIds, ...tail],
          test_uuid: schedule.test_uuid,
          test_name: schedule.test_name,
          binary_name: schedule.binary_name,
          execution_timeout: schedule.execution_timeout,
          priority: schedule.priority,
          metadata: schedule.metadata,
          target_index: schedule.target_index ?? undefined,
        };
        try {
          if (closed) {
            // Same flow as the fleet path below, minus the pending-notice skip:
            // these per-machine runs are already due.
            const noticeId = tick.runNoticeFor(schedule.id, schedule.timezone, schedule.created_by, schedule.org_id);
            createTasks(request, schedule.org_id, schedule.created_by, { noticeId });
            tick.confirmRunSchedule(schedule.id, schedule.org_id);
            // Only on success: a failed tail keeps its slots and retries then.
            for (const id of tail) fired.add(id);
          } else {
            // One transaction: if createTasks throws, today's day notice is not
            // left behind with no tasks (it would block the day and alarm).
            db.transaction(() => {
              const noticeId = tick.dayNoticeFor({ ...schedule, agent_next_runs: map });
              createTasks(request, schedule.org_id, schedule.created_by, { noticeId });
            })();
          }
          processed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Schedule ${schedule.id}: ${msg}`);
          console.error(`[Scheduler] Failed to create tasks for schedule ${schedule.id}:`, msg);
        }
      } else {
        // Due by minimum, but no eligible agent is actually due (e.g. the due
        // agent was decommissioned). Still advance below to avoid re-processing.
        processed++;
      }

      // Advance every past-due agent (including ineligible ones) and any swept
      // tail to its next occurrence, so the schedule's minimum moves into the
      // future and the row is not re-selected on every tick.
      for (const id of fired) {
        // From the agent's own slot (a swept tail slot is later than now), so
        // its next occurrence is never rolled back into the slot just used.
        // A malformed slot (NaN) falls back to now: an Invalid Date would make
        // computeNextRun throw and abort the whole tick.
        const nowMs = now.getTime();
        const slotMs = Date.parse(map[id]);
        const after = new Date(Number.isFinite(slotMs) ? Math.max(nowMs, slotMs) : nowMs);
        // afterFire (R25): a randomized schedule never re-rolls onto the same
        // local day as the run that just fired, tail slots included.
        const next = computeNextRun(
          schedule.schedule_type, schedule.schedule_config, schedule.timezone, after, { afterFire: true },
        );
        if (next) map[id] = next.toISOString();
        else delete map[id];
      }

      db.prepare(
        "UPDATE schedules SET next_run_at = ?, last_run_at = ?, agent_next_runs = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(minNextRun(map), now.toISOString(), JSON.stringify(map), schedule.id);
      continue;
    }
    // ----- fixed / fleet: whole fleet fires together (original path) -----

    if (eligibleAgentIds.length === 0) {
      console.warn(
        `[Scheduler] Skipping schedule "${schedule.name ?? schedule.id}" — all agents are decommissioned`
      );
      processed++;
    } else if (tick.hasPendingRunNotice(schedule.id, schedule.org_id)) {
      // The previous occurrence's notice is still undelivered: don't stack a
      // second batch behind it. Record the skip and advance as usual.
      tick.recordSkippedOccurrence(schedule.id, schedule.created_by, schedule.timezone, schedule.org_id);
      console.warn(
        `[Scheduler] Skipping schedule "${schedule.name ?? schedule.id}" — previous run still waiting for notice delivery`
      );
    } else {
      try {
        const noticeId = tick.runNoticeFor(schedule.id, schedule.timezone, schedule.created_by, schedule.org_id);
        createTasks(
          {
            agent_ids: eligibleAgentIds,
            test_uuid: schedule.test_uuid,
            test_name: schedule.test_name,
            binary_name: schedule.binary_name,
            execution_timeout: schedule.execution_timeout,
            priority: schedule.priority,
            metadata: schedule.metadata,
            target_index: schedule.target_index ?? undefined,
          },
          schedule.org_id,
          schedule.created_by,
          { noticeId },
        );
        // Listed on the shared notice only once its tasks exist, so a failed
        // schedule never appears in the trigger text or blocks its next run.
        tick.confirmRunSchedule(schedule.id, schedule.org_id);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Schedule ${schedule.id}: ${msg}`);
        console.error(`[Scheduler] Failed to create tasks for schedule ${schedule.id}:`, msg);
      }
    }

    // Advance next_run_at regardless of success (avoid retry spam)
    if (schedule.schedule_type === 'once') {
      db.prepare("UPDATE schedules SET status = 'completed', last_run_at = ?, updated_at = datetime('now') WHERE id = ?")
        .run(now.toISOString(), schedule.id);
    } else {
      const nextRun = computeNextRun(
        schedule.schedule_type,
        schedule.schedule_config,
        schedule.timezone,
        now,
        { afterFire: true },
      );
      db.prepare("UPDATE schedules SET next_run_at = ?, last_run_at = ?, updated_at = datetime('now') WHERE id = ?")
        .run(nextRun ? nextRun.toISOString() : null, now.toISOString(), schedule.id);
    }
  }

  if (dueRows.length > 0) {
    console.log(`[Scheduler] Processed ${processed}/${dueRows.length} schedules${errors.length ? ` (${errors.length} errors)` : ''}`);
  }

  return { processed, errors };
}
