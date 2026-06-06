import crypto from 'crypto';
import { getDatabase } from './database.js';
import { createTasks } from './tasks.service.js';
import { AppError } from '../../middleware/error.middleware.js';
import type {
  Schedule,
  ScheduleType,
  ScheduleConfig,
  ScheduleStatus,
  RandomizeMode,
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
 * For active recurring schedules whose next_run_at is in the past (e.g. after
 * the machine was off and missed a run), recompute next_run_at to the next
 * future occurrence and persist it to the DB so the cron tick reads the
 * same value the UI shows.
 *
 * Persistence matters: previously this function only mutated the returned
 * object, leaving the DB row stale. processSchedules's WHERE clause read the
 * stale value, which (combined with the ISO/space-format SQL bug above) led
 * to schedules firing multiple times at the wrong moment, or never firing.
 *
 * Persistence is conditional: we only write when next_run_at was already in
 * the past. Active future values are left untouched, so a casual page-refresh
 * that triggers `listSchedules()` does NOT randomise the next run on every
 * call (which would defeat `randomize_time` and change displayed "Next" on
 * every refresh).
 */
function freshenNextRun(schedule: Schedule): Schedule {
  if (
    schedule.status !== 'active' ||
    schedule.schedule_type === 'once' ||
    !schedule.next_run_at
  ) {
    return schedule;
  }

  const nextRunDate = new Date(schedule.next_run_at);
  if (nextRunDate > new Date()) return schedule;

  // per_machine: advance each past-due agent to its next occurrence and re-min.
  // Mirrors the fleet semantics below — missed runs are skipped, not backfilled.
  if (resolveRandomizeMode(schedule.schedule_config) === 'per_machine' && schedule.agent_next_runs) {
    const map = { ...schedule.agent_next_runs };
    const nowIso = new Date().toISOString();
    for (const id of Object.keys(map)) {
      if (map[id] > nowIso) continue;
      const next = computeNextRun(schedule.schedule_type, schedule.schedule_config, schedule.timezone);
      if (next) map[id] = next.toISOString();
      else delete map[id];
    }
    const freshMin = minNextRun(map);
    getDatabase()
      .prepare('UPDATE schedules SET next_run_at = ?, agent_next_runs = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(freshMin, JSON.stringify(map), schedule.id);
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
  getDatabase()
    .prepare('UPDATE schedules SET next_run_at = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(freshNextIso, schedule.id);

  return {
    ...schedule,
    next_run_at: freshNextIso,
  };
}

/**
 * Convert a date/time in a given timezone to a UTC Date.
 * Uses Intl.DateTimeFormat for timezone support without external deps.
 */
function toUTCDate(dateStr: string, timeStr: string, timezone: string): Date {
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
function todayInTimezone(timezone: string, referenceDate?: Date): string {
  const d = referenceDate ?? new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(d);
}

/**
 * Get the current day of the week (0=Sun..6=Sat) in a timezone.
 */
function dayOfWeekInTimezone(timezone: string, referenceDate?: Date): number {
  const d = referenceDate ?? new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const dayStr = formatter.format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr] ?? 0;
}

/**
 * Generate a random HH:MM time string appropriate for the given date.
 * Weekdays (Mon–Fri): 09:00–16:59 (office hours).
 * Weekends (Sat–Sun): 00:00–23:59 (anytime).
 */
function randomTimeForDate(dateStr: string, timezone: string): string {
  // Determine day-of-week for the target date (use noon to avoid DST edge cases)
  const refDate = new Date(dateStr + 'T12:00:00Z');
  const dow = dayOfWeekInTimezone(timezone, refDate);
  const isWeekend = dow === 0 || dow === 6;

  const startHour = isWeekend ? 0 : 9;
  const endHour = isWeekend ? 24 : 17;
  const totalMinutes = (endHour - startHour) * 60;
  const randomMinutes = Math.floor(Math.random() * totalMinutes);
  const hour = startHour + Math.floor(randomMinutes / 60);
  const minute = randomMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Add N days to a date string.
 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the next run time (as UTC ISO string) for a given schedule config.
 * Returns null if the schedule should not run again (completed one-time).
 */
export function computeNextRun(
  type: ScheduleType,
  config: ScheduleConfig,
  timezone: string,
  after?: Date
): Date | null {
  const now = after ?? new Date();

  // Both 'fleet' and 'per_machine' modes randomize the time-of-day; only 'fixed'
  // uses the configured `time`. (For 'per_machine', the caller invokes this once
  // per agent so each agent gets an independent random roll.)
  const randomize = type !== 'once' && resolveRandomizeMode(config) !== 'fixed';

  switch (type) {
    case 'once': {
      const c = config as ScheduleConfigOnce;
      const runDate = toUTCDate(c.date, c.time, timezone);
      return runDate > now ? runDate : null;
    }

    case 'daily': {
      const c = config as ScheduleConfigDaily;
      const todayStr = todayInTimezone(timezone, now);
      const time = randomize ? randomTimeForDate(todayStr, timezone) : c.time;
      const candidate = toUTCDate(todayStr, time, timezone);
      if (candidate > now) return candidate;
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
      const thisTime = randomize ? randomTimeForDate(thisMonthDate, timezone) : c.time;
      const candidate = toUTCDate(thisMonthDate, thisTime, timezone);
      if (candidate > now) return candidate;

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

function daysInMonth(year: number, month: number): number {
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

  return rows.map(parseScheduleRow).map(freshenNextRun);
}

export function getSchedule(id: string): Schedule {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
  if (!row) throw new AppError('Schedule not found', 404);
  return freshenNextRun(parseScheduleRow(row));
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

export function processSchedules(): { processed: number; errors: string[] } {
  const db = getDatabase();
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
      AND datetime(next_run_at) <= datetime('now')
  `).all() as ScheduleRow[];

  for (const row of dueRows) {
    const schedule = parseScheduleRow(row);
    const now = new Date();

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

      if (dueAgentIds.length > 0) {
        try {
          createTasks(
            {
              agent_ids: dueAgentIds,
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
          );
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

      // Advance every past-due agent (including ineligible ones) to its next
      // occurrence, so the schedule's minimum moves into the future and the row
      // is not re-selected on every tick.
      for (const id of Object.keys(map)) {
        if (map[id] > nowIso) continue;
        const next = computeNextRun(schedule.schedule_type, schedule.schedule_config, schedule.timezone, now);
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
    } else {
      try {
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
        );
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
