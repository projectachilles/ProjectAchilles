import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../../agent/database.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent/database.js')>()),
  getDatabase: () => testDb,
}));
vi.mock('../../agent/test-catalog.service.js', () => ({
  getTestMetadata: (uuid: string) => ({ uuid, name: `Test ${uuid}`, techniques: [] }),
}));
const s1Configured = vi.hoisted(() => ({ value: false }));
const { mockFetchEdrDocs } = vi.hoisted(() => ({
  mockFetchEdrDocs: vi.fn(async (_ids: string[]): Promise<{ status: 'ok' | 'unavailable' | 'not_configured'; docs: Map<string, Record<string, unknown>> }> =>
    ({ status: 'not_configured', docs: new Map() })),
}));
vi.mock('../../outcomes/edr.js', () => ({ fetchEdrDocs: mockFetchEdrDocs }));
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    isDefenderConfigured() { return true; }
    isCrowdStrikeConfigured() { return false; }
    isSentinelOneConfigured() { return s1Configured.value; }
    isSophosConfigured() { return false; }
  },
}));
vi.mock('../../notices/userLabel.js', () => ({
  resolveUserLabel: async (id: string) => (id === 'user_jane' ? 'Jane Doe (jane@x.io)' : id),
}));

const { getRunMatrix, computeRunTotals, listRuns, listAllRuns, runMatrixCsv } = await import('../matrix.js');
const { createCampaign, updateCampaign, listCampaigns } = await import('../campaigns.service.js');
const { insertNotice } = await import('../../notices/notices.repo.js');

const ORG = 'org-1';
let seq = 0;

function insertRun(id: string, campaignId: string, snapshot: object, noticeId: string | null = null, org = ORG, startedAt = new Date().toISOString()) {
  testDb
    .prepare(
      `INSERT INTO campaign_runs (id, campaign_id, org_id, started_by, started_at, notice_id, snapshot, task_count)
       VALUES (?, ?, ?, 'u1', ?, ?, ?, 1)`,
    )
    .run(id, campaignId, org, startedAt, noticeId, JSON.stringify(snapshot));
}

