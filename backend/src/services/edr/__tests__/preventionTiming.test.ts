import { describe, it, expect } from 'vitest';
import { actedInRun, actedInRunClause, actionTime, inRunCutoff, IN_RUN_SLACK_MS } from '../preventionTiming.js';

// Live, Nov 2026: a Lumma stage exited 101 at 12:48:32; Defender "prevented"
// its file in an alert whose activity ran until 12:55:36 (cleanup, not prevention).
const RESULT = '2026-11-04T12:48:32Z';

describe('actionTime', () => {
  it('prefers the last activity (Defender) over the alert\'s creation time', () => {
    expect(actionTime({ last_activity_at: '2026-11-04T12:55:36Z', created_at: '2026-11-04T12:56:19Z' })).toBe(Date.parse('2026-11-04T12:55:36Z'));
  });
  it('falls back to created_at, and is null with neither', () => {
    expect(actionTime({ last_activity_at: null, created_at: '2026-11-04T12:49:00Z' })).toBe(Date.parse('2026-11-04T12:49:00Z'));
    expect(actionTime({})).toBeNull();
  });
});

describe('actedInRun', () => {
  const cutoff = inRunCutoff(RESULT);
  it('the cut-off is the result time plus the slack', () => {
    expect(cutoff).toBe(Date.parse(RESULT) + IN_RUN_SLACK_MS);
    expect(inRunCutoff('')).toBeNull();
  });
  it('an action 7 minutes after the run is not in it', () => {
    expect(actedInRun({ last_activity_at: '2026-11-04T12:55:36Z' }, cutoff)).toBe(false);
  });
  it('an action during the run, or within the slack, is', () => {
    expect(actedInRun({ last_activity_at: '2026-11-04T12:48:20Z' }, cutoff)).toBe(true);
    expect(actedInRun({ created_at: '2026-11-04T12:50:00Z' }, cutoff)).toBe(true);
  });
  it('an alert or a result with no time keeps counting (nothing to judge by)', () => {
    expect(actedInRun({}, cutoff)).toBe(true);
    expect(actedInRun({ created_at: '2026-11-04T13:30:00Z' }, null)).toBe(true);
  });
});

describe('actedInRunClause', () => {
  it('matches on last_activity_at, else created_at, else no time', () => {
    const iso = new Date(Date.parse(RESULT) + IN_RUN_SLACK_MS).toISOString();
    expect(actedInRunClause(inRunCutoff(RESULT))).toEqual({
      bool: {
        should: [
          { range: { last_activity_at: { lte: iso } } },
          {
            bool: {
              must_not: [{ exists: { field: 'last_activity_at' } }],
              should: [{ range: { created_at: { lte: iso } } }, { bool: { must_not: [{ exists: { field: 'created_at' } }] } }],
              minimum_should_match: 1,
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
    expect(actedInRunClause(null)).toEqual({ match_all: {} });
  });
});
