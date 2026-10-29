import { describe, it, expect, vi } from 'vitest';

vi.mock('../index-management.js', () => ({
  SOPHOS_INDEX: 'achilles-sophos',
  ensureSophosIndex: vi.fn().mockResolvedValue(undefined),
}));

const { SophosPostureService } = await import('../posture.service.js');
const { SophosApiError } = await import('../sophos-client.js');

type Raw = Record<string, unknown>;
const hit = (src: Raw) => ({ _source: src });
const BUNDLE = 'aaaaaaaa-1111-2222-3333-444444444444';

const healthRaw = {
  endpoint: {
    protection: { computer: { score: 90, total: 5, notFullyProtected: 1 } },
    exclusions: { global: { score: 70 } },
  },
};

function makeClient(over: Raw = {}) {
  const calls: string[] = [];
  const rec = <T>(name: string, v: T) => vi.fn(async () => { calls.push(name); return v; });
  const client = {
    calls,
    healthCheck: rec('healthCheck', healthRaw),
    healthHistory: vi.fn(async () => {
      calls.push('healthHistory');
      return { datapoints: [
        { date: '2026-10-26', endpoint: { protectionComputerScore: 80 } },
        { date: '2026-10-27', endpoint: { protectionComputerScore: 60, exclusionsGlobalScore: 40 } },
        { date: '2026-10-28', endpoint: { protectionComputerScore: 10 } },
      ] };
    }),
    listEndpoints: vi.fn(async () => {
      calls.push('listEndpoints');
      return { items: [
        { id: 'e1', hostname: 'WIN-01', os: { platform: 'windows', isServer: false }, health: { overall: 'bad' }, tamperProtectionSupported: true, tamperProtectionEnabled: false,
          packages: { protection: { status: 'upgradable' } }, lastSeenAt: '2026-10-01T00:00:00Z', isolation: { status: 'isolated' }, assignedProducts: [{ code: 'xdr', version: '1' }] },
        { id: 'e2', hostname: 'LNX-01', os: { platform: 'linux' }, health: { overall: 'good' }, tamperProtectionEnabled: true,
          packages: { protection: { status: 'assigned' } }, lastSeenAt: new Date().toISOString(), isolation: { status: 'notIsolated' }, assignedProducts: [] },
      ] };
    }),
    async *paginateKey<T>(fetchPage: (k?: string) => Promise<{ items: T[]; nextKey?: string }>) {
      const r = await fetchPage();
      if (r.items.length) yield r.items;
    },
    listPolicies: vi.fn(async (t: string) => {
      calls.push(`listPolicies:${t}`);
      return t === 'threat-protection' ? [{ id: 'p1', name: 'Base', type: 'threat-protection', enabled: true, appliesTo: { endpoints: ['e1', 'e2'] } }] : [];
    }),
    getPolicySettings: vi.fn(async () => {
      calls.push('getPolicySettings');
      return {
        'endpoint.threat-protection.malware-protection.deep-learning.enabled': { value: false, recommendedValue: true },
        'endpoint.threat-protection.malware-protection.on-access.enabled': { value: true, recommendedValue: true },
        'endpoint.threat-protection.malware-protection.scheduled-scan.enabled': { value: false, recommendedValue: true }, // not protection-relevant
      };
    }),
    listScanningExclusions: rec('listScanningExclusions', [{ id: 'x1', value: 'C:\\F0\\', type: 'path', scanMode: 'onDemandAndOnAccess' }]),
    listAllowedItems: rec('listAllowedItems', [{ id: 'a1', type: 'certificateSigner', properties: { certificateSigner: 'F0RT1KA Test Signing' } }]),
    ...over,
  };
  return client;
}

function makeEs(searchImpl?: (params: Raw) => unknown) {
  return {
    bulk: vi.fn().mockResolvedValue({ errors: false, items: [] }),
    deleteByQuery: vi.fn().mockResolvedValue({}),
    index: vi.fn().mockResolvedValue({}),
    search: vi.fn(async (p: Raw) => (searchImpl ? searchImpl(p) : { hits: { total: { value: 1 }, hits: [] } })),
  };
}
const bulkDocs = (es: ReturnType<typeof makeEs>) =>
  es.bulk.mock.calls.flatMap((c) => (c[0] as { operations: Raw[] }).operations).filter((o) => 'doc_type' in o);