function insertTask(o: {
  runId: string; agent: string; test: string; status: string; exit?: number; noticeId?: string | null;
  createdAt?: string; techniques?: string[]; id?: string; stdout?: string; error?: string;
}): string {
  const id = o.id ?? `task-${++seq}`;
  testDb
    .prepare(
      `INSERT INTO tasks (id, agent_id, org_id, type, status, payload, result, created_at, completed_at, notice_id, campaign_run_id)
       VALUES (?, ?, ?, 'execute_test', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, o.agent, ORG, o.status,
      JSON.stringify({ test_uuid: o.test, test_name: o.test, metadata: { techniques: o.techniques ?? [] } }),
      o.exit === undefined && o.error === undefined ? null : JSON.stringify({ exit_code: o.exit, stdout: o.stdout, error: o.error }),
      o.createdAt ?? '2026-10-23 10:00:00',
      o.status === 'completed' ? '2026-10-23T10:05:00.000Z' : null,
      o.noticeId ?? null, o.runId,
    );
  return id;
}

function notice(id: string, state: string, releaseAt: string | null) {
  insertNotice({
    id, kind: 'run', state: 'pending', sourceType: 'campaign', scheduleIds: [], timezone: 'UTC',
    createdBy: 'u1', createdAt: new Date().toISOString(), recipients: [], orgId: ORG,
  } as unknown as Parameters<typeof insertNotice>[0]);
  testDb.prepare('UPDATE run_notices SET state = ?, release_at = ? WHERE id = ?').run(state, releaseAt, id);
}

const snap = (tests: string[], agents: string[], skipped: object[] = []) => ({
  campaign_name: 'C',
  framework_label: 'Q4',
  tests: tests.map((t) => ({ uuid: t, name: `Test ${t}` })),
  agents: agents.map((a) => ({ id: a, hostname: `host-${a}`, os: 'windows' })),
  skipped,
});

describe('campaign run matrix', () => {
  beforeEach(() => {
    testDb = createTestDatabase();
    for (const a of ['a1', 'a2', 'a3', 'a4']) insertTestAgent(testDb, { id: a, org_id: ORG, hostname: `host-${a}`, os: 'windows' });
  });

  it('produces all 7 states', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    notice('n-wait', 'pending', null);
    notice('n-future', 'sent', future);
    notice('n-rel', 'overridden', past);
    insertRun('r1', 'c1', snap(['t1', 't2', 't3', 't4', 't5', 't6', 't7'], ['a1'], [{ test_uuid: 't7', agent_id: 'a1', reason: 'not built' }]), 'n-wait');
    insertTask({ runId: 'r1', agent: 'a1', test: 't1', status: 'pending', noticeId: 'n-wait' });
    insertTask({ runId: 'r1', agent: 'a1', test: 't2', status: 'pending', noticeId: 'n-future' });
    insertTask({ runId: 'r1', agent: 'a1', test: 't3', status: 'pending', noticeId: 'n-rel' });
    insertTask({ runId: 'r1', agent: 'a1', test: 't4', status: 'executing' });
    insertTask({ runId: 'r1', agent: 'a1', test: 't5', status: 'completed', exit: 126 });
    insertTask({ runId: 'r1', agent: 'a1', test: 't6', status: 'expired' });
    const m = (await getRunMatrix('r1', ORG));
    const st = (t: string) => m.cells[t].a1.state;
    expect([st('t1'), st('t2'), st('t3'), st('t4'), st('t5'), st('t6'), st('t7')]).toEqual([
      'waiting_for_notice', 'waiting_for_notice', 'running', 'running', 'protected', 'not_run', 'na',
    ]);
    expect(m.cells.t7.a1.reason).toBe('not built');
    expect(m.run.notice?.id).toBe('n-wait');

    insertTask({ runId: 'r1', agent: 'a1', test: 't1', status: 'completed', exit: 101, createdAt: '2026-10-23 11:00:00' });
    insertTask({ runId: 'r1', agent: 'a1', test: 't2', status: 'failed' , createdAt: '2026-10-23 11:00:00' });
    const m2 = (await getRunMatrix('r1', ORG));
    expect(m2.cells.t1.a1.state).toBe('unprotected');
    expect(m2.cells.t2.a1.state).toBe('error');
    expect(m2.totals.na).toBe(1);
  });

  it('percent protected: 2/3 -> 67, all-error -> null', async () => {
    insertRun('r2', 'c1', snap(['t1', 't2', 't3', 't4'], ['a1']));
    insertTask({ runId: 'r2', agent: 'a1', test: 't1', status: 'completed', exit: 105 });
    insertTask({ runId: 'r2', agent: 'a1', test: 't2', status: 'completed', exit: 127 });
    insertTask({ runId: 'r2', agent: 'a1', test: 't3', status: 'completed', exit: 101 });
    insertTask({ runId: 'r2', agent: 'a1', test: 't4', status: 'completed', exit: 1 });
    expect((await computeRunTotals('r2'))).toMatchObject({ protected: 2, unprotected: 1, error: 1, percent_protected: 67 });

    insertRun('r3', 'c1', snap(['t1'], ['a1']));
    insertTask({ runId: 'r3', agent: 'a1', test: 't1', status: 'failed' });
    expect((await computeRunTotals('r3')).percent_protected).toBeNull();
  });

  it('a retry wins over the failed original', async () => {
    insertRun('r4', 'c1', snap(['t1'], ['a1']));
    insertTask({ runId: 'r4', agent: 'a1', test: 't1', status: 'failed', createdAt: '2026-10-23 10:00:00' });
    insertTask({ runId: 'r4', agent: 'a1', test: 't1', status: 'completed', exit: 126, createdAt: '2026-10-23 10:30:00' });
    expect((await getRunMatrix('r4', ORG)).cells.t1.a1).toMatchObject({ state: 'protected', exit_code: 126 });
  });

  it('same created_at: higher rowid wins', async () => {
    insertRun('r5', 'c1', snap(['t1'], ['a1']));
    insertTask({ runId: 'r5', agent: 'a1', test: 't1', status: 'failed' });
    insertTask({ runId: 'r5', agent: 'a1', test: 't1', status: 'completed', exit: 101 });
    expect((await getRunMatrix('r5', ORG)).cells.t1.a1.state).toBe('unprotected');
  });

  it('snapshot is immutable after the campaign is edited', async () => {
    const c = createCampaign({ name: 'Snap', test_uuids: ['t1'], agent_ids: ['a1'] }, ORG, 'u1');
    insertRun('r6', c.id, snap(['t1'], ['a1']));
    insertTask({ runId: 'r6', agent: 'a1', test: 't1', status: 'completed', exit: 126 });
    const before = (await getRunMatrix('r6', ORG));
    updateCampaign(c.id, { name: 'Snap2', test_uuids: ['t2', 't3'], agent_ids: ['a2', 'a3'] }, ORG);
    const after = (await getRunMatrix('r6', ORG));
    expect(after.tests).toEqual(before.tests);
    expect(after.agents).toEqual(before.agents);
    expect(after.cells).toEqual(before.cells);
    expect(after.run.campaign_name).toBe('C');
  });

  it('cross-org getRunMatrix is a 404; undefined org is unfiltered; listRuns is scoped', async () => {
    insertRun('r7', 'c1', snap(['t1'], ['a1']));
    await expect(getRunMatrix('r7', 'other-org')).rejects.toThrow(/Campaign run not found/);
    expect((await getRunMatrix('r7', undefined)).run.id).toBe('r7');
    expect((await listRuns('c1', 'other-org', 25, 0))).toEqual({ items: [], total: 0 });
    expect((await listRuns('c1', ORG, 25, 0)).items).toHaveLength(1);
    expect((await listRuns('c1', undefined, 25, 0)).items[0]).toMatchObject({ id: 'r7', task_count: 1, percent_protected: null });
  });

  it('CSV: header, formula guard, comma quoting, na outcome with reason, techniques', async () => {
    const s = snap(['t1', 't2'], ['a1']);
    s.tests[0].name = "=cmd|' /C calc'!A0";
    s.agents[0].hostname = 'web,01';
    s.skipped = [{ test_uuid: 't2', agent_id: 'a1', reason: 'no windows binary' }] as never;
    insertRun('r8', 'c1', s);
    insertTask({ runId: 'r8', agent: 'a1', test: 't1', status: 'completed', exit: 101, techniques: ['T1059', 'T1105'] });
    const m8 = (await getRunMatrix('r8', ORG));
    const csv = runMatrixCsv(m8);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('test,techniques,host,os,outcome,exit_code,reason,completed_at,as_of,stages,edr');
    const asOf = m8.as_of;
    expect(lines[1]).toMatch(/^'=cmd\|' \/C calc'!A0,T1059; T1105,"web,01",windows,unprotected,101,Ran without being blocked \(exit 101\)\.,2026-10-23T10:05:00\.000Z,/);
    expect(lines.slice(1).every((l) => l.endsWith(',' + asOf + ',,'))).toBe(true);
    expect(lines[2]).toBe(`Test t2,,"web,01",windows,na,,no windows binary,,${asOf},,`);
  });

  it('CSV: not_run has a blank exit_code (no -1) and its reason; error carries result.error', async () => {
    insertRun('r11', 'c1', snap(['t1', 't2', 't3'], ['a1']));
    insertTask({ runId: 'r11', agent: 'a1', test: 't1', status: 'expired', exit: -1, error: 'Not run: notice expired' });
    insertTask({ runId: 'r11', agent: 'a1', test: 't2', status: 'failed', exit: 1, error: 'binary crashed' });
    const m = (await getRunMatrix('r11', ORG));
    const lines = runMatrixCsv(m).trimEnd().split('\r\n');
    expect(lines[1]).toBe(`Test t1,,host-a1,windows,not_run,,Not run: notice expired,,${m.as_of},,`);
    expect(lines[2]).toBe(`Test t2,,host-a1,windows,error,1,binary crashed,,${m.as_of},,`);
    // No task at all: not_run, blank exit_code and reason.
    expect(lines[3]).toBe(`Test t3,,host-a1,windows,not_run,,,,${m.as_of},,`);
  });

  it('error cells carry reason from result.error', async () => {
    insertRun('r12', 'c1', snap(['t1', 't2'], ['a1']));
    insertTask({ runId: 'r12', agent: 'a1', test: 't1', status: 'failed', error: 'download failed: 404' });
    insertTask({ runId: 'r12', agent: 'a1', test: 't2', status: 'completed', exit: 999, error: 'agent error' });
    const m = (await getRunMatrix('r12', ORG));
    expect(m.cells.t1.a1).toMatchObject({ state: 'error', reason: 'download failed: 404' });
    expect(m.cells.t2.a1).toMatchObject({ state: 'error', reason: 'Exit 999: test error, prerequisites not met. agent error' });
  });

  it('large stdout does not affect the matrix; not_run surfaces result.error as reason', async () => {
    insertRun('r10', 'c1', snap(['t1', 't2'], ['a1']));
    insertTask({ runId: 'r10', agent: 'a1', test: 't1', status: 'completed', exit: 126, stdout: 'x'.repeat(2_000_000), techniques: ['T1'] });
    insertTask({ runId: 'r10', agent: 'a1', test: 't2', status: 'expired', error: 'Not run: host offline during notice window' });
    const m = (await getRunMatrix('r10', ORG));
    expect(m.cells.t1.a1).toMatchObject({ state: 'protected', exit_code: 126, reason: 'Blocked, exit 126.' });
    expect(m.cells.t2.a1).toMatchObject({ state: 'not_run', reason: 'Not run: host offline during notice window' });
    expect(runMatrixCsv(m)).toContain('Test t1,T1,');
  });

  it('listCampaigns last_run.percent_protected is populated', async () => {
    const c = createCampaign({ name: 'L', test_uuids: ['t1', 't2'], agent_ids: ['a1'] }, ORG, 'u1');
    insertRun('r9', c.id, snap(['t1', 't2'], ['a1']));
    insertTask({ runId: 'r9', agent: 'a1', test: 't1', status: 'completed', exit: 126 });
    insertTask({ runId: 'r9', agent: 'a1', test: 't2', status: 'completed', exit: 101 });
    const item = (await listCampaigns(ORG)).find((x) => x.id === c.id)!;
    expect(item.last_run?.percent_protected).toBe(50);
  });
  it('run.notice carries the sent record: sent_at and recipients', async () => {
    notice('n-sent', 'sent', '2026-10-23T10:10:00.000Z');
    testDb.prepare('UPDATE run_notices SET sent_at = ?, recipients = ? WHERE id = ?')
      .run('2026-10-23T10:00:00.000Z', JSON.stringify(['a@x.com', 'b@y.com']), 'n-sent');
    insertRun('r13', 'c1', snap(['t1'], ['a1']), 'n-sent');
    const n = (await getRunMatrix('r13', ORG)).run.notice;
    expect(n).toMatchObject({
      id: 'n-sent', run_tag: expect.stringMatching(/^PA-RUN-/), state: 'sent',
      sent_at: '2026-10-23T10:00:00.000Z', recipients: ['a@x.com', 'b@y.com'],
      override_by: null, override_reason: null, override_at: null,
    });
  });

  it('run.notice carries the override record', async () => {
    notice('n-ovr', 'overridden', '2026-10-23T10:00:00.000Z');
    testDb.prepare('UPDATE run_notices SET override_by = ?, override_reason = ?, override_at = ? WHERE id = ?')
      .run('user_admin', 'change window approved by CAB', '2026-10-23T09:59:00.000Z', 'n-ovr');
    insertRun('r14', 'c1', snap(['t1'], ['a1']), 'n-ovr');
    expect((await getRunMatrix('r14', ORG)).run.notice).toMatchObject({
      state: 'overridden', sent_at: null, recipients: [],
      override_by: 'user_admin', override_reason: 'change window approved by CAB', override_at: '2026-10-23T09:59:00.000Z',
    });
  });

  it('run.notice is null with no notice, and a notice of another org is not read', async () => {
    insertRun('r15', 'c1', snap(['t1'], ['a1']));
    expect((await getRunMatrix('r15', ORG)).run.notice).toBeNull();
    insertNotice({
      id: 'n-other', kind: 'run', state: 'sent', sourceType: 'run_now', scheduleIds: [], timezone: 'UTC',
      createdBy: 'u9', createdAt: new Date().toISOString(), recipients: ['x@other.com'], orgId: 'org-2',
    } as unknown as Parameters<typeof insertNotice>[0]);
    insertRun('r16', 'c1', snap(['t1'], ['a1']), 'n-other');
    expect((await getRunMatrix('r16', ORG)).run.notice).toBeNull();
  });

  it('started_by_name comes from the snapshot, falling back to started_by', async () => {
    insertRun('r17', 'c1', { ...snap(['t1'], ['a1']), started_by_name: 'Jane Doe' });
    insertRun('r18', 'c1', snap(['t1'], ['a1']));
    expect((await getRunMatrix('r17', ORG)).run).toMatchObject({ started_by: 'u1', started_by_name: 'Jane Doe' });
    expect((await getRunMatrix('r18', ORG)).run).toMatchObject({ started_by: 'u1', started_by_name: 'u1' });
    const items = (await listRuns('c1', ORG, 25, 0)).items;
    expect(items.find((r) => r.id === 'r17')?.started_by_name).toBe('Jane Doe');
    expect(items.find((r) => r.id === 'r18')?.started_by_name).toBe('u1');
    const all = (await listAllRuns(ORG, 25, 0)).items;
    expect(all.find((r) => r.id === 'r17')?.started_by_name).toBe('Jane Doe');
    expect(all.find((r) => r.id === 'r18')?.started_by_name).toBe('u1');
  });

  it('listRuns / listAllRuns page newest first and report total', async () => {
    for (let i = 0; i < 5; i++) {
      insertRun(`p${i}`, i < 3 ? 'cA' : 'cB', snap(['t1'], ['a1']), null, ORG, `2026-10-2${i}T10:00:00.000Z`);
    }
    insertRun('p-other', 'cA', snap(['t1'], ['a1']), null, 'org-2', '2026-10-29T10:00:00.000Z');
    expect((await listRuns('cA', ORG, 2, 0))).toMatchObject({ total: 3, items: [{ id: 'p2' }, { id: 'p1' }] });
    expect((await listRuns('cA', ORG, 2, 2))).toMatchObject({ total: 3, items: [{ id: 'p0' }] });
    expect((await listRuns('cA', ORG, 2, 2)).items).toHaveLength(1);
    expect((await listRuns('cA', undefined, 25, 0)).total).toBe(4);
    const all = (await listAllRuns(ORG, 3, 1));
    expect(all.total).toBe(5);
    expect(all.items.map((r) => r.id)).toEqual(['p3', 'p2', 'p1']);
    expect((await listAllRuns(ORG, 25, 10))).toEqual({ items: [], total: 5 });
    expect((await listAllRuns(undefined, 25, 0)).total).toBe(6);
  });

  it('started_by_name stored as a Clerk user id is resolved for display', async () => {
    insertRun('r19', 'c1', { ...snap(['t1'], ['a1']), started_by_name: 'user_jane' });
    expect((await getRunMatrix('r19', ORG)).run.started_by_name).toBe('Jane Doe (jane@x.io)');
    expect((await listRuns('c1', ORG, 25, 0)).items[0].started_by_name).toBe('Jane Doe (jane@x.io)');
  });

  describe('EDR correlation', () => {
    afterEach(() => mockFetchEdrDocs.mockImplementation(async () => ({ status: 'not_configured', docs: new Map() })));

    function bundleTask(runId: string, agent: string, test: string, exit: number, controls: object[]) {
      const id = `task-${++seq}`;
      testDb.prepare(
        `INSERT INTO tasks (id, agent_id, org_id, type, status, payload, result, created_at, completed_at, campaign_run_id)
         VALUES (?, ?, ?, 'execute_test', 'completed', ?, ?, '2026-10-23 10:00:00', '2026-10-23T10:05:00.000Z', ?)`,
      ).run(id, agent, ORG, JSON.stringify({ test_uuid: test, metadata: { category: 'intel-driven', techniques: [] } }),
        JSON.stringify({ exit_code: exit, stdout: 'x', stderr: '', bundle_results: { controls } }), runId);
      return id;
    }

    it('looks up stage docs by task id :: control id and labels the cell like Analytics', async () => {
      insertRun('e1', 'c1', snap(['t1', 't2'], ['a1']));
      const k = bundleTask('e1', 'a1', 't1', 999, [
        { control_id: 'T1105', exit_code: 101, skipped: false }, { control_id: 'T1572', exit_code: 999, skipped: false },
      ]);
      const single = insertTask({ runId: 'e1', agent: 'a1', test: 't2', status: 'completed', exit: 101 });
      mockFetchEdrDocs.mockImplementation(async () => ({
        status: 'ok',
        docs: new Map<string, Record<string, unknown>>([
          [`${k}::T1105`, { event: { ERROR: 101 }, f0rtika: { is_bundle_control: true, defender_prevented: true, defender_prevention_action: 'process_killed' } }],
          [single, { event: { ERROR: 101 }, f0rtika: { defender_detected: true, defender_stage_detected: true } }],
        ]),
      }));
      const m = await getRunMatrix('e1', ORG);
      expect(mockFetchEdrDocs).toHaveBeenCalledWith(expect.arrayContaining([`${k}::T1105`, `${k}::T1572`, single]));
      expect(m.cells.t1.a1).toMatchObject({ state: 'prevented', edr: 'Defender: prevented (process killed)', stages_text: '1:101 2:999' });
      expect(m.cells.t2.a1).toMatchObject({ state: 'detected', edr: 'Defender: alert raised' });
      // Prevented and detected count as protected, like the Defense Score.
      expect(m.totals).toMatchObject({ prevented: 1, detected: 1, percent_protected: 100 });
      expect(m.edr).toEqual({ status: 'ok', sources: ['Microsoft Defender'] });
      // EDR integrations are deployment-wide, and SentinelOne counts like the others.
      s1Configured.value = true;
      try {
        expect((await getRunMatrix('e1', ORG)).edr.sources).toEqual(['Microsoft Defender', 'SentinelOne']);
      } finally {
        s1Configured.value = false;
      }
      const csv = runMatrixCsv(m).trimEnd().split('\r\n');
      expect(csv[1].endsWith(',1:101 2:999,Defender: prevented (process killed)')).toBe(true);
    });

    it('EDR unavailable: exit codes only, and the run says so', async () => {
      insertRun('e2', 'c1', snap(['t1'], ['a1']));
      insertTask({ runId: 'e2', agent: 'a1', test: 't1', status: 'completed', exit: 101 });
      mockFetchEdrDocs.mockImplementation(async () => ({ status: 'unavailable', docs: new Map() }));
      const m = await getRunMatrix('e2', ORG);
      expect(m.cells.t1.a1).toMatchObject({ state: 'unprotected', edr: 'unavailable' });
      expect(m.edr.status).toBe('unavailable');
    });

    it('does not look up docs for unfinished tasks or cyber-hygiene bundles', async () => {
      insertRun('e3', 'c1', snap(['t1', 't2'], ['a1']));
      insertTask({ runId: 'e3', agent: 'a1', test: 't1', status: 'executing' });
      testDb.prepare(
        `INSERT INTO tasks (id, agent_id, org_id, type, status, payload, result, created_at, completed_at, campaign_run_id)
         VALUES ('ch', 'a1', ?, 'execute_test', 'completed', ?, ?, '2026-10-23 10:00:00', '2026-10-23T10:05:00.000Z', 'e3')`,
      ).run(ORG, JSON.stringify({ test_uuid: 't2', metadata: { category: 'cyber-hygiene' } }),
        JSON.stringify({ exit_code: 126, bundle_results: { controls: [{ control_id: 'CH-1', exit_code: 126, compliant: true }] } }));
      mockFetchEdrDocs.mockClear();
      const m = await getRunMatrix('e3', ORG);
      expect(mockFetchEdrDocs).toHaveBeenCalledWith([]);
      expect(m.cells.t2.a1).toMatchObject({ state: 'protected', reason: '1 of 1 controls compliant.' });
    });
  });
});
