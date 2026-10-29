import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGetSettings = vi.fn();
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getSettings = mockGetSettings;
  }),
}));

const mockHasPrivileges = vi.fn();
const mockExists = vi.fn();
vi.mock('../../analytics/client.js', () => ({
  createEsClient: vi.fn(() => ({ security: { hasPrivileges: mockHasPrivileges }, indices: { exists: mockExists } })),
}));

const ensure = {
  defender: vi.fn(), crowdstrike: vi.fn(), sentinelone: vi.fn(), sentinelonePosture: vi.fn(), sophos: vi.fn(),
};
vi.mock('../../defender/index-management.js', async (orig) => ({
  ...(await orig<typeof import('../../defender/index-management.js')>()),
  ensureDefenderIndex: () => ensure.defender(),
}));
vi.mock('../../crowdstrike/index-management.js', async (orig) => ({
  ...(await orig<typeof import('../../crowdstrike/index-management.js')>()),
  ensureCrowdStrikeIndex: () => ensure.crowdstrike(),
}));
vi.mock('../../sentinelone/index-management.js', async (orig) => ({
  ...(await orig<typeof import('../../sentinelone/index-management.js')>()),
  ensureSentinelOneIndex: () => ensure.sentinelone(),
  ensureSentinelOnePostureIndex: () => ensure.sentinelonePosture(),
}));
vi.mock('../../sophos/index-management.js', async (orig) => ({
  ...(await orig<typeof import('../../sophos/index-management.js')>()),
  ensureSophosIndex: () => ensure.sophos(),
}));

const mockConfiguredVendorKeys = vi.fn().mockReturnValue([]);
vi.mock('../vendor-settings.js', () => ({ configuredVendorKeys: () => mockConfiguredVendorKeys() }));

const {
  checkEdrEs, prepareEdrEs, prepareConfiguredEdrEs, getEdrEsReadiness, resetEdrEsReadiness,
} = await import('../es-readiness.js');

const ES = { configured: true, connectionType: 'direct', node: 'http://es:9200', apiKey: 'k', indexPattern: 'achilles-results-*' };

/** has_privileges answer granting everything except `deny` (`index:privilege`). */
function privileges(deny: string[] = []) {
  return (req: { index: Array<{ names: string[]; privileges: string[] }> }) => {
    const index: Record<string, Record<string, boolean>> = {};
    for (const { names, privileges: privs } of req.index) {
      for (const n of names) {
        index[n] = Object.fromEntries(privs.map((p) => [p, !deny.includes(`${n}:${p}`)]));
      }
    }
    return Promise.resolve({ has_all_requested: deny.length === 0, index });
  };
}

function esError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { meta: { statusCode }, statusCode });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEdrEsReadiness();
  mockGetSettings.mockReturnValue(ES);
  mockHasPrivileges.mockImplementation(privileges());
  mockExists.mockResolvedValue(true);
  for (const fn of Object.values(ensure)) fn.mockResolvedValue(undefined);
});

