import { describe, it, expect, vi } from 'vitest';
import { SophosAutoResolveService } from '../auto-resolve.service.js';
import { SophosApiError, SophosPermissionError } from '../sophos-client.js';

const A1 = '11111111-2222-3333-4444-555555555555';
const DET = 'alert://priv:xdr:tenant:abc123';
const hit = (id: string, src: Record<string, unknown>) => ({ _id: `doc-${id}`, _index: 'achilles-sophos', _source: src });
const alertHit = (id = A1) => hit(id, { alert_id: id, source_type: 'alert', evidence_hostnames: ['HOST-1'], f0rtika: { achilles_test_uuid: 'uuid-1' } });
const detHit = (id = DET) => hit(id, { alert_id: id, source_type: 'xdr_detection', evidence_hostnames: ['HOST-2'], f0rtika: { achilles_test_uuid: 'uuid-2' } });

const mockEs = (hits: unknown[]) => ({
  search: vi.fn().mockResolvedValue({ hits: { hits } }),
  update: vi.fn().mockResolvedValue({}),
  bulk: vi.fn().mockResolvedValue({}),
});
function mockClient(over: Record<string, unknown> = {}) {
  return {
    permissionMode: 'response' as const,
    getAlert: vi.fn(async () => ({ id: A1, allowedActions: ['acknowledge', 'clearThreat'] })),
    acknowledgeAlert: vi.fn().mockResolvedValue({ status: 'requested' }),
    graphql: vi.fn(async (_q: string, v: { in: { iDs: string[] } }) => ({ detectionRetrieveById: { alerts: { list: [{ id: v.in.iDs[0], status: 'OPEN' }] } } })),
    resolveDetections: vi.fn().mockResolvedValue({ updated: 1 }),
    ...over,
  };
}
const svc = (es: ReturnType<typeof mockEs>, c: ReturnType<typeof mockClient>, mode: 'disabled' | 'dry_run' | 'enabled') =>
  new SophosAutoResolveService(es as never, c as never, mode);
const query = (es: ReturnType<typeof mockEs>) => JSON.stringify(es.search.mock.calls[0][0].query);

