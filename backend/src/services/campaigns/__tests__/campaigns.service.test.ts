import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;
vi.mock('../../agent/database.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent/database.js')>()),
  getDatabase: () => testDb,
}));
vi.mock('../../outcomes/edr.js', () => ({ fetchEdrDocs: async () => ({ status: 'not_configured', docs: new Map() }) }));
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class { isDefenderConfigured() { return false; } isCrowdStrikeConfigured() { return false; } isSentinelOneConfigured() { return false; } isSophosConfigured() { return false; } },
}));
vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: (uuid: string) => (uuid.startsWith('bad-') ? null : { uuid, name: `Test ${uuid}` }),
}));

const svc = await import('../campaigns.service.js');

const base = (o: Partial<import('../campaigns.service.js').CampaignInput> = {}) => ({
  name: 'Camp',
  test_uuids: ['t1'],
  agent_ids: ['a1'],
  ...o,
});

function expectErr(fn: () => unknown, status: number, msg: string) {
  try {
    fn();
  } catch (e) {
    const err = e as { statusCode: number; message: string };
    expect(err.statusCode).toBe(status);
    expect(err.message).toBe(msg);
    return;
  }
  throw new Error('expected throw');
}

describe('campaigns.service', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    insertTestAgent(testDb, { id: 'a1', org_id: 'org-1' });
    insertTestAgent(testDb, { id: 'a2', org_id: 'org-1', hostname: 'h2' });
    insertTestAgent(testDb, { id: 'b1', org_id: 'org-2', hostname: 'h3' });
  });

  it('creates with trimmed name and de-duplicated ids', () => {
    const c = svc.createCampaign(
      base({ name: '  My Camp  ', test_uuids: ['t1', 't1', 't2'], agent_ids: ['a1', 'a1', 'a2'] }),
      'org-1',
      'user-1',
    );
    expect(c.name).toBe('My Camp');
    expect(c.test_uuids).toEqual(['t1', 't2']);
    expect(c.agent_ids).toEqual(['a1', 'a2']);
    expect(c.org_id).toBe('org-1');
    expect(c.created_by).toBe('user-1');
  });

  it('rejects duplicate name in same org with 409, allows other org', () => {
    svc.createCampaign(base(), 'org-1', 'u');
    expectErr(() => svc.createCampaign(base(), 'org-1', 'u'), 409, 'A campaign with this name already exists');
    expect(() => svc.createCampaign(base({ agent_ids: ['b1'] }), 'org-2', 'u')).not.toThrow();
  });

  it('validates counts and name', () => {
    expectErr(() => svc.createCampaign(base({ test_uuids: [] }), 'org-1', 'u'), 400, 'A campaign needs at least 1 test');
    const many = Array.from({ length: 101 }, (_, i) => `t${i}`);
    expectErr(() => svc.createCampaign(base({ test_uuids: many }), 'org-1', 'u'), 400, 'A campaign can have at most 100 tests');
    expectErr(() => svc.createCampaign(base({ agent_ids: [] }), 'org-1', 'u'), 400, 'A campaign needs at least 1 agent');
    expectErr(() => svc.createCampaign(base({ name: '   ' }), 'org-1', 'u'), 400, 'Campaign name must be 1-120 characters');
    expectErr(() => svc.createCampaign(base({ name: 'x'.repeat(121) }), 'org-1', 'u'), 400, 'Campaign name must be 1-120 characters');
  });

  it('rejects unknown test', () => {
    expectErr(() => svc.createCampaign(base({ test_uuids: ['bad-1'] }), 'org-1', 'u'), 400, 'Unknown test bad-1');
  });

  it('rejects cross-org and unknown agents with the same message', () => {
    expectErr(() => svc.createCampaign(base({ agent_ids: ['b1'] }), 'org-1', 'u'), 400, 'Agent b1 does not belong to your organization');
    expectErr(() => svc.createCampaign(base({ agent_ids: ['nope'] }), 'org-1', 'u'), 400, 'Agent nope does not belong to your organization');
  });

  it('no-org caller may use any agent; unknown still rejected', () => {
    expect(() => svc.assertAgentsInOrg(['a1', 'b1'], undefined)).not.toThrow();
    expectErr(() => svc.assertAgentsInOrg(['nope'], undefined), 400, 'Agent nope does not belong to your organization');
  });

  it('get/update/delete cross-org give 404; no-org sees all', () => {
    const c = svc.createCampaign(base(), 'org-1', 'u');
    expectErr(() => svc.getCampaign(c.id, 'org-2'), 404, 'Campaign not found');
    expectErr(() => svc.updateCampaign(c.id, base(), 'org-2'), 404, 'Campaign not found');
    expectErr(() => svc.deleteCampaign(c.id, 'org-2'), 404, 'Campaign not found');
    expect(svc.getCampaign(c.id, undefined).id).toBe(c.id);
    expect(svc.getCampaign(c.id, 'org-1').id).toBe(c.id);
  });

  it('updates fields, keeps org, bumps updated_at, enforces name uniqueness', () => {
    const c = svc.createCampaign(base(), 'org-1', 'u');
    svc.createCampaign(base({ name: 'Other' }), 'org-1', 'u');
    const u = svc.updateCampaign(c.id, base({ name: 'Renamed', description: 'd', framework_label: 'NIST', test_uuids: ['t2'], agent_ids: ['a2'] }), 'org-1');
    expect(u).toMatchObject({ name: 'Renamed', description: 'd', framework_label: 'NIST', test_uuids: ['t2'], agent_ids: ['a2'], org_id: 'org-1', created_at: c.created_at });
    // keeping own name is fine
    expect(() => svc.updateCampaign(c.id, base({ name: 'Renamed' }), 'org-1')).not.toThrow();
    expectErr(() => svc.updateCampaign(c.id, base({ name: 'Other' }), 'org-1'), 409, 'A campaign with this name already exists');
  });

  it('update validates agents against the campaign org even for no-org caller', () => {
    const c = svc.createCampaign(base(), 'org-1', 'u');
    expectErr(() => svc.updateCampaign(c.id, base({ agent_ids: ['b1'] }), undefined), 400, 'Agent b1 does not belong to your organization');
  });

  it('deletes', () => {
    const c = svc.createCampaign(base(), 'org-1', 'u');
    svc.deleteCampaign(c.id, 'org-1');
    expectErr(() => svc.getCampaign(c.id, 'org-1'), 404, 'Campaign not found');
  });

  it('lists filtered by org with last_run', async () => {
    const c1 = svc.createCampaign(base(), 'org-1', 'u');
    svc.createCampaign(base({ agent_ids: ['b1'] }), 'org-2', 'u');
    expect((await svc.listCampaigns('org-1')).map((c) => c.id)).toEqual([c1.id]);
    expect((await svc.listCampaigns(undefined))).toHaveLength(2);
    expect((await svc.listCampaigns('org-1'))[0].last_run).toBeNull();
    testDb.prepare(`INSERT INTO campaign_runs (id, campaign_id, org_id, started_by, started_at, notice_id, snapshot, task_count) VALUES ('r1', ?, 'org-1', 'u', '2026-01-01T00:00:00.000Z', NULL, '{"campaign_name":"C","framework_label":null,"tests":[],"agents":[],"skipped":[]}', 1), ('r2', ?, 'org-1', 'u', '2026-02-01T00:00:00.000Z', NULL, '{"campaign_name":"C","framework_label":null,"tests":[],"agents":[],"skipped":[]}', 1)`).run(c1.id, c1.id);
    expect((await svc.listCampaigns('org-1'))[0].last_run).toEqual({ id: 'r2', started_at: '2026-02-01T00:00:00.000Z', percent_protected: null });
  });
});
