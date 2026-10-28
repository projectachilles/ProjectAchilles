import { describe, it, expect } from 'vitest';
import { randomWindowForDate } from '../../agent/scheduleTime.js';
import {
  runsOnDay,
  occurrencesForDigestDay,
  type DigestScheduleInput,
} from '../digestOccurrences.js';
import type { ScheduleConfig, ScheduleType } from '../../../types/agent.js';

function sched(
  type: ScheduleType,
  config: ScheduleConfig,
  timezone = 'UTC',
  id = 's1',
): DigestScheduleInput {
  return { id, name: 'Test', schedule_type: type, schedule_config: config, timezone };
}

const W = { lead_minutes: 0, pickup_window_minutes: 120 };
const LEAD = { lead_minutes: 5, pickup_window_minutes: 120 };
const MIN = 60_000;

describe('digestOccurrences', () => {
  it('daily fixed 10:30 UTC yields one occurrence with a pickup-window end', () => {
    const occ = occurrencesForDigestDay(sched('daily', { time: '10:30' }), '2026-10-29', 'UTC', W);
    expect(occ).toHaveLength(1);
    expect(occ[0].mode).toBe('fixed');
    expect(occ[0].start.toISOString()).toBe('2026-10-29T10:30:00.000Z');
    expect(occ[0].end.getTime() - occ[0].start.getTime()).toBe(120 * 60_000);
  });

  it('daily per_machine uses the random window for the run day', () => {
    const tz = 'America/Santo_Domingo';
    const occ = occurrencesForDigestDay(
      sched('daily', { time: '10:00', randomize_mode: 'per_machine' }, tz),
      '2026-10-29', tz, W,
    );
    const w = randomWindowForDate('2026-10-29', tz);
    expect(occ).toHaveLength(1);
    expect(occ[0].mode).toBe('per_machine');
    expect(occ[0].start).toEqual(w.start);
    expect(occ[0].end).toEqual(w.end);
  });

  it('legacy randomize_time maps to fleet', () => {
    const occ = occurrencesForDigestDay(
      sched('daily', { time: '10:00', randomize_time: true }), '2026-10-29', 'UTC', W,
    );
    expect(occ[0].mode).toBe('fleet');
  });

  it('weekly runs only on selected weekdays', () => {
    const s = sched('weekly', { days: [4], time: '09:00' });
    expect(occurrencesForDigestDay(s, '2026-10-29', 'UTC', W)).toHaveLength(1);
    expect(occurrencesForDigestDay(s, '2026-10-28', 'UTC', W)).toHaveLength(0);
    expect(runsOnDay(s, '2026-10-29')).toBe(true);
    expect(runsOnDay(s, '2026-10-28')).toBe(false);
  });

  it('monthly dayOfMonth 31 clamps to the last day of the month', () => {
    const s = sched('monthly', { dayOfMonth: 31, time: '09:00' });
    expect(occurrencesForDigestDay(s, '2026-11-30', 'UTC', W)).toHaveLength(1);
    expect(occurrencesForDigestDay(s, '2026-11-29', 'UTC', W)).toHaveLength(0);
  });

  it('a randomized once uses its random mode and the date\'s window', () => {
    for (const mode of ['fleet', 'per_machine'] as const) {
      const occ = occurrencesForDigestDay(sched('once', { date: '2026-10-29', time: '09:00', randomize_mode: mode }), '2026-10-29', 'UTC', W);
      const w = randomWindowForDate('2026-10-29', 'UTC');
      expect(occ).toHaveLength(1);
      expect(occ[0].mode).toBe(mode);
      expect(occ[0].start).toEqual(w.start);
    }
  });

  it('once runs only on its date', () => {
    const s = sched('once', { date: '2026-10-29', time: '09:00' });
    expect(occurrencesForDigestDay(s, '2026-10-29', 'UTC', W)).toHaveLength(1);
    expect(occurrencesForDigestDay(s, '2026-10-30', 'UTC', W)).toHaveLength(0);
  });

  it('per_machine window across a DST change matches the helper', () => {
    const tz = 'America/New_York';
    const occ = occurrencesForDigestDay(
      sched('daily', { time: '10:00', randomize_mode: 'per_machine' }, tz),
      '2026-11-01', tz, W,
    );
    const w = randomWindowForDate('2026-11-01', tz);
    expect(occ).toHaveLength(1);
    expect(occ[0].start).toEqual(w.start);
    expect(occ[0].end).toEqual(w.end);
    expect(occ[0].end.getTime()).toBeGreaterThan(occ[0].start.getTime());
  });

  it('appears in exactly one digest across consecutive days', () => {
    const s = sched('daily', { time: '08:00' }, 'Pacific/Auckland');
    const runDays: string[] = [];
    for (const d of ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']) {
      for (const o of occurrencesForDigestDay(s, d, 'America/Santo_Domingo', W)) runDays.push(o.runDay);
    }
    expect(new Set(runDays).size).toBe(runDays.length);
    for (const d of ['2026-10-28', '2026-10-29', '2026-10-30']) {
      expect(runDays.filter(x => x === d)).toHaveLength(1);
    }
  });

  describe('with a non-zero lead (matches the gate on the day)', () => {
    it('fixed: shifts start and end by lead_minutes', () => {
      const occ = occurrencesForDigestDay(sched('daily', { time: '10:00' }), '2026-10-29', 'UTC', LEAD);
      expect(occ).toHaveLength(1);
      expect(occ[0].start.toISOString()).toBe('2026-10-29T10:05:00.000Z');
      expect(occ[0].end.toISOString()).toBe('2026-10-29T12:05:00.000Z');
    });

    it('fleet: earliest release after the window opens, pickup deadline after it closes', () => {
      const occ = occurrencesForDigestDay(
        sched('daily', { time: '10:00', randomize_mode: 'fleet' }), '2026-10-29', 'UTC', LEAD,
      );
      const w = randomWindowForDate('2026-10-29', 'UTC');
      expect(occ[0].start.getTime()).toBe(w.start.getTime() + 5 * MIN);
      expect(occ[0].end.getTime()).toBe(w.end.getTime() + (5 + 120) * MIN);
    });

    it('per_machine: release after lead, pickup open until the day window closes', () => {
      const occ = occurrencesForDigestDay(
        sched('daily', { time: '10:00', randomize_mode: 'per_machine' }), '2026-10-29', 'UTC', LEAD,
      );
      const w = randomWindowForDate('2026-10-29', 'UTC');
      expect(occ[0].start.getTime()).toBe(w.start.getTime() + 5 * MIN);
      expect(occ[0].end).toEqual(w.end);
    });

    it('a run scheduled just before midnight stays in its own day\'s digest', () => {
      const s = sched('daily', { time: '23:58' });
      const occ = occurrencesForDigestDay(s, '2026-10-29', 'UTC', LEAD);
      expect(occ).toHaveLength(1);
      expect(occ[0].runDay).toBe('2026-10-29');
      expect(occ[0].start.toISOString()).toBe('2026-10-30T00:03:00.000Z');
      expect(occurrencesForDigestDay(s, '2026-10-30', 'UTC', LEAD).map((o) => o.runDay)).toEqual(['2026-10-30']);
    });
  });
});