describe('checkEdrEs (read-only, for Test)', () => {
  it('is not ready when Elasticsearch is not configured', async () => {
    mockGetSettings.mockReturnValue({ configured: false });
    const r = await checkEdrEs('sophos');
    expect(r).toMatchObject({ status: 'not_ready', error: 'Elasticsearch is not configured', missing: [] });
    expect(mockHasPrivileges).not.toHaveBeenCalled();
  });

  it('is ready when the key holds every privilege and the index exists', async () => {
    const r = await checkEdrEs('sophos');
    expect(r).toMatchObject({ status: 'ready', privileges_checked: true, missing: [], recommended: [] });
    expect(ensure.sophos).not.toHaveBeenCalled();
  });

  it('asks for the vendor index privileges and write on the results pattern', async () => {
    await checkEdrEs('sophos');
    const req = mockHasPrivileges.mock.calls[0][0];
    expect(req.index).toEqual(expect.arrayContaining([
      { names: ['achilles-sophos'], privileges: ['read', 'write', 'view_index_metadata', 'create_index', 'manage'] },
      { names: ['achilles-results-*'], privileges: ['read', 'write'] },
    ]));
  });

  it('needs create_index only while the index does not exist', async () => {
    mockHasPrivileges.mockImplementation(privileges(['achilles-sophos:create_index']));
    expect((await checkEdrEs('sophos')).status).toBe('ready');

    mockExists.mockResolvedValue(false);
    const r = await checkEdrEs('sophos');
    expect(r.status).toBe('not_ready');
    expect(r.missing).toEqual([{ index: 'achilles-sophos', privileges: ['create_index'] }]);
  });

  it('flags a key that cannot write the verdict flags onto test results', async () => {
    mockHasPrivileges.mockImplementation(privileges(['achilles-results-*:write']));
    const r = await checkEdrEs('defender');
    expect(r.status).toBe('not_ready');
    expect(r.missing).toEqual([{ index: 'achilles-results-*', privileges: ['write'] }]);
  });

  it('checks every name of a comma-separated results pattern', async () => {
    mockGetSettings.mockReturnValue({ ...ES, indexPattern: 'achilles-results-all, archived-x' });
    await checkEdrEs('defender');
    const req = mockHasPrivileges.mock.calls[0][0];
    expect(req.index).toContainEqual({ names: ['achilles-results-all', 'archived-x'], privileges: ['read', 'write'] });
  });

  it('reports a missing manage privilege as recommended, not blocking', async () => {
    mockHasPrivileges.mockImplementation(privileges(['achilles-crowdstrike:manage']));
    const r = await checkEdrEs('crowdstrike');
    expect(r.status).toBe('ready');
    expect(r.recommended).toEqual([{ index: 'achilles-crowdstrike', privileges: ['manage'] }]);
  });

  it('checks both SentinelOne indices', async () => {
    mockHasPrivileges.mockImplementation(privileges(['achilles-sentinelone-posture:write']));
    const r = await checkEdrEs('sentinelone');
    expect(r.missing).toEqual([{ index: 'achilles-sentinelone-posture', privileges: ['write'] }]);
  });

  it('treats create_index as required when the key cannot even see whether the index exists', async () => {
    mockHasPrivileges.mockImplementation(privileges(['achilles-sophos:view_index_metadata', 'achilles-sophos:create_index']));
    const r = await checkEdrEs('sophos');
    expect(r.missing).toEqual([{ index: 'achilles-sophos', privileges: ['view_index_metadata', 'create_index'] }]);
    expect(mockExists).not.toHaveBeenCalled();
  });

  it('falls back to a reachability check where the cluster cannot report privileges (security disabled)', async () => {
    mockHasPrivileges.mockRejectedValue(esError(400, 'no handler found for uri [/_security/user/_has_privileges]'));
    const r = await checkEdrEs('sophos');
    expect(r).toMatchObject({ status: 'ready', privileges_checked: false, missing: [] });
    expect(mockExists).toHaveBeenCalledWith({ index: 'achilles-sophos' });
  });

  it('is not ready when Elasticsearch rejects the key', async () => {
    mockHasPrivileges.mockRejectedValue(esError(401, 'security_exception: unable to authenticate'));
    const r = await checkEdrEs('sophos');
    expect(r.status).toBe('not_ready');
    expect(r.error).toMatch(/rejected the API key/);
  });

  it('is not ready when Elasticsearch is unreachable', async () => {
    mockHasPrivileges.mockRejectedValue(new Error('connect ECONNREFUSED'));
    mockExists.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const r = await checkEdrEs('sophos');
    expect(r.status).toBe('not_ready');
    expect(r.error).toMatch(/ECONNREFUSED/);
  });
});

