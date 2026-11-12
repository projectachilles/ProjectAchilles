import { describe, it, expect } from 'vitest';
import {
  summarizeHostRecency,
  summarizeAnyTestRecency,
  matchesRecencyWindow,
  recencyLabel,
  type TestRunRecency,
} from '../testRunRecency';

const NOW = new Date('2026-11-11T12:00:00Z').getTime();
const run = (agent: string, test: string, last: string | null, queued = false): TestRunRecency => ({
  agent_id: agent, test_uuid: test, last_run_at: last, queued,
});

describe('summarizeHostRecency', () => {
  it('marks a host with no task as never run', () => {
    expect(summarizeHostRecency(['a1'], ['t1'], []).get('a1')).toEqual({ state: 'never' });
  });

  it('uses the last run of a single test', () => {
    const m = summarizeHostRecency(['a1'], ['t1'], [run('a1', 't1', '2026-11-01T00:00:00Z')]);
    expect(m.get('a1')).toEqual({ state: 'ran', at: '2026-11-01T00:00:00Z' });
  });

  it('judges several tests by the one run longest ago', () => {
    const runs = [run('a1', 't1', '2026-11-10T00:00:00Z'), run('a1', 't2', '2026-09-01T00:00:00Z')];
    expect(summarizeHostRecency(['a1'], ['t1', 't2'], runs).get('a1')).toEqual({ state: 'ran', at: '2026-09-01T00:00:00Z' });
  });

  it('is never run when any selected test has no run', () => {
    const runs = [run('a1', 't1', '2026-11-10T00:00:00Z')];
    expect(summarizeHostRecency(['a1'], ['t1', 't2'], runs).get('a1')).toEqual({ state: 'never' });
  });

  it('skips queued tests, and is queued only when all are', () => {
    const runs = [run('a1', 't1', null, true), run('a1', 't2', '2026-10-01T00:00:00Z')];
    expect(summarizeHostRecency(['a1'], ['t1', 't2'], runs).get('a1')).toEqual({ state: 'ran', at: '2026-10-01T00:00:00Z' });
    expect(summarizeHostRecency(['a1'], ['t1'], runs).get('a1')).toEqual({ state: 'queued' });
  });

  it('ignores a failed-only history (no last run, not queued)', () => {
    expect(summarizeHostRecency(['a1'], ['t1'], [run('a1', 't1', null)]).get('a1')).toEqual({ state: 'never' });
  });
});

describe('summarizeAnyTestRecency', () => {
  it('reads each host from its any-test row', () => {
    const m = summarizeAnyTestRecency(['ran', 'queued', 'failed-only', 'no-row'], [
      { agent_id: 'ran', last_run_at: '2026-11-01T00:00:00Z', queued: false },
      { agent_id: 'queued', last_run_at: '2026-11-01T00:00:00Z', queued: true },
      { agent_id: 'failed-only', last_run_at: null, queued: false },
    ]);
    expect(m.get('ran')).toEqual({ state: 'ran', at: '2026-11-01T00:00:00Z' });
    expect(m.get('queued')).toEqual({ state: 'queued' });
    expect(m.get('failed-only')).toEqual({ state: 'never' });
    expect(m.get('no-row')).toEqual({ state: 'never' });
  });
});

describe('matchesRecencyWindow', () => {
  const ran = (at: string) => ({ state: 'ran' as const, at });

  it('lets everything through when off', () => {
    expect(matchesRecencyWindow({ state: 'queued' }, 'any', NOW)).toBe(true);
    expect(matchesRecencyWindow(ran('2026-11-11T11:00:00Z'), 'any', NOW)).toBe(true);
  });

  it('keeps hosts last run before the window and drops recent ones', () => {
    expect(matchesRecencyWindow(ran('2026-11-01T00:00:00Z'), '7', NOW)).toBe(true);
    expect(matchesRecencyWindow(ran('2026-11-06T00:00:00Z'), '7', NOW)).toBe(false);
    expect(matchesRecencyWindow(ran('2026-11-01T00:00:00Z'), '30', NOW)).toBe(false);
  });

  it('always keeps never-run hosts and always drops queued ones', () => {
    for (const w of ['7', '30', '90', 'never'] as const) {
      expect(matchesRecencyWindow({ state: 'never' }, w, NOW)).toBe(true);
      expect(matchesRecencyWindow(undefined, w, NOW)).toBe(true);
      expect(matchesRecencyWindow({ state: 'queued' }, w, NOW)).toBe(false);
    }
  });

  it('"never" keeps only never-run hosts', () => {
    expect(matchesRecencyWindow(ran('2020-01-01T00:00:00Z'), 'never', NOW)).toBe(false);
  });
});

describe('recencyLabel', () => {
  it('labels each state', () => {
    expect(recencyLabel(undefined, NOW)).toBe('never');
    expect(recencyLabel({ state: 'queued' }, NOW)).toBe('queued');
    expect(recencyLabel({ state: 'ran', at: '2026-11-11T08:00:00Z' }, NOW)).toBe('today');
    expect(recencyLabel({ state: 'ran', at: '2026-10-30T12:00:00Z' }, NOW)).toBe('12d ago');
  });
});