describe('SophosAutoResolveService', () => {
  it('disabled: no calls', async () => {
    const es = mockEs([alertHit()]);
    const r = await svc(es, mockClient(), 'disabled').runAutoResolvePass();
    expect(r.candidates).toBe(0);
    expect(es.search).not.toHaveBeenCalled();
  });

  it('enabled but read-only: writes nothing', async () => {
    const es = mockEs([alertHit()]);
    const c = mockClient({ permissionMode: 'read_only' });
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(r.errors[0]).toMatch(/read-only/);
    expect(c.acknowledgeAlert).not.toHaveBeenCalled();
  });

  it('switching from dry_run to enabled resolves alerts that already have a dry-run receipt', async () => {
    const es = mockEs([alertHit()]);
    const c = mockClient();
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    const q = query(es);
    // enabled excludes only real receipts, not dry-run ones
    expect(q).toContain('"f0rtika.auto_resolved":true');
    expect(q).not.toContain('auto_resolve_dry_run_at');
    expect(c.acknowledgeAlert).toHaveBeenCalledWith(A1, 'ProjectAchilles security test uuid-1 on HOST-1 (auto-resolve)');
    expect(r.patched).toBe(1);
    const receipt = es.update.mock.calls[0][0].doc.f0rtika;
    expect(receipt).toMatchObject({ auto_resolved: true, auto_resolve_mode: 'enabled' });
  });

  it('dry_run writes a dry-run receipt, never auto_resolved, and never calls the API', async () => {
    const es = mockEs([alertHit(), detHit()]);
    const c = mockClient();
    const r = await svc(es, c, 'dry_run').runAutoResolvePass();
    expect(r.wouldPatch).toBe(2);
    expect(c.acknowledgeAlert).not.toHaveBeenCalled();
    expect(c.resolveDetections).not.toHaveBeenCalled();
    for (const call of es.update.mock.calls) {
      expect(call[0].doc.f0rtika).toMatchObject({ auto_resolve_mode: 'dry_run' });
      expect(call[0].doc.f0rtika.auto_resolve_dry_run_at).toBeTruthy();
      expect(call[0].doc.f0rtika.auto_resolved).toBeUndefined();
    }
  });

  it('candidate query: correlated, alert/xdr only, open status, no agent-kill', async () => {
    const es = mockEs([]);
    await svc(es, mockClient(), 'enabled').runAutoResolvePass();
    const q = query(es);
    expect(q).toContain('"f0rtika.achilles_correlated":true');
    expect(q).toContain('"source_type":["alert","xdr_detection"]');
    expect(q).toContain('f0rtika.achilles_agent_kill_task_id');
    expect(q).toContain('"status":["open"]');
    expect(es.search.mock.calls[0][0].index).toBe('achilles-sophos');
  });

  it('skips SIEM-only rows without a receipt', async () => {
    const es = mockEs([hit('s', { alert_id: 's', source_type: 'siem_event', f0rtika: { achilles_test_uuid: 'u' } })]);
    const c = mockClient();
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(c.getAlert).not.toHaveBeenCalled();
    expect(c.acknowledgeAlert).not.toHaveBeenCalled();
    expect(es.update).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it('never touches agent-kill alerts', async () => {
    const es = mockEs([]);
    await svc(es, mockClient(), 'enabled').runAutoResolvePass();
    const must_not = es.search.mock.calls[0][0].query.bool.must_not;
    expect(JSON.stringify(must_not)).toContain('f0rtika.achilles_agent_kill_task_id');
  });

  it('writes not_found and moves on when the alert is gone', async () => {
    const A2 = '99999999-2222-3333-4444-555555555555';
    const es = mockEs([alertHit(), alertHit(A2)]);
    const c = mockClient({ getAlert: vi.fn(async (id: string) => (id === A1 ? null : { allowedActions: ['acknowledge'] })) });
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(es.update.mock.calls[0][0].doc.f0rtika.auto_resolve_error).toBe('not_found');
    expect(c.acknowledgeAlert).toHaveBeenCalledTimes(1);
    expect(c.acknowledgeAlert.mock.calls[0][0]).toBe(A2);
    expect(r.patched).toBe(1);
  });

  it('skips an alert whose allowedActions lack acknowledge', async () => {
    const es = mockEs([alertHit()]);
    const c = mockClient({ getAlert: vi.fn(async () => ({ allowedActions: ['clearThreat'] })) });
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(c.acknowledgeAlert).not.toHaveBeenCalled();
    expect(r.patched).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('resolves an OPEN detection with TRUE_POSITIVE_BENIGN reason text via the client', async () => {
    const es = mockEs([detHit()]);
    const c = mockClient();
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(c.graphql.mock.calls[0][0]).toContain('detectionRetrieveById');
    expect(c.graphql.mock.calls[0][1]).toEqual({ in: { iDs: [DET] } });
    expect(c.resolveDetections).toHaveBeenCalledWith([DET], 'ProjectAchilles security test uuid-2 on HOST-2 (auto-resolve)');
    expect(r.patched).toBe(1);
  });

  it('does not resolve a detection that is no longer OPEN and mirrors the status', async () => {
    const es = mockEs([detHit()]);
    const c = mockClient({ graphql: vi.fn(async () => ({ detectionRetrieveById: { alerts: { list: [{ id: DET, status: 'FALSE_POSITIVE' }] } } })) });
    await svc(es, c, 'enabled').runAutoResolvePass();
    expect(c.resolveDetections).not.toHaveBeenCalled();
    expect(es.update.mock.calls[0][0].doc).toEqual({ status: 'false_positive' });
  });

  it('halts on 403 with a Management-role message', async () => {
    const es = mockEs([alertHit(), alertHit('99999999-2222-3333-4444-555555555555')]);
    const c = mockClient({ acknowledgeAlert: vi.fn().mockRejectedValue(new SophosApiError('forbidden', 403, '')) });
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(c.acknowledgeAlert).toHaveBeenCalledTimes(1);
    expect(r.errors[0]).toMatch(/403/);
    expect(r.errors[0]).toMatch(/Management/);
    expect(es.update).not.toHaveBeenCalled();
  });

  it('halts on SophosPermissionError too', async () => {
    const es = mockEs([detHit()]);
    const c = mockClient({ resolveDetections: vi.fn().mockRejectedValue(new SophosPermissionError('no')) });
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(r.errors[0]).toMatch(/Management/);
  });

  it('transient errors write no receipt', async () => {
    const es = mockEs([alertHit()]);
    const c = mockClient({ acknowledgeAlert: vi.fn().mockRejectedValue(new SophosApiError('boom', 503, '')) });
    const r = await svc(es, c, 'enabled').runAutoResolvePass();
    expect(r.patched).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(es.update).not.toHaveBeenCalled();
  });

  it('never writes to result docs (only achilles-sophos is touched)', async () => {
    const es = mockEs([alertHit(), detHit()]);
    await svc(es, mockClient(), 'enabled').runAutoResolvePass();
    expect(es.bulk).not.toHaveBeenCalled();
    for (const call of es.update.mock.calls) expect(call[0].index).toBe('achilles-sophos');
    expect(es.search.mock.calls[0][0].index).toBe('achilles-sophos');
  });

  it('reasonText format', () => {
    expect(SophosAutoResolveService.reasonText('b', 'h')).toBe('ProjectAchilles security test b on h (auto-resolve)');
  });
});