describe('prepareEdrEs (Save and startup)', () => {
  it('creates the indices when the key is ready, and stores the result', async () => {
    const r = await prepareEdrEs('sentinelone');
    expect(r.status).toBe('ready');
    expect(ensure.sentinelone).toHaveBeenCalledOnce();
    expect(ensure.sentinelonePosture).toHaveBeenCalledOnce();
    expect(await getEdrEsReadiness('sentinelone')).toEqual(r);
  });

  it('does not try to create anything when privileges are missing', async () => {
    mockExists.mockResolvedValue(false);
    mockHasPrivileges.mockImplementation(privileges(['achilles-sophos:create_index']));
    const r = await prepareEdrEs('sophos');
    expect(r.status).toBe('not_ready');
    expect(ensure.sophos).not.toHaveBeenCalled();
  });

  it('is not ready when creating the index fails, with the reason', async () => {
    ensure.defender.mockRejectedValue(esError(403, 'security_exception: action [indices:admin/create] is unauthorized'));
    const r = await prepareEdrEs('defender');
    expect(r.status).toBe('not_ready');
    expect(r.error).toMatch(/indices:admin\/create/);
  });

  it('never throws', async () => {
    mockGetSettings.mockImplementation(() => { throw new Error('settings file unreadable'); });
    const r = await prepareEdrEs('sophos');
    expect(r).toMatchObject({ status: 'not_ready', error: 'settings file unreadable' });
  });
});

describe('getEdrEsReadiness (persistent notice)', () => {
  it('is null before anything was checked', async () => {
    expect(await getEdrEsReadiness('crowdstrike')).toBeNull();
  });

  it('re-checks a stale not-ready result so the notice clears once the key is fixed', async () => {
    mockExists.mockResolvedValue(false);
    mockHasPrivileges.mockImplementation(privileges(['achilles-sophos:create_index']));
    const first = await prepareEdrEs('sophos');
    expect(first.status).toBe('not_ready');

    mockHasPrivileges.mockImplementation(privileges());
    const soon = Date.parse(first.checked_at) + 30_000;
    expect((await getEdrEsReadiness('sophos', soon))?.status).toBe('not_ready');

    const later = Date.parse(first.checked_at) + 61_000;
    expect((await getEdrEsReadiness('sophos', later))?.status).toBe('ready');
    // The re-check is read-only: the next sync creates the index.
    expect(ensure.sophos).not.toHaveBeenCalled();
  });

  it('a fresh check (Test) replaces the stored result only for a vendor that already has one', async () => {
    mockExists.mockResolvedValue(false);
    mockHasPrivileges.mockImplementation(privileges(['achilles-sophos:create_index']));
    await prepareEdrEs('sophos');
    mockHasPrivileges.mockImplementation(privileges());
    await checkEdrEs('sophos', { refreshStored: true });
    expect((await getEdrEsReadiness('sophos'))?.status).toBe('ready');

    await checkEdrEs('crowdstrike', { refreshStored: true });
    expect(await getEdrEsReadiness('crowdstrike')).toBeNull();
  });

  it('does not re-check a ready result', async () => {
    const first = await prepareEdrEs('crowdstrike');
    mockHasPrivileges.mockClear();
    await getEdrEsReadiness('crowdstrike', Date.parse(first.checked_at) + 3_600_000);
    expect(mockHasPrivileges).not.toHaveBeenCalled();
  });
});

describe('prepareConfiguredEdrEs (startup)', () => {
  it('prepares every configured vendor, including env-var credentials that never go through Save', async () => {
    mockConfiguredVendorKeys.mockReturnValue(['defender', 'sophos']);
    ensure.sophos.mockRejectedValue(esError(403, 'security_exception: action [indices:admin/create] is unauthorized'));
    await prepareConfiguredEdrEs();
    expect(ensure.defender).toHaveBeenCalledOnce();
    expect((await getEdrEsReadiness('defender'))?.status).toBe('ready');
    expect((await getEdrEsReadiness('sophos'))?.status).toBe('not_ready');
    expect(await getEdrEsReadiness('crowdstrike')).toBeNull();
  });

  it('never throws, even when the settings file cannot be read', async () => {
    mockConfiguredVendorKeys.mockImplementation(() => { throw new Error('integrations.json unreadable'); });
    await expect(prepareConfiguredEdrEs()).resolves.toBeUndefined();
  });
});
