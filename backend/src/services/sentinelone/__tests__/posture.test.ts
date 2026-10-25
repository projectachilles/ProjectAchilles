import { describe, it, expect, vi } from 'vitest';

vi.mock('../index-management.js', () => ({
  SENTINELONE_POSTURE_INDEX: 'achilles-sentinelone-posture',
  ensureSentinelOnePostureIndex: vi.fn().mockResolvedValue(undefined),
}));

const {
  pathExclusionCovers, achillesTestPaths, summarizePolicy, toExclusionDoc, exclusionAppliesTo, normalizeOs, SentinelOnePostureService,
} = await import('../posture.service.js');
const { SentinelOneApiError } = await import('../s1-client.js');

describe('pathExclusionCovers', () => {
  const win = achillesTestPaths('windows', 'ABC-uuid')[0]; // c:\f0\tasks\task-0\abc-uuid.exe
  it.each([
    [{ value: 'C:\\F0\\', path_exclusion_type: 'subfolders' }, true],
    [{ value: 'C:\\F0', path_exclusion_type: 'subfolders' }, true],
    [{ value: 'c:\\f0\\tasks\\*', path_exclusion_type: 'subfolders' }, true],
    [{ value: 'C:\\F0', path_exclusion_type: 'folder' }, false], // only direct children
    [{ value: 'C:\\F0\\tasks\\task-*', path_exclusion_type: 'folder' }, true],
    [{ value: 'C:\\F0\\tasks\\task-0\\abc-uuid.exe', path_exclusion_type: 'file' }, true],
    [{ value: '*\\abc-uuid.exe', path_exclusion_type: 'file' }, true],
    [{ value: 'C:\\Program Files\\', path_exclusion_type: 'subfolders' }, false],
    [{ value: 'C:\\F0\\', path_exclusion_type: 'subfolders', os_type: 'linux' }, false],
    [{ value: '%SystemDrive%\\F0\\' }, true],
  ])('%j → %s', (x, expected) => {
    expect(pathExclusionCovers(x, win, 'windows')).toBe(expected);
  });
  it('linux paths', () => {
    const p = achillesTestPaths('linux', 'u1')[0];
    expect(pathExclusionCovers({ value: '/opt/f0/', path_exclusion_type: 'subfolders', os_type: 'linux' }, p, 'linux')).toBe(true);
    expect(pathExclusionCovers({ value: '/opt/F0/', path_exclusion_type: 'subfolders' }, p, 'linux')).toBe(false); // case-sensitive
  });
});

describe('posture helpers', () => {
  it('summarizePolicy reports settings as-is (no score)', () => {
    const s = summarizePolicy({
      mitigationMode: 'detect', mitigationModeSuspicious: 'detect', antiTamperingOn: false, snapshotsOn: true,
      autoMitigationAction: 'mitigation.quarantineThreat', engines: { reputation: 'on', preExecution: 'off', exploits: 'on' },
      agentUi: { agentUiOn: true },
    });
    expect(s).toEqual({
      mitigation_mode: 'detect', mitigation_mode_suspicious: 'detect', auto_mitigation_action: 'mitigation.quarantineThreat',
      anti_tampering_on: false, snapshots_on: true, agent_ui_on: true, engines_on: ['exploits', 'reputation'], engines_off: ['preExecution'],
    });
    expect(Object.keys(s).some((k) => /score/i.test(k))).toBe(false);
  });
  it('toExclusionDoc / exclusionAppliesTo / normalizeOs', () => {
    const x = toExclusionDoc({ id: 9, type: 'path', value: 'C:\\F0\\', osType: 'windows', pathExclusionType: 'subfolders', mode: 'suppress', scopeName: 'Prod', siteId: '22' })!;
    expect(x).toMatchObject({ exclusion_id: '9', exclusion_type: 'path', site_id: '22', scope_name: 'Prod' });
    expect(exclusionAppliesTo(x, { site_id: '22' })).toBe(true);
    expect(exclusionAppliesTo(x, { site_id: '23' })).toBe(false);
    expect(exclusionAppliesTo({ ...x, site_id: undefined }, { site_id: '23' })).toBe(true); // global
    expect(normalizeOs('windows_legacy')).toBe('windows');
    expect(normalizeOs('macos')).toBe('macos');
  });
});

