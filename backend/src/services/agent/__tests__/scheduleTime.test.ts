import { describe, it, expect } from 'vitest';
import {
  randomWindowBoundsForDate,
  randomWindowForDate,
  randomTimeForDate,
  todayInTimezone,
  addDays,
  daysInMonth,
  resolveRandomizeMode,
  safeTimezone,
} from '../scheduleTime.js';

describe('scheduleTime', () => {
  it('weekday bounds are 9-17', () => {
    expect(randomWindowBoundsForDate('2026-10-21', 'UTC')).toEqual({ startHour: 9, endHour: 17 });
  });

  it('weekend bounds are 0-24', () => {
    expect(randomWindowBoundsForDate('2026-10-24', 'UTC')).toEqual({ startHour: 0, endHour: 24 });
  });

  it('randomWindowForDate returns UTC instants for a weekday', () => {
    const { start, end } = randomWindowForDate('2026-10-21', 'America/Santo_Domingo');
    expect(start.toISOString()).toBe('2026-10-21T13:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-21T21:00:00.000Z');
  });

  it('weekend window ends at next-day local midnight', () => {
    const { start, end } = randomWindowForDate('2026-10-24', 'UTC');
    expect(start.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('randomTimeForDate stays within office hours on a weekday', () => {
    for (let i = 0; i < 200; i++) {
      const t = randomTimeForDate('2026-10-21', 'UTC');
      expect(t >= '09:00' && t <= '16:59').toBe(true);
    }
  });

  it('todayInTimezone formats YYYY-MM-DD in the zone', () => {
    expect(todayInTimezone('Asia/Tokyo', new Date('2026-10-21T20:00:00Z'))).toBe('2026-10-22');
  });
});

describe('scheduleTime date helpers', () => {
  it('addDays crosses year and month boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('daysInMonth handles leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('resolveRandomizeMode bridges the legacy boolean', () => {
    expect(resolveRandomizeMode({ time: '09:00', randomize_time: true })).toBe('fleet');
    expect(resolveRandomizeMode({ time: '09:00', randomize_mode: 'per_machine' })).toBe('per_machine');
    expect(resolveRandomizeMode({ time: '09:00' })).toBe('fixed');
  });

  it('safeTimezone falls back to UTC', () => {
    expect(safeTimezone('Not/AZone')).toBe('UTC');
    expect(safeTimezone(undefined)).toBe('UTC');
    expect(safeTimezone('America/Santo_Domingo')).toBe('America/Santo_Domingo');
  });
});
