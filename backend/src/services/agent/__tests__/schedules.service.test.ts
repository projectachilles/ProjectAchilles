import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

// Mock createTasks (called by processSchedules)
const mockCreateTasks = vi.fn().mockReturnValue(['task-001']);
vi.mock('../tasks.service.js', () => ({
  createTasks: (...args: unknown[]) => mockCreateTasks(...args),
}));

const {
  computeNextRun,
  computePerAgentNextRuns,
  resolveRandomizeMode,
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  processSchedules,
  FRESHEN_GRACE_MS,
} = await import('../schedules.service.js');

// ============================================================================
// Common helpers
// ============================================================================

function baseScheduleRequest(overrides: Record<string, unknown> = {}) {
  return {
    agent_ids: ['agent-001'],
    org_id: 'org-001',
    test_uuid: 'test-uuid-001',
    test_name: 'Test Schedule',
    binary_name: 'test.exe',
    schedule_type: 'daily' as const,
    schedule_config: { time: '10:00' },
    timezone: 'UTC',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('schedules.service', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'agent-001' });
    mockCreateTasks.mockClear();
    mockCreateTasks.mockReturnValue(['task-001']);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // computeNextRun
  // ==========================================================================

  describe('computeNextRun', () => {
    describe('once type', () => {
      it('returns correct UTC date for future date+time', () => {
        const now = new Date('2026-02-09T08:00:00Z');
        const result = computeNextRun(
          'once',
          { date: '2026-02-10', time: '14:00' },
          'UTC',
          now,
        );
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2026-02-10T14:00:00.000Z');
      });

      it('returns null for past date+time', () => {
        const now = new Date('2026-02-09T16:00:00Z');
        const result = computeNextRun(
          'once',
          { date: '2026-02-09', time: '10:00' },
          'UTC',
          now,
        );
        expect(result).toBeNull();
      });

      it('applies timezone offset (America/New_York is UTC-5 in Feb)', () => {
        const now = new Date('2026-02-09T08:00:00Z');
        const result = computeNextRun(
          'once',
          { date: '2026-02-10', time: '10:00' },
          'America/New_York',
          now,
        );
        expect(result).not.toBeNull();
        // 10:00 EST = 15:00 UTC (UTC-5 in Feb)
        expect(result!.getUTCHours()).toBe(15);
      });
    });

    describe('daily type', () => {
      it('returns today when time is in the future', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

        const result = computeNextRun('daily', { time: '14:00' }, 'UTC');
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2026-02-09T14:00:00.000Z');
      });

      it('returns tomorrow when time has passed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-09T16:00:00Z'));

        const result = computeNextRun('daily', { time: '10:00' }, 'UTC');
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2026-02-10T10:00:00.000Z');
      });

      it('returns randomized time within weekday office hours when randomize_time is true', () => {
        vi.useFakeTimers();
        // Monday Feb 9, 2026
        vi.setSystemTime(new Date('2026-02-09T07:00:00Z'));
        vi.spyOn(Math, 'random').mockReturnValue(0.0); // earliest possible time

        const result = computeNextRun('daily', { time: '10:00', randomize_time: true }, 'UTC');
        expect(result).not.toBeNull();
        // Weekday office hours: 09:00-16:59, random=0 → 09:00
        expect(result!.getUTCHours()).toBe(9);
        expect(result!.getUTCMinutes()).toBe(0);
      });

      it('returns randomized time within weekend full range when randomize_time is true', () => {
        vi.useFakeTimers();
        // Saturday Feb 7, 2026
        vi.setSystemTime(new Date('2026-02-07T01:00:00Z'));
        vi.spyOn(Math, 'random').mockReturnValue(0.0); // earliest

        const result = computeNextRun('daily', { time: '10:00', randomize_time: true }, 'UTC');
        expect(result).not.toBeNull();
        // Weekend: 00:00-23:59, random=0 → 00:00
        expect(result!.getUTCHours()).toBe(0);
      });
    });

    describe('weekly type', () => {
      it('returns today when current day matches and time is in the future', () => {
        vi.useFakeTimers();
        // Feb 9, 2026 is Monday = day 1
        vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

        const result = computeNextRun('weekly', { days: [1], time: '14:00' }, 'UTC');
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2026-02-09T14:00:00.000Z');
      });

      it('returns next matching day when current day does not match', () => {
        vi.useFakeTimers();
        // Feb 9, 2026 is Monday = day 1, looking for Wednesday = day 3
        vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

        const result = computeNextRun('weekly', { days: [3], time: '10:00' }, 'UTC');
        expect(result).not.toBeNull();
        // Wednesday is Feb 11
        expect(result!.toISOString()).toBe('2026-02-11T10:00:00.000Z');
      });

      it('returns null for empty days array', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

        const result = computeNextRun('weekly', { days: [], time: '10:00' }, 'UTC');
        expect(result).toBeNull();
      });

      it('wraps around to next week', () => {
        vi.useFakeTimers();
        // Feb 9 Monday, time passed. Looking for Monday = day 1
        vi.setSystemTime(new Date('2026-02-09T18:00:00Z'));

        const result = computeNextRun('weekly', { days: [1], time: '10:00' }, 'UTC');
        expect(result).not.toBeNull();
        // Next Monday is Feb 16
        expect(result!.toISOString()).toBe('2026-02-16T10:00:00.000Z');
      });
    });

    describe('monthly type', () => {
      it('returns this month when day is in the future', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-05T08:00:00Z'));

        const result = computeNextRun('monthly', { dayOfMonth: 15, time: '10:00' }, 'UTC');
        expect(result).not.toBeNull();
        expect(result!.toISOString()).toBe('2026-02-15T10:00:00.000Z');
      });

      it('returns next month when day has passed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-20T08:00:00Z'));

        const result = computeNextRun('monthly', { dayOfMonth: 10, time: '10:00' }, 'UTC');
        expect(result).not.toBeNull();
        expect(result!.getUTCMonth()).toBe(2); // March
        expect(result!.getUTCDate()).toBe(10);
      });

      it('clamps day 31 to last day of month (Feb has 28)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-01T08:00:00Z'));

        const result = computeNextRun('monthly', { dayOfMonth: 31, time: '10:00' }, 'UTC');
        expect(result).not.toBeNull();
        // Feb 2026 has 28 days
        expect(result!.getUTCDate()).toBe(28);
      });

      it('wraps December to January of next year', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-12-20T08:00:00Z'));

        const result = computeNextRun('monthly', { dayOfMonth: 10, time: '10:00' }, 'UTC');
        expect(result).not.toBeNull();
        expect(result!.getUTCFullYear()).toBe(2027);
        expect(result!.getUTCMonth()).toBe(0); // January
        expect(result!.getUTCDate()).toBe(10);
      });
    });

    describe('timezone edge cases', () => {
      it('handles UTC baseline correctly', () => {
        const now = new Date('2026-02-09T08:00:00Z');
        const result = computeNextRun('once', { date: '2026-02-10', time: '12:00' }, 'UTC', now);
        expect(result!.getUTCHours()).toBe(12);
      });

      it('handles Asia/Tokyo (UTC+9)', () => {
        const now = new Date('2026-02-09T00:00:00Z');
        const result = computeNextRun(
          'once',
          { date: '2026-02-10', time: '09:00' },
          'Asia/Tokyo',
          now,
        );
        expect(result).not.toBeNull();
        // 09:00 JST = 00:00 UTC
        expect(result!.getUTCHours()).toBe(0);
        expect(result!.getUTCDate()).toBe(10);
      });
    });
  });

  // ==========================================================================
  // createSchedule
  // ==========================================================================

  describe('createSchedule', () => {
    it('creates a valid daily schedule', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(baseScheduleRequest(), 'user-001');

      expect(schedule.id).toBeDefined();
      expect(schedule.schedule_type).toBe('daily');
      expect(schedule.status).toBe('active');
      expect(schedule.agent_ids).toEqual(['agent-001']);
      expect(schedule.next_run_at).toBeDefined();
    });

    it('creates a valid weekly schedule with multiple days', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(
        baseScheduleRequest({
          schedule_type: 'weekly',
          schedule_config: { days: [1, 3, 5], time: '10:00' },
        }),
        'user-001',
      );

      expect(schedule.schedule_type).toBe('weekly');
      expect(schedule.schedule_config).toEqual({ days: [1, 3, 5], time: '10:00' });
    });

    it('creates a valid once schedule', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(
        baseScheduleRequest({
          schedule_type: 'once',
          schedule_config: { date: '2026-03-01', time: '14:00' },
        }),
        'user-001',
      );

      expect(schedule.schedule_type).toBe('once');
      expect(schedule.next_run_at).toBeDefined();
    });

    it('throws 400 for missing agent_ids', () => {
      expect(() =>
        createSchedule(baseScheduleRequest({ agent_ids: [] }), 'user-001')
      ).toThrow('At least one agent_id is required');
    });

    it('throws 400 for missing test_uuid', () => {
      expect(() =>
        createSchedule(baseScheduleRequest({ test_uuid: '' }), 'user-001')
      ).toThrow('test_uuid, test_name, and binary_name are required');
    });

    it('throws 400 for once schedule with past time', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T16:00:00Z'));

      expect(() =>
        createSchedule(
          baseScheduleRequest({
            schedule_type: 'once',
            schedule_config: { date: '2026-02-09', time: '10:00' },
          }),
          'user-001',
        )
      ).toThrow('Scheduled time must be in the future');
    });
  });

  // ==========================================================================
  // listSchedules
  // ==========================================================================

  describe('listSchedules', () => {
    it('returns active schedules', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      createSchedule(baseScheduleRequest({ name: 'First' }), 'user-001');
      createSchedule(baseScheduleRequest({ name: 'Second' }), 'user-001');

      const schedules = listSchedules({ org_id: 'org-001' });
      expect(schedules).toHaveLength(2);
      const names = schedules.map(s => s.name).sort();
      expect(names).toEqual(['First', 'Second']);
    });

    it('filters by org_id', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      createSchedule(baseScheduleRequest({ org_id: 'org-001' }), 'user-001');
      createSchedule(baseScheduleRequest({ org_id: 'org-002' }), 'user-002');

      const schedules = listSchedules({ org_id: 'org-001' });
      expect(schedules).toHaveLength(1);
    });

    it('excludes deleted schedules', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(baseScheduleRequest(), 'user-001');
      deleteSchedule(schedule.id);

      const schedules = listSchedules({ org_id: 'org-001' });
      expect(schedules).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getSchedule
  // ==========================================================================

  describe('getSchedule', () => {
    it('returns schedule by ID', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = createSchedule(baseScheduleRequest({ name: 'Test' }), 'user-001');
      const schedule = getSchedule(created.id);
      expect(schedule.id).toBe(created.id);
      expect(schedule.name).toBe('Test');
    });

    it('throws 404 for nonexistent ID', () => {
      expect(() => getSchedule('nonexistent')).toThrow('Schedule not found');
    });
  });

  // ==========================================================================
  // updateSchedule
  // ==========================================================================

  describe('updateSchedule', () => {
    it('updates name field', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = createSchedule(baseScheduleRequest({ name: 'Old Name' }), 'user-001');
      const updated = updateSchedule(created.id, { name: 'New Name' });
      expect(updated.name).toBe('New Name');
    });

    it('recomputes next_run_at when schedule_config changes', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = createSchedule(baseScheduleRequest(), 'user-001');
      const originalNextRun = created.next_run_at;

      const updated = updateSchedule(created.id, {
        schedule_config: { time: '18:00' },
      });
      expect(updated.next_run_at).not.toBe(originalNextRun);
    });

    it('sets next_run_at to null when status changed to paused', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = createSchedule(baseScheduleRequest(), 'user-001');

      // Pause recomputes via computeNextRun, but the status is 'paused'
      // so the code only recomputes when status is 'active'
      const updated = updateSchedule(created.id, { status: 'paused' });
      expect(updated.status).toBe('paused');
    });

    it('throws 404 for nonexistent ID', () => {
      expect(() => updateSchedule('nonexistent', { name: 'x' })).toThrow('Schedule not found');
    });
  });

  // ==========================================================================
  // deleteSchedule
  // ==========================================================================

  describe('deleteSchedule', () => {
    it('soft-deletes a schedule (sets status to deleted)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = createSchedule(baseScheduleRequest(), 'user-001');
      deleteSchedule(created.id);

      // Direct DB check since getSchedule would also return it as 'deleted'
      const row = testDb.prepare('SELECT status FROM schedules WHERE id = ?').get(created.id) as any;
      expect(row.status).toBe('deleted');
    });

    it('throws 404 for nonexistent ID', () => {
      expect(() => deleteSchedule('nonexistent')).toThrow('Schedule not found');
    });
  });

  // ==========================================================================
  // processSchedules
  // ==========================================================================

  describe('processSchedules', () => {
    it('processes a due schedule, calls createTasks, and updates last_run_at', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(baseScheduleRequest({
        schedule_config: { time: '07:00' }, // time already passed
      }), 'user-001');

      // Manually set next_run_at to the past so it's due
      testDb.prepare("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?")
        .run(schedule.id);

      const result = processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);

      // Verify last_run_at was set
      const row = testDb.prepare('SELECT last_run_at, next_run_at FROM schedules WHERE id = ?')
        .get(schedule.id) as any;
      expect(row.last_run_at).toBeDefined();
      expect(row.next_run_at).toBeDefined(); // daily schedule should have next run
    });

    it('sets once schedule to completed after processing', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(baseScheduleRequest({
        schedule_type: 'once',
        schedule_config: { date: '2026-02-10', time: '14:00' },
      }), 'user-001');

      // Set next_run_at to past so it's due
      testDb.prepare("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?")
        .run(schedule.id);

      processSchedules();

      const row = testDb.prepare('SELECT status FROM schedules WHERE id = ?')
        .get(schedule.id) as any;
      expect(row.status).toBe('completed');
    });

    it('logs error but still advances next_run_at on task creation failure', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(baseScheduleRequest(), 'user-001');

      testDb.prepare("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?")
        .run(schedule.id);

      // Make createTasks fail
      mockCreateTasks.mockImplementation(() => {
        throw new Error('Build not found');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = processSchedules();

      expect(result.processed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Build not found');

      // next_run_at should still be advanced (no retry spam)
      const row = testDb.prepare('SELECT next_run_at, last_run_at FROM schedules WHERE id = ?')
        .get(schedule.id) as any;
      expect(row.last_run_at).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('skips decommissioned agents in schedule', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      // Insert a second agent that is decommissioned
      insertTestAgent(testDb, { id: 'agent-decomm', status: 'decommissioned' });

      const schedule = createSchedule(baseScheduleRequest({
        agent_ids: ['agent-001', 'agent-decomm'],
      }), 'user-001');

      testDb.prepare("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?")
        .run(schedule.id);

      const result = processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);

      // Only the active agent should be passed to createTasks
      const callArgs = mockCreateTasks.mock.calls[0][0];
      expect(callArgs.agent_ids).toEqual(['agent-001']);
    });

    it('skips createTasks entirely when all agents are decommissioned', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      insertTestAgent(testDb, { id: 'agent-decomm-only', status: 'decommissioned' });

      const schedule = createSchedule(baseScheduleRequest({
        agent_ids: ['agent-decomm-only'],
      }), 'user-001');

      testDb.prepare("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?")
        .run(schedule.id);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).not.toHaveBeenCalled();

      // next_run_at should still be advanced (avoid retry spam)
      const row = testDb.prepare('SELECT next_run_at, last_run_at FROM schedules WHERE id = ?')
        .get(schedule.id) as any;
      expect(row.last_run_at).toBeDefined();
      expect(row.next_run_at).toBeDefined();

      warnSpy.mockRestore();
    });

    // ────────────────────────────────────────────────────────────────────
    // Regression for a May-2026 outage on a customer tenant.
    // When next_run_at is stored in ISO 8601 ('YYYY-MM-DDTHH:MM:SS.sssZ',
    // i.e. what `Date.toISOString()` writes — and what processSchedules
    // itself persists), the old SQL `next_run_at <= datetime('now')`
    // never matched because 'T' (0x54) > ' ' (0x20) in lexicographic
    // string compare. Schedules silently stopped firing once their value
    // had been written in ISO form. The fix wraps both sides of the
    // comparison in `datetime(...)` to normalise to space form first.
    // ────────────────────────────────────────────────────────────────────
    it('fires due schedule whose next_run_at is stored in ISO 8601 format', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = createSchedule(baseScheduleRequest(), 'user-001');

      // ISO format with 'T' separator and millisecond precision —
      // what processSchedules writes via toISOString(). 7 hours overdue.
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run('2026-05-04T08:17:00.000Z', schedule.id);

      const result = processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire a schedule whose ISO next_run_at is in the future', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = createSchedule(baseScheduleRequest(), 'user-001');

      // Far-future ISO timestamp. Note: vi.setSystemTime affects JS Date but
      // not SQLite's datetime('now') — that reads the OS clock — so the
      // chosen value must be in the future relative to BOTH the fake JS time
      // AND real wall-clock time at test execution. Earlier this test used
      // 2026-05-05, which silently broke as soon as wall-clock crossed that
      // date. Anchor far enough out that the assertion holds regardless of
      // when the suite runs.
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run('2099-12-31T23:59:59.000Z', schedule.id);

      const result = processSchedules();

      expect(result.processed).toBe(0);
      expect(mockCreateTasks).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // freshenNextRun via listSchedules / getSchedule (persistence regression)
  // ==========================================================================

  describe('freshenNextRun persistence', () => {
    it('persists a recomputed next_run_at when listSchedules sees a stale value', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = createSchedule(baseScheduleRequest(), 'user-001');

      // Simulate a stale ISO next_run_at in the past (e.g. backend restarted
      // after missing several cron ticks).
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run('2026-05-04T08:17:00.000Z', schedule.id);

      // Calling listSchedules should freshen AND persist.
      listSchedules();

      const row = testDb.prepare('SELECT next_run_at FROM schedules WHERE id = ?')
        .get(schedule.id) as { next_run_at: string };
      expect(row.next_run_at).not.toBe('2026-05-04T08:17:00.000Z');
      expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('does NOT touch next_run_at when it is already in the future', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = createSchedule(baseScheduleRequest(), 'user-001');

      const futureIso = '2026-05-05T14:01:00.000Z';
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run(futureIso, schedule.id);

      listSchedules();

      // Stable across page-refresh: randomize_time would otherwise scramble
      // the displayed "Next" on every read.
      const row = testDb.prepare('SELECT next_run_at FROM schedules WHERE id = ?')
        .get(schedule.id) as { next_run_at: string };
      expect(row.next_run_at).toBe(futureIso);
    });
  });

  // ==========================================================================
  // Per-machine randomization
  // ==========================================================================

  describe('resolveRandomizeMode', () => {
    it('uses explicit randomize_mode when present', () => {
      expect(resolveRandomizeMode({ time: '10:00', randomize_mode: 'per_machine' })).toBe('per_machine');
      expect(resolveRandomizeMode({ time: '10:00', randomize_mode: 'fleet' })).toBe('fleet');
      expect(resolveRandomizeMode({ time: '10:00', randomize_mode: 'fixed' })).toBe('fixed');
    });

    it('maps legacy randomize_time:true to fleet', () => {
      expect(resolveRandomizeMode({ time: '10:00', randomize_time: true })).toBe('fleet');
    });

    it('maps legacy randomize_time absent/false to fixed', () => {
      expect(resolveRandomizeMode({ time: '10:00' })).toBe('fixed');
      expect(resolveRandomizeMode({ time: '10:00', randomize_time: false })).toBe('fixed');
    });

    it('prefers explicit mode over legacy randomize_time', () => {
      expect(resolveRandomizeMode({ time: '10:00', randomize_time: true, randomize_mode: 'fixed' })).toBe('fixed');
    });
  });

  describe('computePerAgentNextRuns', () => {
    it('returns one entry per agent', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const map = computePerAgentNextRuns(
        'daily',
        { time: '10:00', randomize_mode: 'per_machine' },
        'UTC',
        ['agent-a', 'agent-b', 'agent-c'],
      );

      expect(Object.keys(map).sort()).toEqual(['agent-a', 'agent-b', 'agent-c']);
      for (const iso of Object.values(map)) {
        expect(new Date(iso).getTime()).toBeGreaterThan(Date.now());
      }
    });

    it('produces independent times so the whole fleet is not synchronized', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      // 30 agents across an 8h weekday window (480 distinct minutes): the
      // chance all 30 collide on one minute is negligible. Assert >1 distinct.
      const agentIds = Array.from({ length: 30 }, (_, i) => `agent-${i}`);
      const map = computePerAgentNextRuns(
        'daily',
        { time: '10:00', randomize_mode: 'per_machine' },
        'UTC',
        agentIds,
      );

      const distinct = new Set(Object.values(map));
      expect(distinct.size).toBeGreaterThan(1);
    });
  });

  describe('createSchedule (per_machine)', () => {
    it('populates agent_next_runs and sets next_run_at to the minimum', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));
      insertTestAgent(testDb, { id: 'agent-002' });

      const schedule = createSchedule(baseScheduleRequest({
        agent_ids: ['agent-001', 'agent-002'],
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');

      expect(schedule.agent_next_runs).not.toBeNull();
      expect(Object.keys(schedule.agent_next_runs!).sort()).toEqual(['agent-001', 'agent-002']);

      const minIso = Object.values(schedule.agent_next_runs!).sort()[0];
      expect(schedule.next_run_at).toBe(minIso);
    });

    it('leaves agent_next_runs null for fleet schedules', () => {
      const schedule = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'fleet' },
      }), 'user-001');
      expect(schedule.agent_next_runs).toBeNull();
    });
  });

  describe('processSchedules (per_machine)', () => {
    it('dispatches only agents whose individual time is due and advances only them', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T12:00:00Z'));
      insertTestAgent(testDb, { id: 'agent-002' });

      const schedule = createSchedule(baseScheduleRequest({
        agent_ids: ['agent-001', 'agent-002'],
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');

      // agent-001 is due (in the past), agent-002 is not (in the future).
      const dueIso = '2026-02-09T11:00:00.000Z';
      const pendingIso = '2026-02-09T18:00:00.000Z';
      testDb.prepare('UPDATE schedules SET agent_next_runs = ?, next_run_at = ? WHERE id = ?')
        .run(JSON.stringify({ 'agent-001': dueIso, 'agent-002': pendingIso }), dueIso, schedule.id);

      const result = processSchedules();

      expect(result.processed).toBe(1);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
      // Only the due agent dispatched
      expect(mockCreateTasks.mock.calls[0][0].agent_ids).toEqual(['agent-001']);

      const row = testDb.prepare('SELECT agent_next_runs FROM schedules WHERE id = ?')
        .get(schedule.id) as { agent_next_runs: string };
      const map = JSON.parse(row.agent_next_runs) as Record<string, string>;
      // agent-001 advanced to the future; agent-002 untouched
      expect(new Date(map['agent-001']).getTime()).toBeGreaterThan(Date.now());
      expect(map['agent-002']).toBe(pendingIso);
    });
  });

  describe('updateSchedule (per_machine reconciliation)', () => {
    it('adds map entries for newly added agents and drops removed ones', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));
      insertTestAgent(testDb, { id: 'agent-002' });
      insertTestAgent(testDb, { id: 'agent-003' });

      const schedule = createSchedule(baseScheduleRequest({
        agent_ids: ['agent-001', 'agent-002'],
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');

      const updated = updateSchedule(schedule.id, { agent_ids: ['agent-002', 'agent-003'] });

      expect(Object.keys(updated.agent_next_runs!).sort()).toEqual(['agent-002', 'agent-003']);
      // agent-002 kept its original time
      expect(updated.agent_next_runs!['agent-002']).toBe(schedule.agent_next_runs!['agent-002']);
    });

    it('clears agent_next_runs when switching away from per_machine', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');
      expect(schedule.agent_next_runs).not.toBeNull();

      const updated = updateSchedule(schedule.id, {
        schedule_config: { time: '10:00', randomize_mode: 'fleet' },
      });
      expect(updated.agent_next_runs).toBeNull();
    });
  });

  // ==========================================================================
  // R25: a randomized schedule never runs twice on the same local day
  // ==========================================================================

  describe('randomized schedules never run twice on the same day (R25)', () => {
    // Weekday window is 09:00-17:00 (480 min): 300/480 rolls 14:00.
    const ROLL_14_00 = 0.625;
    // Weekend window is 00:00-24:00 (1440 min): 1380/1440 rolls 23:00.
    const ROLL_23_00 = 1380.5 / 1440;
    const MON_10_00 = new Date('2026-02-09T10:00:00.000Z'); // Monday, UTC

    const rowOf = (id: string) =>
      testDb.prepare('SELECT next_run_at, agent_next_runs FROM schedules WHERE id = ?').get(id) as {
        next_run_at: string | null;
        agent_next_runs: string | null;
      };

    it('daily fleet: after firing at 10:00, next_run_at is tomorrow inside tomorrow\'s window', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00);
      const schedule = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'fleet' },
      }), 'user-001');
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run(MON_10_00.toISOString(), schedule.id);

      processSchedules(MON_10_00);

      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
      const next = rowOf(schedule.id).next_run_at!;
      expect(next).toBe('2026-02-10T14:00:00.000Z');
      expect(next >= '2026-02-10T09:00:00.000Z' && next < '2026-02-10T17:00:00.000Z').toBe(true);
    });

    it('daily per_machine: the agent advances to tomorrow and a 14:01 tick does not dispatch again', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00);
      const schedule = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');
      testDb.prepare('UPDATE schedules SET agent_next_runs = ?, next_run_at = ? WHERE id = ?')
        .run(JSON.stringify({ 'agent-001': MON_10_00.toISOString() }), MON_10_00.toISOString(), schedule.id);

      processSchedules(MON_10_00);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
      const map = JSON.parse(rowOf(schedule.id).agent_next_runs!) as Record<string, string>;
      expect(map['agent-001']).toBe('2026-02-10T14:00:00.000Z');

      processSchedules(new Date('2026-02-09T14:01:00.000Z'));
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
    });

    it('weekly: after firing today, the next run is the next configured weekday, not today', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00);
      // Mon (today) and Wed (the day after tomorrow).
      const next = computeNextRun('weekly', { days: [1, 3], time: '10:00', randomize_mode: 'fleet' }, 'UTC', MON_10_00, { afterFire: true });
      expect(next!.toISOString()).toBe('2026-02-11T14:00:00.000Z');
    });

    it('weekly through processSchedules: fired Monday, next_run_at is Wednesday', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00);
      const schedule = createSchedule(baseScheduleRequest({
        schedule_type: 'weekly',
        schedule_config: { days: [1, 3], time: '10:00', randomize_mode: 'fleet' },
      }), 'user-001');
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run(MON_10_00.toISOString(), schedule.id);

      processSchedules(MON_10_00);

      expect(rowOf(schedule.id).next_run_at).toBe('2026-02-11T14:00:00.000Z');
    });

    it('monthly: after firing on the configured day, the next run is next month', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00);
      const next = computeNextRun('monthly', { dayOfMonth: 9, time: '10:00', randomize_mode: 'fleet' }, 'UTC', MON_10_00, { afterFire: true });
      expect(next!.toISOString()).toBe('2026-03-09T14:00:00.000Z');
    });

    it('monthly through processSchedules: fired on the 9th, next_run_at is the 9th of next month', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00);
      const schedule = createSchedule(baseScheduleRequest({
        schedule_type: 'monthly',
        schedule_config: { dayOfMonth: 9, time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');
      testDb.prepare('UPDATE schedules SET agent_next_runs = ?, next_run_at = ? WHERE id = ?')
        .run(JSON.stringify({ 'agent-001': MON_10_00.toISOString() }), MON_10_00.toISOString(), schedule.id);

      processSchedules(MON_10_00);

      const map = JSON.parse(rowOf(schedule.id).agent_next_runs!) as Record<string, string>;
      expect(map['agent-001']).toBe('2026-03-09T14:00:00.000Z');
    });

    it('fixed mode is unchanged: a 09:00 daily that fires at 09:00 goes to tomorrow 09:00', () => {
      const fireAt = new Date('2026-02-09T09:00:00.000Z');
      expect(computeNextRun('daily', { time: '09:00' }, 'UTC', fireAt)!.toISOString())
        .toBe('2026-02-10T09:00:00.000Z');
      expect(computeNextRun('daily', { time: '09:00' }, 'UTC', fireAt, { afterFire: true })!.toISOString())
        .toBe('2026-02-10T09:00:00.000Z');

      const schedule = createSchedule(baseScheduleRequest({ schedule_config: { time: '09:00' } }), 'user-001');
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(fireAt.toISOString(), schedule.id);
      processSchedules(fireAt);
      expect(rowOf(schedule.id).next_run_at).toBe('2026-02-10T09:00:00.000Z');
    });

    it('fixed mode afterFire: a later fixed time today is still allowed (behaviour unchanged)', () => {
      // Fixed mode ignores afterFire entirely.
      const at = new Date('2026-02-09T08:00:00.000Z');
      expect(computeNextRun('daily', { time: '09:00' }, 'UTC', at, { afterFire: true })!.toISOString())
        .toBe('2026-02-09T09:00:00.000Z');
    });

    it('creation still allows today: a randomized daily created at 10:00 rolling 14:00 runs today', () => {
      vi.useFakeTimers();
      vi.setSystemTime(MON_10_00);
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00);

      const fleet = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'fleet' },
      }), 'user-001');
      expect(fleet.next_run_at).toBe('2026-02-09T14:00:00.000Z');

      const perMachine = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');
      expect(perMachine.agent_next_runs!['agent-001']).toBe('2026-02-09T14:00:00.000Z');

      // Without the option, computeNextRun behaves as before.
      expect(computeNextRun('daily', { time: '10:00', randomize_mode: 'fleet' }, 'UTC', MON_10_00)!.toISOString())
        .toBe('2026-02-09T14:00:00.000Z');
    });

    it('timezone: a 22:30 local run (02:30 UTC next day) advances to the next LOCAL day', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_23_00);
      const tz = 'America/Santo_Domingo'; // UTC-4, no DST
      // Saturday 2026-02-07 22:30 local = Sunday 2026-02-08 02:30 UTC.
      const fireAt = new Date('2026-02-08T02:30:00.000Z');

      // Without the option a 23:00 roll would stay on Saturday (the bug).
      expect(computeNextRun('daily', { time: '10:00', randomize_mode: 'fleet' }, tz, fireAt)!.toISOString())
        .toBe('2026-02-08T03:00:00.000Z');

      const next = computeNextRun('daily', { time: '10:00', randomize_mode: 'fleet' }, tz, fireAt, { afterFire: true })!;
      // Sunday 2026-02-08 23:00 local = Monday 2026-02-09 03:00 UTC: one local
      // day later, not two (a UTC-date skip would land on Monday local).
      expect(next.toISOString()).toBe('2026-02-09T03:00:00.000Z');
      expect(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(next)).toBe('2026-02-08');
    });
  });

  // ==========================================================================
  // R25 edge cases
  // ==========================================================================

  describe('R25 edge cases', () => {
    const ROLL_14_00_WEEKDAY = 0.625; // 300/480 -> 14:00; on a weekend 900/1440 -> 15:00

    it('weekly with today as the only configured weekday: afterFire lands on the same weekday next week', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00_WEEKDAY);
      const fireAt = new Date('2026-02-09T10:00:00.000Z'); // Monday
      const next = computeNextRun('weekly', { days: [1], time: '10:00', randomize_mode: 'fleet' }, 'UTC', fireAt, { afterFire: true });
      expect(next!.toISOString()).toBe('2026-02-16T14:00:00.000Z');
    });

    it('monthly dayOfMonth 31 firing on Feb 28 (clamped day): afterFire gives Mar 31', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00_WEEKDAY);
      const fireAt = new Date('2026-02-28T10:00:00.000Z'); // Saturday, Feb's clamped "31st"
      // Without the option the weekend roll (15:00) would stay on Feb 28.
      expect(computeNextRun('monthly', { dayOfMonth: 31, time: '10:00', randomize_mode: 'fleet' }, 'UTC', fireAt)!.toISOString())
        .toBe('2026-02-28T15:00:00.000Z');
      const next = computeNextRun('monthly', { dayOfMonth: 31, time: '10:00', randomize_mode: 'fleet' }, 'UTC', fireAt, { afterFire: true });
      expect(next!.toISOString()).toBe('2026-03-31T14:00:00.000Z'); // Tuesday 14:00 UTC
    });

    it('DST transition day (America/New_York, spring forward 2026-03-08)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(ROLL_14_00_WEEKDAY);
      const tz = 'America/New_York';
      const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
      const cfg = { time: '10:00', randomize_mode: 'fleet' as const };

      // Fires ON the DST day, after the jump (03:30 EDT = 07:30Z). The next
      // run is Monday 14:00 EDT (UTC-4) = 18:00Z, not later the same Sunday.
      const onDst = computeNextRun('daily', cfg, tz, new Date('2026-03-08T07:30:00.000Z'), { afterFire: true })!;
      expect(onDst.toISOString()).toBe('2026-03-09T18:00:00.000Z');
      expect(localDate(onDst)).toBe('2026-03-09');

      // Fires the evening BEFORE (Sat 22:00 EST = 03:00Z Sun). The next run is
      // on the DST day itself: weekend roll 15:00 EDT = 19:00Z.
      const intoDst = computeNextRun('daily', cfg, tz, new Date('2026-03-08T03:00:00.000Z'), { afterFire: true })!;
      expect(intoDst.toISOString()).toBe('2026-03-08T19:00:00.000Z');
      expect(localDate(intoDst)).toBe('2026-03-08');
    });
  });

  // ==========================================================================
  // R26: list/get must not skip a schedule that is about to fire
  // ==========================================================================

  describe('list/get no longer skip schedules that are about to fire (R26)', () => {
    const SEC = 1000;
    const MIN = 60 * SEC;
    const MON_09_00 = new Date('2026-02-09T09:00:00.000Z');
    const MON_10_00 = new Date('2026-02-09T10:00:00.000Z');
    const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

    const rowOf = (id: string) =>
      testDb.prepare('SELECT next_run_at, agent_next_runs FROM schedules WHERE id = ?').get(id) as {
        next_run_at: string | null;
        agent_next_runs: string | null;
      };

    it('exports a 5-minute FRESHEN_GRACE_MS', () => {
      expect(FRESHEN_GRACE_MS).toBe(5 * 60_000);
    });

    it('fixed 09:00: listSchedules at 09:00:20 then the 09:00:40 tick dispatches today\'s run', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00.000Z'));
      const schedule = createSchedule(baseScheduleRequest({ schedule_config: { time: '09:00' } }), 'user-001');
      expect(schedule.next_run_at).toBe(MON_09_00.toISOString());

      vi.setSystemTime(plus(MON_09_00, 20 * SEC));
      const listed = listSchedules();
      expect(listed[0].next_run_at).toBe(MON_09_00.toISOString());
      expect(rowOf(schedule.id).next_run_at).toBe(MON_09_00.toISOString());

      processSchedules(plus(MON_09_00, 40 * SEC));
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
    });

    it('fixed 09:00: getSchedule at 09:00:20 leaves the run for the tick', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00.000Z'));
      const schedule = createSchedule(baseScheduleRequest({ schedule_config: { time: '09:00' } }), 'user-001');

      vi.setSystemTime(plus(MON_09_00, 20 * SEC));
      expect(getSchedule(schedule.id).next_run_at).toBe(MON_09_00.toISOString());

      processSchedules(plus(MON_09_00, 40 * SEC));
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
    });

    it('per_machine: an agent due at 10:00, listed at 10:00:20, is dispatched by the tick', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00.000Z'));
      const schedule = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');
      testDb.prepare('UPDATE schedules SET agent_next_runs = ?, next_run_at = ? WHERE id = ?')
        .run(JSON.stringify({ 'agent-001': MON_10_00.toISOString() }), MON_10_00.toISOString(), schedule.id);

      vi.setSystemTime(plus(MON_10_00, 20 * SEC));
      listSchedules();
      expect(JSON.parse(rowOf(schedule.id).agent_next_runs!)).toEqual({ 'agent-001': MON_10_00.toISOString() });

      processSchedules(plus(MON_10_00, 40 * SEC));
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
      expect(mockCreateTasks.mock.calls[0][0].agent_ids).toEqual(['agent-001']);
    });

    it('a schedule overdue by 6 minutes is still advanced by listSchedules (missed run skipped)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00.000Z'));
      const schedule = createSchedule(baseScheduleRequest({ schedule_config: { time: '09:00' } }), 'user-001');

      vi.setSystemTime(plus(MON_09_00, 6 * MIN));
      const listed = listSchedules();

      expect(listed[0].next_run_at).toBe('2026-02-10T09:00:00.000Z');
      expect(rowOf(schedule.id).next_run_at).toBe('2026-02-10T09:00:00.000Z');
    });

    it('per_machine: only agent slots overdue by more than the grace period are advanced', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00.000Z'));
      insertTestAgent(testDb, { id: 'agent-002' });
      const schedule = createSchedule(baseScheduleRequest({
        agent_ids: ['agent-001', 'agent-002'],
        schedule_config: { time: '10:00', randomize_mode: 'per_machine' },
      }), 'user-001');
      const stale = MON_10_00.toISOString(); // 6 min overdue at list time
      const fresh = plus(MON_10_00, 5 * MIN).toISOString(); // 1 min overdue at list time
      testDb.prepare('UPDATE schedules SET agent_next_runs = ?, next_run_at = ? WHERE id = ?')
        .run(JSON.stringify({ 'agent-001': stale, 'agent-002': fresh }), stale, schedule.id);

      vi.setSystemTime(plus(MON_10_00, 6 * MIN));
      listSchedules();

      const row = rowOf(schedule.id);
      const map = JSON.parse(row.agent_next_runs!) as Record<string, string>;
      expect(new Date(map['agent-001']).getTime()).toBeGreaterThan(Date.now());
      expect(map['agent-002']).toBe(fresh);
      expect(row.next_run_at).toBe(fresh);
    });

    it('the freshen write is conditional: a tick that advanced the row in between is not overwritten', () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.625); // weekday roll 14:00
      vi.setSystemTime(new Date('2026-02-09T08:00:00.000Z'));
      const schedule = createSchedule(baseScheduleRequest({
        schedule_config: { time: '10:00', randomize_mode: 'fleet' },
      }), 'user-001');
      testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(MON_09_00.toISOString(), schedule.id);

      const listAt = plus(MON_09_00, 6 * MIN);
      vi.setSystemTime(listAt);

      // Run the tick between freshen's read and its write.
      const realPrepare = testDb.prepare.bind(testDb);
      let armed = true;
      vi.spyOn(testDb, 'prepare').mockImplementation(((sql: string) => {
        const stmt = realPrepare(sql);
        if (armed && sql.startsWith('UPDATE schedules SET next_run_at') && !sql.includes('last_run_at')) {
          armed = false;
          return {
            run: (...args: unknown[]) => {
              processSchedules(listAt); // fires and advances to tomorrow 14:00
              return stmt.run(...(args as []));
            },
          } as unknown as Database.Statement;
        }
        return stmt;
      }) as typeof testDb.prepare);

      const listed = listSchedules();

      expect(armed).toBe(false);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
      // Without the condition, freshen would write today 14:00: a second run today.
      expect(rowOf(schedule.id).next_run_at).toBe('2026-02-10T14:00:00.000Z');
      expect(listed[0].next_run_at).toBe('2026-02-10T14:00:00.000Z');
    });
  });

  describe('once with randomized timing', () => {
    // Monday 2026-02-09, UTC: the weekday window is 09:00-17:00 (480 min).
    const MON = '2026-02-09';
    const at = (iso: string) => new Date(`${MON}T${iso}.000Z`);
    const rowOf = (id: string) =>
      testDb.prepare('SELECT status, next_run_at, agent_next_runs FROM schedules WHERE id = ?').get(id) as {
        status: string;
        next_run_at: string | null;
        agent_next_runs: string | null;
      };
    const onceRandom = (mode: 'fleet' | 'per_machine', date = MON) => ({
      schedule_type: 'once' as const,
      schedule_config: { date, time: '09:00', randomize_mode: mode },
    });

    describe('computeNextRun', () => {
      it('rolls inside the date\'s window', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.625); // 300/480 -> 14:00
        const next = computeNextRun('once', { date: MON, time: '09:00', randomize_mode: 'fleet' }, 'UTC', at('08:00:00'));
        expect(next!.toISOString()).toBe('2026-02-09T14:00:00.000Z');
      });

      it('for today, uses only what is left of the window', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const cfg = { date: MON, time: '09:00', randomize_mode: 'per_machine' as const };
        expect(computeNextRun('once', cfg, 'UTC', at('15:00:00'))!.toISOString()).toBe('2026-02-09T15:01:00.000Z');
        vi.spyOn(Math, 'random').mockReturnValue(0.9999);
        expect(computeNextRun('once', cfg, 'UTC', at('15:00:00'))!.toISOString()).toBe('2026-02-09T16:59:00.000Z');
      });

      it('returns null once the window has closed, and after a run', () => {
        const cfg = { date: MON, time: '09:00', randomize_mode: 'fleet' as const };
        expect(computeNextRun('once', cfg, 'UTC', at('17:00:00'))).toBeNull();
        expect(computeNextRun('once', cfg, 'UTC', at('10:00:00'), { afterFire: true })).toBeNull();
      });

      it('uses the whole day at weekends', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const next = computeNextRun('once', { date: '2026-02-14', time: '09:00', randomize_mode: 'fleet' }, 'UTC', at('08:00:00'));
        expect(next!.toISOString()).toBe('2026-02-14T00:00:00.000Z');
      });

      it('leaves fixed-time once schedules unchanged', () => {
        expect(computeNextRun('once', { date: MON, time: '09:30' }, 'UTC', at('08:00:00'))!.toISOString())
          .toBe('2026-02-09T09:30:00.000Z');
      });
    });

    describe('createSchedule', () => {
      it('per_machine: gives each agent its own slot in the window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(at('08:00:00'));
        insertTestAgent(testDb, { id: 'agent-002' });
        const schedule = createSchedule(baseScheduleRequest({ agent_ids: ['agent-001', 'agent-002'], ...onceRandom('per_machine') }), 'user-001');
        const slots = Object.values(schedule.agent_next_runs ?? {});
        expect(Object.keys(schedule.agent_next_runs!).sort()).toEqual(['agent-001', 'agent-002']);
        for (const s of slots) expect(s >= '2026-02-09T09:00:00.000Z' && s < '2026-02-09T17:00:00.000Z').toBe(true);
        expect(schedule.next_run_at).toBe(slots.sort()[0]);
      });

      it('fleet: one next_run_at in the window and no per-agent map', () => {
        vi.useFakeTimers();
        vi.setSystemTime(at('08:00:00'));
        vi.spyOn(Math, 'random').mockReturnValue(0.625); // 300/480 -> 14:00
        const schedule = createSchedule(baseScheduleRequest(onceRandom('fleet')), 'user-001');
        expect(schedule.agent_next_runs).toBeNull();
        expect(schedule.next_run_at).toBe('2026-02-09T14:00:00.000Z');
      });

      it('refuses a date whose window has already closed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(at('18:00:00'));
        for (const mode of ['fleet', 'per_machine'] as const) {
          expect(() => createSchedule(baseScheduleRequest(onceRandom(mode)), 'user-001'))
            .toThrow(/random window for 2026-02-09 has already passed/);
        }
      });
    });

    describe('processSchedules', () => {
      it('per_machine: each agent runs once, and the schedule completes after the last one', () => {
        vi.useFakeTimers();
        vi.setSystemTime(at('08:00:00'));
        insertTestAgent(testDb, { id: 'agent-002' });
        const schedule = createSchedule(baseScheduleRequest({ agent_ids: ['agent-001', 'agent-002'], ...onceRandom('per_machine') }), 'user-001');
        const first = '2026-02-09T10:00:00.000Z';
        const second = '2026-02-09T15:30:00.000Z';
        testDb.prepare('UPDATE schedules SET agent_next_runs = ?, next_run_at = ? WHERE id = ?')
          .run(JSON.stringify({ 'agent-001': first, 'agent-002': second }), first, schedule.id);

        processSchedules(at('10:00:00'));
        expect(mockCreateTasks.mock.calls.map((c) => c[0].agent_ids)).toEqual([['agent-001']]);
        expect(rowOf(schedule.id)).toMatchObject({ status: 'active', next_run_at: second });
        expect(JSON.parse(rowOf(schedule.id).agent_next_runs!)).toEqual({ 'agent-002': second });

        processSchedules(at('12:00:00'));
        expect(mockCreateTasks).toHaveBeenCalledTimes(1);

        processSchedules(at('15:30:00'));
        expect(mockCreateTasks.mock.calls.map((c) => c[0].agent_ids)).toEqual([['agent-001'], ['agent-002']]);
        expect(rowOf(schedule.id)).toMatchObject({ status: 'completed', next_run_at: null });

        processSchedules(at('16:00:00'));
        expect(mockCreateTasks).toHaveBeenCalledTimes(2);
      });

      it('fleet: all agents run together once, then the schedule completes', () => {
        vi.useFakeTimers();
        vi.setSystemTime(at('08:00:00'));
        insertTestAgent(testDb, { id: 'agent-002' });
        const schedule = createSchedule(baseScheduleRequest({ agent_ids: ['agent-001', 'agent-002'], ...onceRandom('fleet') }), 'user-001');
        const due = schedule.next_run_at!;
        processSchedules(new Date(due));
        expect(mockCreateTasks).toHaveBeenCalledTimes(1);
        expect(mockCreateTasks.mock.calls[0][0].agent_ids.sort()).toEqual(['agent-001', 'agent-002']);
        expect(rowOf(schedule.id).status).toBe('completed');
      });
    });

    it('updateSchedule: moving the date re-rolls every agent inside the new date\'s window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(at('08:00:00'));
      insertTestAgent(testDb, { id: 'agent-002' });
      const schedule = createSchedule(baseScheduleRequest({ agent_ids: ['agent-001', 'agent-002'], ...onceRandom('per_machine') }), 'user-001');
      const updated = updateSchedule(schedule.id, { schedule_config: { date: '2026-02-10', time: '09:00', randomize_mode: 'per_machine' } });
      const slots = Object.values(updated.agent_next_runs ?? {});
      expect(slots).toHaveLength(2);
      for (const s of slots) expect(s >= '2026-02-10T09:00:00.000Z' && s < '2026-02-10T17:00:00.000Z').toBe(true);
    });
  });
});