describe('SentinelOnePostureService.runPosturePass', () => {
  function client() {
    return {
      async *paginate(fetchPage: (p: Record<string, unknown>) => Promise<{ data: unknown[] }>, params: Record<string, unknown>) {
        const r = await fetchPage(params);
        if (r.data.length) yield r.data;
      },
      listExclusions: vi.fn()
        .mockRejectedValueOnce(new SentinelOneApiError('bad filter', 400, ''))
        .mockResolvedValue({ data: [{ id: '1', type: 'path', value: 'C:\\F0\\' }, { id: '2', type: 'white_hash', value: 'abc' }] }),
      listSites: vi.fn().mockResolvedValue({ data: [{ id: '22', name: 'Prod', accountId: '11' }] }),
      listGroups: vi.fn().mockResolvedValue({ data: [{ id: '33', name: 'Default', siteId: '22', inherits: true }, { id: '34', name: 'Lab', siteId: '22', inherits: false }] }),
      getPolicy: vi.fn().mockResolvedValue({ mitigationMode: 'protect', engines: { reputation: 'on' } }),
      listAgents: vi.fn().mockResolvedValue({ data: [{ id: '5', computerName: 'win-01', osType: 'windows', isActive: true, mitigationMode: 'detect' }] }),
      countAgents: vi.fn().mockImplementation(async (p: Record<string, unknown>) => {
        if (p.mitigationMode) throw new SentinelOneApiError('unknown filter', 400, '');
        return 4;
      }),
    };
  }
  function es() {
    return {
      bulk: vi.fn().mockResolvedValue({ errors: false, items: [] }),
      deleteByQuery: vi.fn().mockResolvedValue({}),
      index: vi.fn().mockResolvedValue({}),
    };
  }

  it('uses GETs only, stores snapshots, prunes older ones, and falls back to the inventory for a failed count', async () => {
    const c = client();
    const e = es();
    const r = await new SentinelOnePostureService(e as never, c as never).runPosturePass({ scope: { site_ids: ['22'] } } as never);
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ exclusions: 2, agents: 1, policies: 3 }); // site + 2 groups
    // 400 on includeParents → retried with the plain scope
    expect(c.listExclusions.mock.calls[0][0]).toMatchObject({ includeParents: true });
    expect(c.listExclusions.mock.calls[1][0]).not.toHaveProperty('includeParents');
    // inherited group policy isn't fetched
    expect(c.getPolicy.mock.calls.map((x) => x.slice(0, 2))).toEqual([['site', '22'], ['group', '34']]);
    expect(r.agentHealth).toEqual({ total: 4, active: 4, infected: 4, outdated: 4, detect_only: 1, disconnected: 4 });
    expect(e.deleteByQuery).toHaveBeenCalledTimes(3);
    expect(e.index.mock.calls[0][0].document).toMatchObject({ doc_type: 'agent_health' });
  });
});

describe('SentinelOnePostureService.runPosturePass — partial permissions (live: 403 on account policy and /agents)', () => {
  it('a 403 on one scope keeps the others; unreadable agent counts are stored with the reason', async () => {
    const forbidden = () => new SentinelOneApiError('HTTP 403 Insufficient permissions', 403, '');
    const c = {
      async *paginate(fetchPage: (p: Record<string, unknown>) => Promise<{ data: unknown[] }>, params: Record<string, unknown>) {
        const r = await fetchPage(params);
        if (r.data.length) yield r.data;
      },
      listExclusions: vi.fn().mockResolvedValue({ data: [] }),
      listSites: vi.fn().mockResolvedValue({ data: [{ id: '22', name: 'Prod' }] }),
      listGroups: vi.fn().mockResolvedValue({ data: [] }),
      getPolicy: vi.fn().mockImplementation(async (level: string) => {
        if (level === 'account') throw forbidden();
        return { mitigationMode: 'protect' };
      }),
      listAgents: vi.fn().mockRejectedValue(forbidden()),
      countAgents: vi.fn().mockRejectedValue(forbidden()),
    };
    const e = { bulk: vi.fn().mockResolvedValue({ errors: false, items: [] }), deleteByQuery: vi.fn().mockResolvedValue({}), index: vi.fn().mockResolvedValue({}) };
    const r = await new SentinelOnePostureService(e as never, c as never).runPosturePass({ scope: { account_ids: ['11'] } } as never);
    expect(r.policies).toBe(2);
    const policyDocs = e.bulk.mock.calls.flatMap((call) => call[0].operations).filter((o: Record<string, unknown>) => o.doc_type === 'policy');
    expect(policyDocs.find((d: Record<string, unknown>) => d.level === 'account')).toMatchObject({ policy_error: 'HTTP 403', engines_on: [] });
    expect(policyDocs.find((d: Record<string, unknown>) => d.level === 'site')).toMatchObject({ mitigation_mode: 'protect' });
    expect(policyDocs.find((d: Record<string, unknown>) => d.level === 'site')).not.toHaveProperty('policy_error');
    expect(r.agentHealth).toBeNull();
    expect(e.index.mock.calls[0][0].document).toMatchObject({ doc_type: 'agent_health', counts_error: 'HTTP 403', counts: { total: null } });
    expect(r.errors.map((x) => x.split(':')[0])).toEqual(['policies', 'agents', 'agent_health']);
  });
});