describe('SophosPostureService.runPosturePass', () => {
  it('stores snapshots of every posture doc type and prunes earlier snapshots', async () => {
    const c = makeClient();
    const es = makeEs();
    const r = await new SophosPostureService(es as never, c as never).runPosturePass();
    expect(r).toMatchObject({ healthCheck: true, endpoints: 2, policies: 1, exclusions: 1, allowedItems: 1, errors: [] });
    const docs = bulkDocs(es);
    expect(docs.map((d) => d.doc_type).sort()).toEqual(['allowed_item', 'endpoint_health', 'endpoint_health', 'exclusion', 'policy']);
    expect(es.deleteByQuery).toHaveBeenCalledTimes(4);
    const ep = docs.find((d) => d.doc_type === 'endpoint_health' && (d.endpoint as Raw).hostname === 'WIN-01') as Raw;
    expect(ep.endpoint).toMatchObject({ tamper_off: true, out_of_date: true, isolated: true, health_bad: true, xdr_installed: true, not_seen_7d: true });
    const pol = docs.find((d) => d.doc_type === 'policy') as Raw;
    // only the protection-relevant key that differs from recommended
    expect((pol.policy as Raw).deviations).toEqual([
      { key: 'malware-protection.deep-learning.enabled', value: false, recommended: true },
    ]);
    const hc = es.index.mock.calls.map((x) => x[0] as { id: string; document: Raw }).find((x) => x.document.doc_type === 'health_check');
    expect(hc?.id).toMatch(/^hc-\d{4}-\d{2}-\d{2}-\d{2}$/);
    expect((hc?.document.health as Raw).headline).toBe(80);
  });

  it('never calls the tamper-protection route (the client has no such method and none is invoked)', async () => {
    const c = makeClient();
    await new SophosPostureService(makeEs() as never, c as never).runPosturePass();
    expect(c.calls.filter((n) => /tamper/i.test(n))).toEqual([]);
    expect(Object.keys(c).filter((k) => /tamper/i.test(k))).toEqual([]);
    expect(c.calls).toEqual(expect.arrayContaining(['healthCheck', 'listEndpoints', 'listScanningExclusions', 'listAllowedItems']));
  });

  it('a failing step records its error and later steps still run', async () => {
    const c = makeClient({ listEndpoints: vi.fn().mockRejectedValue(new SophosApiError('nope', 403, '')) });
    const r = await new SophosPostureService(makeEs() as never, c as never).runPosturePass();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^endpoints: /);
    expect(r).toMatchObject({ healthCheck: true, endpoints: 0, policies: 1, exclusions: 1, allowedItems: 1 });
  });

  it('imports 30 days of history only for days without a live snapshot', async () => {
    const c = makeClient();
    const es = makeEs((p) => {
      const q = JSON.stringify(p.query ?? {});
      if (q.includes('sophos_history') && !q.includes('must_not')) return { hits: { total: { value: 0 }, hits: [] } }; // no history yet
      if (q.includes('"health_check"')) return { hits: { total: { value: 1 }, hits: [hit({ timestamp: '2026-10-27T09:00:00.000Z' })] } }; // live snapshot on the 27th
      return { hits: { total: { value: 0 }, hits: [] } };
    });
    const n = await new SophosPostureService(es as never, c as never).importHistory();
    expect(n).toBe(2);
    const sent = es.bulk.mock.calls[0][0] as { operations: Raw[] };
    const ids = sent.operations.filter((o) => 'index' in o).map((o) => (o.index as Raw)._id);
    expect(ids).toEqual(['hc-2026-10-26-hist', 'hc-2026-10-28-hist']);
    const docs = sent.operations.filter((o) => 'doc_type' in o);
    expect(docs[0]).toMatchObject({ doc_type: 'health_check', source: 'sophos_history', timestamp: '2026-10-26T12:00:00.000Z' });
    // the history window is 30 days
    const arg = c.healthHistory.mock.calls[0] as unknown as [{ startDate: string; endDate: string }];
    expect((Date.parse(arg[0].endDate) - Date.parse(arg[0].startDate)) / 86_400_000).toBeGreaterThanOrEqual(29);
    // Sophos answers HTTP 400 to anything but a plain date, even its own
    // spec example (midnight ISO timestamp); verified on a live tenant.
    expect(arg[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg[0].endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('SophosPostureService.getExclusionGaps', () => {
  const cert = { subjectCn: 'F0RT1KA Test Signing', sha256: 'AB:CD:EF:01' };
  function esWith(docs: { exclusion?: Raw[]; allowed?: Raw[]; endpoints?: Raw[]; results?: Raw[] }) {
    return makeEs((p) => {
      if (p.index === 'results-*') return { hits: { hits: (docs.results ?? []).map(hit) } };
      const q = JSON.stringify(p.query ?? {});
      const pick = (arr: Raw[] = []) => ({ hits: { hits: arr.map(hit) } });
      if (q.includes('"exclusion"')) return pick(docs.exclusion);
      if (q.includes('"allowed_item"')) return pick(docs.allowed);
      if (q.includes('"endpoint_health"')) return pick(docs.endpoints);
      return pick();
    });
  }
  const svc = (es: ReturnType<typeof makeEs>) => new SophosPostureService(es as never, makeClient() as never);

  it('flags a certificate allow for the active Achilles signing cert as critical', async () => {
    const es = esWith({ allowed: [
      { allowed_item: { item_id: 'a1', type: 'certificateSigner', value: 'f0rt1ka test signing' } },
      { allowed_item: { item_id: 'a2', type: 'certificateSigner', value: 'Some Other CA' } },
    ] });
    const r = await svc(es).getExclusionGaps('results-*', null, cert);
    expect(r.critical).toHaveLength(1);
    expect(r.critical[0]).toMatchObject({ kind: 'certificate_allow', value: 'f0rt1ka test signing' });
    expect(r.critical[0].detail).toMatch(/every Achilles test/);
  });

  it('matches a certificate allow by normalized SHA-256 too', async () => {
    const es = esWith({ allowed: [{ allowed_item: { item_id: 'a1', type: 'certificateSigner', value: 'x', sha256: 'abcdef01' } }] });
    const r = await svc(es).getExclusionGaps('results-*', null, cert);
    expect(r.critical.map((c) => c.kind)).toEqual(['certificate_allow']);
  });

  it('skips the certificate check with a note when no signing cert is active', async () => {
    const es = esWith({ allowed: [{ allowed_item: { item_id: 'a1', type: 'certificateSigner', value: 'F0RT1KA Test Signing' } }] });
    const r = await svc(es).getExclusionGaps('results-*', null, null);
    expect(r.critical).toEqual([]);
    expect(r.notes).toContain('cert_unavailable');
  });

  it('flags a C:\\F0 folder exclusion as critical, and an agent process exclusion', async () => {
    const es = esWith({ exclusion: [
      { exclusion: { exclusion_id: 'x1', type: 'path', value: 'C:\\F0\\', scan_mode: 'onDemandAndOnAccess' } },
      { exclusion: { exclusion_id: 'x2', type: 'posixPath', value: '/opt/f0/*' } },
      { exclusion: { exclusion_id: 'x3', type: 'process', value: 'C:\\F0\\achilles-agent.exe' } },
      { exclusion: { exclusion_id: 'x4', type: 'path', value: 'C:\\Program Files\\App\\' } },
    ] });
    const r = await svc(es).getExclusionGaps('results-*', null, cert);
    expect(r.critical.map((c) => [c.kind, c.value])).toEqual([
      ['folder_exclusion', 'C:\\F0\\'],
      ['folder_exclusion', '/opt/f0/*'],
      ['agent_process_exclusion', 'C:\\F0\\achilles-agent.exe'],
    ]);
  });

  it('lists unprotected runs on Sophos-managed hosts whose binary path is excluded', async () => {
    const es = esWith({
      exclusion: [{ exclusion: { exclusion_id: 'x1', type: 'path', value: 'C:\\F0\\', scan_mode: 'onAccess' } }],
      endpoints: [{ endpoint: { hostname: 'WIN-01', os_platform: 'windows' } }],
      results: [
        { routing: { hostname: 'win-01', event_time: '2026-10-28T10:00:00Z' }, f0rtika: { test_uuid: BUNDLE } },
        { routing: { hostname: 'OTHER', event_time: '2026-10-28T10:00:00Z' }, f0rtika: { test_uuid: BUNDLE } }, // not Sophos-managed
      ],
    });
    const r = await svc(es).getExclusionGaps('results-*', null, null);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ testUuid: BUNDLE, hostname: 'WIN-01', exclusion: 'C:\\F0\\', lastRunAt: '2026-10-28T10:00:00Z' });
    const resultsQuery = JSON.stringify(es.search.mock.calls.find((c) => (c[0] as Raw).index === 'results-*')?.[0]);
    expect(resultsQuery).toContain('f0rtika.sophos_detected');
  });
});
