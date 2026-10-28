import { describe, it, expect } from 'vitest';
import {
  alertProvesKill,
  hostMatches,
  parseSqliteUtc,
  summarizeTermination,
  techniquesOverlap,
} from '../agent-kill-evidence.js';
import type { KillCandidateTask, KillEvidenceAlert } from '../agent-kill-evidence.js';

const task: KillCandidateTask = {
  taskId: 't-1',
  testUuid: '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb',
  hostname: 'LT4862',
  assignedAtMs: Date.parse('2026-10-26T16:06:05Z'),
  failedAtMs: Date.parse('2026-10-26T16:12:59Z'),
  techniques: ['T1059.001', 'T1003.001', 'T1021.002', 'T1567.002', 'T1486'],
};

const alert: KillEvidenceAlert = {
  id: 'a-1',
  vendor: 'sentinelone',
  createdAt: '2026-10-26T16:06:32.719Z',
  evidenceHostnames: ['lt4862'],
  mitreTechniques: ['T1003.001', 'T1053.005'],
  preventionAction: 'process_killed',
  achillesMitigated: false,
};

describe('alertProvesKill', () => {
  it('accepts the LT4862 agent-kill alert', () => {
    expect(alertProvesKill(task, alert)).toBe(true);
  });

  it('accepts an alert that names rphcp.exe (flagged file is irrelevant)', () => {
    expect(alertProvesKill(task, { ...alert, id: 'a-rphcp' })).toBe(true);
  });

  it('rejects an alert with no created_at', () => {
    expect(alertProvesKill(task, { ...alert, createdAt: null })).toBe(false);
  });

  it('rejects an alert before assigned_at and after the watchdog failure', () => {
    expect(alertProvesKill(task, { ...alert, createdAt: '2026-10-26T16:06:04Z' })).toBe(false);
    expect(alertProvesKill(task, { ...alert, createdAt: '2026-10-26T16:13:00Z' })).toBe(false);
  });

  it('treats the window as inclusive', () => {
    expect(alertProvesKill(task, { ...alert, createdAt: '2026-10-26T16:06:05Z' })).toBe(true);
    expect(alertProvesKill(task, { ...alert, createdAt: '2026-10-26T16:12:59Z' })).toBe(true);
  });

  it('rejects detection-only alerts', () => {
    expect(alertProvesKill(task, { ...alert, preventionAction: undefined })).toBe(false);
    expect(alertProvesKill(task, { ...alert, preventionAction: 'kill_failed' })).toBe(false);
  });

  it('rejects Achilles-mitigated alerts', () => {
    expect(alertProvesKill(task, { ...alert, achillesMitigated: true })).toBe(false);
  });

  it('rejects an alert with no techniques or non-overlapping techniques', () => {
    expect(alertProvesKill(task, { ...alert, mitreTechniques: [] })).toBe(false);
    expect(alertProvesKill(task, { ...alert, mitreTechniques: ['T1566'] })).toBe(false);
  });

  it('rejects a different host', () => {
    expect(alertProvesKill(task, { ...alert, evidenceHostnames: ['other'] })).toBe(false);
  });

  it('rejects an alert correlated to a different test', () => {
    expect(alertProvesKill(task, { ...alert, achillesTestUuid: '7659eeba-f315-440e-9882-4aa015d68b27' })).toBe(false);
  });

  it('accepts an alert correlated to this test, in any case or as a bundle control', () => {
    expect(alertProvesKill(task, { ...alert, achillesTestUuid: '298CC137-EA39-4CF0-9B2D-B1C59A3CBACB' })).toBe(true);
    expect(alertProvesKill(task, { ...alert, achillesTestUuid: '298cc137-ea39-4cf0-9b2d-b1c59a3cbacb::stage-1' })).toBe(true);
  });
});

describe('techniquesOverlap', () => {
  it('matches parent techniques', () => {
    expect(techniquesOverlap(['T1003'], ['T1003.001'])).toBe(true);
    expect(techniquesOverlap(['T1003.002'], ['T1003.001'])).toBe(true);
    expect(techniquesOverlap(['t1003'], ['T1003.001'])).toBe(true);
    expect(techniquesOverlap(['T1003'], ['T1566'])).toBe(false);
  });
});

describe('hostMatches', () => {
  it('is exact on the short name', () => {
    expect(hostMatches('LT4862', ['lt4862.corp.local'])).toBe(true);
    expect(hostMatches('LT4862', ['LT48621'])).toBe(false);
    expect(hostMatches('lt4862.corp', ['LT4862'])).toBe(true);
  });
});

describe('parseSqliteUtc', () => {
  it('treats naive timestamps as UTC regardless of TZ', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'America/Santo_Domingo';
    try {
      expect(parseSqliteUtc('2026-10-26 16:12:59')).toBe(Date.parse('2026-10-26T16:12:59Z'));
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it('accepts ISO strings and returns NaN for garbage', () => {
    expect(parseSqliteUtc('2026-10-26T16:12:59Z')).toBe(Date.parse('2026-10-26T16:12:59Z'));
    expect(parseSqliteUtc('2026-10-26T12:12:59-04:00')).toBe(Date.parse('2026-10-26T16:12:59Z'));
    expect(parseSqliteUtc('nope')).toBeNaN();
  });
});

describe('summarizeTermination', () => {
  it('orders vendors by earliest alert and dedupes', () => {
    const defender: KillEvidenceAlert = { ...alert, id: 'd-1', vendor: 'defender', createdAt: '2026-10-26T16:07:00.000Z' };
    const s1b: KillEvidenceAlert = { ...alert, id: 'a-2', createdAt: '2026-10-26T16:08:00.000Z' };
    const out = summarizeTermination([defender, s1b, alert], '2026-10-26T16:20:00.000Z');
    expect(out).toEqual({
      vendors: ['sentinelone', 'defender'],
      alert_ids: ['a-1', 'd-1', 'a-2'],
      killed_at: '2026-10-26T16:06:32.719Z',
      reconciled_at: '2026-10-26T16:20:00.000Z',
    });
  });
});