describe('SentinelOnePostureService.getExclusionGaps', () => {
  it('flags missed tests on S1 hosts covered by an applicable path exclusion', async () => {
    const search = vi.fn().mockImplementation(async (req: { index: string; query: unknown }) => {
      const q = JSON.stringify(req.query);
      if (req.index === 'achilles-results-*') {
        return { hits: { hits: [
          { _source: { routing: { hostname: 'win-01', event_time: '2026-10-20T00:00:00Z' }, f0rtika: { test_uuid: 'aaa', bundle_id: 'aaa', test_name: 'T' } } },
          { _source: { routing: { hostname: 'win-01' }, f0rtika: { test_uuid: 'aaa' } } }, // duplicate host+test
          { _source: { routing: { hostname: 'other' }, f0rtika: { test_uuid: 'bbb' } } }, // not an S1 host
        ] } };
      }
      if (q.includes('"exclusion"')) {
        return { hits: { hits: [
          { _source: { exclusion_id: '1', exclusion_type: 'path', value: 'C:\\F0\\', path_exclusion_type: 'subfolders', site_id: '22' } },
          { _source: { exclusion_id: '2', exclusion_type: 'path', value: 'C:\\F0\\', site_id: '99' } }, // other site
          { _source: { exclusion_id: '3', exclusion_type: 'white_hash', value: 'abc' } },
        ] } };
      }
      return { hits: { hits: [{ _source: { computer_name: 'WIN-01', os_type: 'windows', site_id: '22' } }] } };
    });
    const r = await new SentinelOnePostureService({ search } as never, {} as never).getExclusionGaps('achilles-results-*', null);
    expect(r).toMatchObject({ exclusionsTotal: 3, unmatchable: 1, s1Agents: 1, missedOnS1Hosts: 1, missedOnOtherHosts: 1 });
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged[0]).toMatchObject({ test_uuid: 'aaa', hostname: 'WIN-01', os: 'windows' });
    expect(r.flagged[0].exclusions.map((x) => x.exclusion_id)).toEqual(['1']);
    const resultsQuery = JSON.stringify(search.mock.calls.find((c) => c[0].index === 'achilles-results-*')![0].query);
    expect(resultsQuery).toContain('"event.ERROR":101');
    expect(resultsQuery).toContain('"f0rtika.sentinelone_detected":true');
  });

  it('pages through more agents than one search can return (max_result_window is 10,000)', async () => {
    const fleet = Array.from({ length: 12_001 }, (_, i) => ({ _source: { computer_name: `host-${i}`, os_type: 'windows' }, sort: [String(i).padStart(6, '0')] }));
    const search = vi.fn().mockImplementation(async (req: { index: string; query: unknown; size: number; search_after?: string[] }) => {
      if (req.index === 'achilles-results-*') {
        return { hits: { hits: [{ _source: { routing: { hostname: 'host-12000' }, f0rtika: { test_uuid: 'aaa' } } }] } };
      }
      if (JSON.stringify(req.query).includes('"exclusion"')) return { hits: { hits: [] } };
      const start = req.search_after ? Number(req.search_after[0]) + 1 : 0;
      return { hits: { hits: fleet.slice(start, start + req.size) } };
    });
    const r = await new SentinelOnePostureService({ search } as never, {} as never).getExclusionGaps('achilles-results-*', null);
    expect(r).toMatchObject({ s1Agents: 12_001, missedOnS1Hosts: 1, missedOnOtherHosts: 0 });
    const agentCalls = search.mock.calls.filter((c) => JSON.stringify(c[0].query).includes('"agent"'));
    expect(agentCalls.every((c) => c[0].size <= 10_000)).toBe(true);
  });

  it('a missing posture index reads as empty', async () => {
    const search = vi.fn().mockRejectedValue(Object.assign(new Error('index_not_found'), { meta: { statusCode: 404 } }));
    const svc = new SentinelOnePostureService({ search } as never, {} as never);
    await expect(svc.getPolicies()).resolves.toEqual([]);
    await expect(svc.getAgentHealth()).resolves.toEqual({ latest: null, trend: [] });
  });
});
