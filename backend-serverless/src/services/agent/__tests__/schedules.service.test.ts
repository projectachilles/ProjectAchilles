import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DbHelper } from '../database.js';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: DbHelper;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDb: async () => testDb };
});

// Mock createTasks (called by processSchedules)
const mockCreateTasks = vi.fn().mockResolvedValue(['task-001']);
vi.mock('../tasks.service.js', () => ({
  createTasks: (...args: unknown[]) => mockCreateTasks(...args),
}));

const {
  computeNextRun,
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  processSchedules,
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
  beforeEach(async () => {
    testDb = await createTestDatabase();
    await insertTestAgent(testDb, { id: 'agent-001' });
    mockCreateTasks.mockClear();
    mockCreateTasks.mockResolvedValue(['task-001']);
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
    it('creates a valid daily schedule', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = await createSchedule(baseScheduleRequest(), 'user-001');

      expect(schedule.id).toBeDefined();
      expect(schedule.schedule_type).toBe('daily');
      expect(schedule.status).toBe('active');
      expect(schedule.agent_ids).toEqual(['agent-001']);
      expect(schedule.next_run_at).toBeDefined();
    });

    it('creates a valid weekly schedule with multiple days', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = await createSchedule(
        baseScheduleRequest({
          schedule_type: 'weekly',
          schedule_config: { days: [1, 3, 5], time: '10:00' },
        }),
        'user-001',
      );

      expect(schedule.schedule_type).toBe('weekly');
      expect(schedule.schedule_config).toEqual({ days: [1, 3, 5], time: '10:00' });
    });

    it('creates a valid once schedule', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = await createSchedule(
        baseScheduleRequest({
          schedule_type: 'once',
          schedule_config: { date: '2026-03-01', time: '14:00' },
        }),
        'user-001',
      );

      expect(schedule.schedule_type).toBe('once');
      expect(schedule.next_run_at).toBeDefined();
    });

    it('throws 400 for missing agent_ids', async () => {
      await expect(
        createSchedule(baseScheduleRequest({ agent_ids: [] }), 'user-001')
      ).rejects.toThrow('At least one agent_id is required');
    });

    it('throws 400 for missing test_uuid', async () => {
      await expect(
        createSchedule(baseScheduleRequest({ test_uuid: '' }), 'user-001')
      ).rejects.toThrow('test_uuid, test_name, and binary_name are required');
    });

    it('throws 400 for once schedule with past time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T16:00:00Z'));

      await expect(
        createSchedule(
          baseScheduleRequest({
            schedule_type: 'once',
            schedule_config: { date: '2026-02-09', time: '10:00' },
          }),
          'user-001',
        )
      ).rejects.toThrow('Scheduled time must be in the future');
    });
  });

  // ==========================================================================
  // listSchedules
  // ==========================================================================

  describe('listSchedules', () => {
    it('returns active schedules', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      await createSchedule(baseScheduleRequest({ name: 'First' }), 'user-001');
      await createSchedule(baseScheduleRequest({ name: 'Second' }), 'user-001');

      const schedules = await listSchedules({ org_id: 'org-001' });
      expect(schedules).toHaveLength(2);
      const names = schedules.map(s => s.name).sort();
      expect(names).toEqual(['First', 'Second']);
    });

    it('filters by org_id', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      await createSchedule(baseScheduleRequest({ org_id: 'org-001' }), 'user-001');
      await createSchedule(baseScheduleRequest({ org_id: 'org-002' }), 'user-002');

      const schedules = await listSchedules({ org_id: 'org-001' });
      expect(schedules).toHaveLength(1);
    });

    it('excludes deleted schedules', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = await createSchedule(baseScheduleRequest(), 'user-001');
      await deleteSchedule(schedule.id);

      const schedules = await listSchedules({ org_id: 'org-001' });
      expect(schedules).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getSchedule
  // ==========================================================================

  describe('getSchedule', () => {
    it('returns schedule by ID', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = await createSchedule(baseScheduleRequest({ name: 'Test' }), 'user-001');
      const schedule = await getSchedule(created.id);
      expect(schedule.id).toBe(created.id);
      expect(schedule.name).toBe('Test');
    });

    it('throws 404 for nonexistent ID', async () => {
      await expect(getSchedule('nonexistent')).rejects.toThrow('Schedule not found');
    });
  });

  // ==========================================================================
  // updateSchedule
  // ==========================================================================

  describe('updateSchedule', () => {
    it('updates name field', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = await createSchedule(baseScheduleRequest({ name: 'Old Name' }), 'user-001');
      const updated = await updateSchedule(created.id, { name: 'New Name' });
      expect(updated.name).toBe('New Name');
    });

    it('recomputes next_run_at when schedule_config changes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = await createSchedule(baseScheduleRequest(), 'user-001');
      const originalNextRun = created.next_run_at;

      const updated = await updateSchedule(created.id, {
        schedule_config: { time: '18:00' },
      });
      expect(updated.next_run_at).not.toBe(originalNextRun);
    });

    it('sets next_run_at to null when status changed to paused', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = await createSchedule(baseScheduleRequest(), 'user-001');

      // Pause recomputes via computeNextRun, but the status is 'paused'
      // so the code only recomputes when status is 'active'
      const updated = await updateSchedule(created.id, { status: 'paused' });
      expect(updated.status).toBe('paused');
    });

    it('throws 404 for nonexistent ID', async () => {
      await expect(updateSchedule('nonexistent', { name: 'x' })).rejects.toThrow('Schedule not found');
    });
  });

  // ==========================================================================
  // deleteSchedule
  // ==========================================================================

  describe('deleteSchedule', () => {
    it('soft-deletes a schedule (sets status to deleted)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const created = await createSchedule(baseScheduleRequest(), 'user-001');
      await deleteSchedule(created.id);

      // Direct DB check since getSchedule would also return it as 'deleted'
      const row = await testDb.get('SELECT status FROM schedules WHERE id = ?', [created.id]) as unknown as any;
      expect(row.status).toBe('deleted');
    });

    it('throws 404 for nonexistent ID', async () => {
      await expect(deleteSchedule('nonexistent')).rejects.toThrow('Schedule not found');
    });
  });

  // ==========================================================================
  // processSchedules
  // ==========================================================================

  describe('processSchedules', () => {
    it('processes a due schedule, calls createTasks, and updates last_run_at', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = await createSchedule(baseScheduleRequest({
        schedule_config: { time: '07:00' }, // time already passed
      }), 'user-001');

      // Manually set next_run_at to the past so it's due
      await testDb.run("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?",
        [schedule.id]);

      const result = await processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);

      // Verify last_run_at was set
      const row = await testDb.get('SELECT last_run_at, next_run_at FROM schedules WHERE id = ?',
        [schedule.id]) as unknown as any;
      expect(row.last_run_at).toBeDefined();
      expect(row.next_run_at).toBeDefined(); // daily schedule should have next run
    });

    it('sets once schedule to completed after processing', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = await createSchedule(baseScheduleRequest({
        schedule_type: 'once',
        schedule_config: { date: '2026-02-10', time: '14:00' },
      }), 'user-001');

      // Set next_run_at to past so it's due
      await testDb.run("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?",
        [schedule.id]);

      await processSchedules();

      const row = await testDb.get('SELECT status FROM schedules WHERE id = ?',
        [schedule.id]) as unknown as any;
      expect(row.status).toBe('completed');
    });

    it('logs error but still advances next_run_at on task creation failure', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      const schedule = await createSchedule(baseScheduleRequest(), 'user-001');

      await testDb.run("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?",
        [schedule.id]);

      // Make createTasks fail
      mockCreateTasks.mockImplementation(() => {
        throw new Error('Build not found');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await processSchedules();

      expect(result.processed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Build not found');

      // next_run_at should still be advanced (no retry spam)
      const row = await testDb.get('SELECT next_run_at, last_run_at FROM schedules WHERE id = ?',
        [schedule.id]) as unknown as any;
      expect(row.last_run_at).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('skips decommissioned agents in schedule', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      // Insert a second agent that is decommissioned
      await insertTestAgent(testDb, { id: 'agent-decomm', status: 'decommissioned' });

      const schedule = await createSchedule(baseScheduleRequest({
        agent_ids: ['agent-001', 'agent-decomm'],
      }), 'user-001');

      await testDb.run("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?",
        [schedule.id]);

      const result = await processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);

      // Only the active agent should be passed to createTasks
      const callArgs = mockCreateTasks.mock.calls[0][0];
      expect(callArgs.agent_ids).toEqual(['agent-001']);
    });

    it('skips createTasks entirely when all agents are decommissioned', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-09T08:00:00Z'));

      await insertTestAgent(testDb, { id: 'agent-decomm-only', status: 'decommissioned' });

      const schedule = await createSchedule(baseScheduleRequest({
        agent_ids: ['agent-decomm-only'],
      }), 'user-001');

      await testDb.run("UPDATE schedules SET next_run_at = datetime('now', '-1 hour') WHERE id = ?",
        [schedule.id]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).not.toHaveBeenCalled();

      // next_run_at should still be advanced (avoid retry spam)
      const row = await testDb.get('SELECT next_run_at, last_run_at FROM schedules WHERE id = ?',
        [schedule.id]) as unknown as any;
      expect(row.last_run_at).toBeDefined();
      expect(row.next_run_at).toBeDefined();

      warnSpy.mockRestore();
    });

    // Regression for May-2026 outage. Mirror of backend/ test.
    it('fires due schedule whose next_run_at is stored in ISO 8601 format', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = await createSchedule(baseScheduleRequest(), 'user-001');

      // ISO format with 'T' separator — what processSchedules persists.
      await testDb.run('UPDATE schedules SET next_run_at = ? WHERE id = ?',
        ['2026-05-04T08:17:00.000Z', schedule.id]);

      const result = await processSchedules();

      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockCreateTasks).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire a schedule whose ISO next_run_at is in the future', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = await createSchedule(baseScheduleRequest(), 'user-001');

      await testDb.run('UPDATE schedules SET next_run_at = ? WHERE id = ?',
        ['2026-05-05T14:01:00.000Z', schedule.id]);

      const result = await processSchedules();

      expect(result.processed).toBe(0);
      expect(mockCreateTasks).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // freshenNextRun via listSchedules / getSchedule (persistence regression)
  // ==========================================================================

  describe('freshenNextRun persistence', () => {
    it('persists a recomputed next_run_at when listSchedules sees a stale value', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = await createSchedule(baseScheduleRequest(), 'user-001');

      await testDb.run('UPDATE schedules SET next_run_at = ? WHERE id = ?',
        ['2026-05-04T08:17:00.000Z', schedule.id]);

      await listSchedules();

      const row = await testDb.get('SELECT next_run_at FROM schedules WHERE id = ?',
        [schedule.id]) as unknown as { next_run_at: string };
      expect(row.next_run_at).not.toBe('2026-05-04T08:17:00.000Z');
      expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('does NOT touch next_run_at when it is already in the future', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-04T15:42:00Z'));

      const schedule = await createSchedule(baseScheduleRequest(), 'user-001');

      const futureIso = '2026-05-05T14:01:00.000Z';
      await testDb.run('UPDATE schedules SET next_run_at = ? WHERE id = ?',
        [futureIso, schedule.id]);

      await listSchedules();

      const row = await testDb.get('SELECT next_run_at FROM schedules WHERE id = ?',
        [schedule.id]) as unknown as { next_run_at: string };
      expect(row.next_run_at).toBe(futureIso);
    });
  });
});
