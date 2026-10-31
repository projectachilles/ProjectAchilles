import { describe, it, expect, vi } from 'vitest';
import {
  alertsForTestTiers,
  findAlertsForTest,
  findAlertsForTests,
  parseAlertsForTestsBody,
  type AlertsForTestDeps,
  type AlertsForTestRequest,
} from '../alertsForTest.js';

const deps: AlertsForTestDeps = {
  index: 'alerts-idx',
  buildEvidenceQuery: (input) => ({ evidence: input.test_uuid, host: input.routing_hostname }),
  buildTimeWindow: (from, to) => ({ window: [from, to] }),
};

const STAGE: AlertsForTestRequest = {
  techniques: ['T1059'],
  timestamp: '2026-10-31T10:00:00Z',
  windowMinutes: 30,
  hostname: 'host-1',
  binaryName: 'aaaa-bbbb.exe',
  bundleName: 'Chain',
};

const hit = (id: string, techniques: string[], created = '2026-10-31T10:01:00Z') => ({
  _source: { alert_id: id, mitre_techniques: techniques, created_at: created, evidence_filenames: [] },
});
const page = (total: number, hits: unknown[] = []) => ({ hits: { total: { value: total }, hits } });

describe('alertsForTestTiers', () => {
  it('plans evidence, then technique+host when the binary and host are known', () => {
    const tiers = alertsForTestTiers(STAGE, deps);
    expect(tiers).toHaveLength(2);
    expect(JSON.stringify(tiers[0].query)).toContain('aaaa-bbbb');
    expect(JSON.stringify(tiers[1].query)).toContain('HOST-1*');
  });

  it('does not repeat the technique+host query as a third tier', () => {
    // The old code ran a host-scoped "technique-only" search after an empty
    // technique+host search: the same clauses, so always the same empty answer.
    const tiers = alertsForTestTiers({ ...STAGE, binaryName: undefined }, deps);
    expect(tiers).toHaveLength(1);
  });

  it('falls back to technique-only without a host', () => {
    const tiers = alertsForTestTiers({ ...STAGE, hostname: undefined, binaryName: undefined }, deps);
    expect(tiers).toHaveLength(1);
    expect(JSON.stringify(tiers[0].query)).not.toContain('evidence_hostnames');
  });

  it('skips the evidence tier when the builder returns null', () => {
    expect(alertsForTestTiers(STAGE, { ...deps, buildEvidenceQuery: () => null })).toHaveLength(1);
  });
});

describe('findAlertsForTests (msearch per tier)', () => {
  it('answers every stage in one round trip per tier, in input order', async () => {
    const msearch = vi.fn()
      // tier 1 for all three: A hits evidence, B and C don't
      .mockResolvedValueOnce({ responses: [page(1, [hit('a1', ['T1059'])]), page(0), page(0)] })
      // tier 2 only for B (C had a single tier already)
      .mockResolvedValueOnce({ responses: [page(2, [hit('b1', ['T1059']), hit('b2', ['T1003'])])] });
    const client = { msearch, search: vi.fn() };

    const results = await findAlertsForTests(client as never, [
      STAGE,
      { ...STAGE, techniques: ['T1059', 'T1003'] },
      { ...STAGE, binaryName: undefined },
    ], deps);

    expect(msearch).toHaveBeenCalledTimes(2);
    expect(client.search).not.toHaveBeenCalled();
    expect(msearch.mock.calls[0][0].searches).toHaveLength(6); // header + body per stage
    expect(msearch.mock.calls[1][0].searches).toHaveLength(2);
    expect(results.map((r) => r?.total)).toEqual([1, 2, 0]);
    expect(results[1]?.matchedTechniques.sort()).toEqual(['T1003', 'T1059']);
    expect(results[2]).toEqual({ alerts: [], matchedTechniques: [], total: 0 });
  });

  it('returns null for a stage whose search failed, without failing the others', async () => {
    const msearch = vi.fn().mockResolvedValueOnce({
      responses: [{ error: { type: 'search_phase_execution_exception' }, status: 400 }, page(1, [hit('x', ['T1059'])])],
    });
    const results = await findAlertsForTests({ msearch } as never, [
      { ...STAGE, binaryName: undefined },
      { ...STAGE, binaryName: undefined },
    ], deps);
    expect(results[0]).toBeNull();
    expect(results[1]?.total).toBe(1);
  });

  it('gives the same answer as the single-stage path', async () => {
    const responses = [page(0), page(1, [hit('h', ['T1059'])])];
    const search = vi.fn().mockResolvedValueOnce(responses[0]).mockResolvedValueOnce(responses[1]);
    const single = await findAlertsForTest({ search } as never, STAGE, deps);

    const msearch = vi.fn()
      .mockResolvedValueOnce({ responses: [responses[0]] })
      .mockResolvedValueOnce({ responses: [responses[1]] });
    const [batched] = await findAlertsForTests({ msearch } as never, [STAGE], deps);

    expect(batched).toEqual(single);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('parseAlertsForTestsBody', () => {
  it('accepts a list of stages and applies the 30-minute default window', () => {
    const items = parseAlertsForTestsBody({ items: [{ techniques: ['T1059'], timestamp: STAGE.timestamp, hostname: 'h' }] });
    expect(items[0]).toMatchObject({ techniques: ['T1059'], windowMinutes: 30, hostname: 'h' });
  });

  it.each([
    [{}, 'items is required'],
    [{ items: [] }, 'items is required'],
    [{ items: Array.from({ length: 101 }, () => ({ techniques: ['T1'], timestamp: STAGE.timestamp })) }, 'At most 100 items'],
    [{ items: [{ techniques: [], timestamp: STAGE.timestamp }] }, 'techniques and timestamp are required'],
    [{ items: [{ techniques: ['T1'], timestamp: 'not-a-date' }] }, 'Invalid timestamp'],
    [{ items: [{ techniques: ['T1'], timestamp: STAGE.timestamp, windowMinutes: 0 }] }, 'Invalid windowMinutes'],
    [{ items: [{ techniques: ['T1'], timestamp: STAGE.timestamp, hostname: 5 }] }, 'Invalid hostname'],
  ])('rejects %j', (body, message) => {
    expect(() => parseAlertsForTestsBody(body)).toThrow(message);
  });
});
