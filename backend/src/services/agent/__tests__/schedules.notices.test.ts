import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createTestDatabase, insertTestAgent } from '../../../__tests__/helpers/db.js';

let testDb: Database.Database;

vi.mock('../database.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database.js')>();
  return { ...actual, getDatabase: () => testDb };
});

const { mockCatalog } = vi.hoisted(() => ({ mockCatalog: vi.fn((_uuid: string): unknown => null) }));
vi.mock('../test-catalog.service.js', () => ({ getTestMetadata: (uuid: string) => mockCatalog(uuid) }));

// Settings and builds live under a temp HOME. createTasks is real here.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const home = `${actual.tmpdir()}/pa-schedules-notices-${process.pid}`;
  const overrides = { homedir: () => home };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});

const { mockSendMail, mockTestEmailConnection } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockTestEmailConnection: vi.fn(),
}));

// Only the late-run tests (R23) send notices; nothing else here emails.
vi.mock('../../alerts/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../alerts/email.service.js')>();
  return { ...actual, sendMail: mockSendMail, testEmailConnection: mockTestEmailConnection };
});

const { processSchedules } = await import('../schedules.service.js');
const { processNotices, LATE_LINK_MIN_PICKUP_MS } = await import('../../notices/notices.service.js');
const { getNextTask, resetExpireThrottle } = await import('../tasks.service.js');

const HOME = os.homedir();
const SETTINGS_DIR = path.join(HOME, '.projectachilles');
const NOW = new Date('2026-10-23T12:00:00.000Z'); // Friday
const MIN = 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

function writeSettings(enabled: boolean) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SETTINGS_DIR, 'integrations.json'),
    JSON.stringify({
      alerts: {
        thresholds: { enabled: false },
        cooldown_minutes: 15,
        email: {
          smtp_host: 'smtp.example.test',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'u',
          smtp_pass: 'p',
          from_address: 'pa@example.test',
          recipients: [],
          configured: true,
          enabled: true,
        },
      },
      pre_execution_notices: { enabled, recipients: ['a@x.com'] },
    }),
  );
}

function writeBuild(testUuid: string) {
  const dir = path.join(SETTINGS_DIR, 'builds', testUuid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'test.exe'), 'binary');
  fs.writeFileSync(path.join(dir, 'build-meta.json'), JSON.stringify({ binary_name: 'test.exe' }));
}

const METADATA = {
  category: 'test', subcategory: '', severity: 'medium', techniques: [], tactics: [],
  threat_actor: '', target: [], complexity: '', tags: [], score: null, integrations: [],
};

function insertSchedule(
  id: string,
  agentIds: string[],
  opts: { nextRunAt: Date; config?: Record<string, unknown>; agentNextRuns?: Record<string, string>; metadata?: object },
) {
  testDb
    .prepare(`
      INSERT INTO schedules (id, name, agent_ids, org_id, test_uuid, test_name, binary_name, metadata, schedule_type,
        schedule_config, timezone, next_run_at, status, created_by, agent_next_runs)
      VALUES (?, ?, ?, 'org-001', ?, 'T', 'test.exe', ?, 'daily', ?, 'UTC', ?, 'active', 'creator', ?)
    `)
    .run(
      id,
      `Sched ${id}`,
      JSON.stringify(agentIds),
      `uuid-${id}`,
      JSON.stringify(opts.metadata ?? METADATA),
      JSON.stringify(opts.config ?? { time: '12:00' }),
      opts.nextRunAt.toISOString(),
      opts.agentNextRuns ? JSON.stringify(opts.agentNextRuns) : null,
    );
  writeBuild(`uuid-${id}`);
}

const tasksOf = () =>
  testDb.prepare('SELECT id, batch_id, notice_id, agent_id FROM tasks ORDER BY agent_id').all() as Array<{
    id: string;
    batch_id: string;
    notice_id: string | null;
    agent_id: string;
  }>;
const notices = () => testDb.prepare('SELECT * FROM run_notices ORDER BY created_at').all() as Array<Record<string, any>>;

beforeEach(() => {
  testDb = createTestDatabase();
  fs.rmSync(SETTINGS_DIR, { recursive: true, force: true });
  writeSettings(true);
  for (const a of ['agent-1', 'agent-2', 'agent-3']) insertTestAgent(testDb, { id: a, hostname: `host-${a}` });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('processSchedules with pre-execution notices', () => {
  it('links two fleet schedules due in one tick to one run notice', () => {
    insertSchedule('s1', ['agent-1'], { nextRunAt: at(-MIN) });
    insertSchedule('s2', ['agent-2'], { nextRunAt: at(-MIN) });

    const result = processSchedules(NOW);

    expect(result.errors).toEqual([]);
    const ns = notices();
    expect(ns).toHaveLength(1);
    expect(ns[0].kind).toBe('run');
    expect(ns[0].state).toBe('pending');
    expect(ns[0].source_type).toBe('schedule');
    expect(JSON.parse(ns[0].schedule_ids).sort()).toEqual(['s1', 's2']);
    const ts = tasksOf();
    expect(ts).toHaveLength(2);
    expect(new Set(ts.map((t) => t.batch_id)).size).toBe(2);
    expect(ts.every((t) => t.notice_id === ns[0].id)).toBe(true);
  });

  it('skips a fleet schedule whose previous run notice is still pending, and advances next_run_at', () => {
    insertSchedule('s1', ['agent-1'], { nextRunAt: at(-MIN) });
    processSchedules(NOW);
    expect(tasksOf()).toHaveLength(1);

    // Next occurrence comes due while the notice is still undelivered.
    testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(at(24 * 60 * MIN - MIN).toISOString(), 's1');
    const later = at(24 * 60 * MIN);
    const result = processSchedules(later);

    expect(result.errors).toEqual([]);
    expect(tasksOf()).toHaveLength(1);
    const ns = notices();
    expect(ns).toHaveLength(2);
    expect(ns[1].state).toBe('skipped');
    expect(ns[1].skip_reason).toBe('previous run still waiting for notice delivery');
    expect(JSON.parse(ns[1].schedule_ids)).toEqual(['s1']);
    const row = testDb.prepare('SELECT next_run_at, last_run_at FROM schedules WHERE id = ?').get('s1') as any;
    expect(row.next_run_at > later.toISOString()).toBe(true);
    expect(row.last_run_at).toBe(later.toISOString());
  });

  it('shares one day notice across a per_machine schedule\'s agents due at different minutes', () => {
    insertSchedule('pm', ['agent-1', 'agent-2', 'agent-3'], {
      nextRunAt: at(1 * MIN),
      config: { time: '12:00', randomize_mode: 'per_machine' },
      agentNextRuns: {
        'agent-1': at(1 * MIN).toISOString(),
        'agent-2': at(8 * MIN).toISOString(),
        'agent-3': at(15 * MIN).toISOString(),
      },
    });

    processSchedules(at(2 * MIN));
    processSchedules(at(9 * MIN));
    processSchedules(at(16 * MIN));

    const ts = tasksOf();
    expect(ts.map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    const ns = notices();
    expect(ns).toHaveLength(1);
    expect(ns[0].kind).toBe('day');
    expect(ns[0].schedule_id).toBe('pm');
    expect(ts.every((t) => t.notice_id === ns[0].id)).toBe(true);
  });

  it('per_machine: a createTasks failure leaves no day notice; the next agent that day gets a fresh one (I4)', () => {
    insertSchedule('pm', ['agent-1', 'agent-2'], {
      nextRunAt: at(1 * MIN),
      config: { time: '12:00', randomize_mode: 'per_machine' },
      agentNextRuns: { 'agent-1': at(1 * MIN).toISOString(), 'agent-2': at(8 * MIN).toISOString() },
    });
    // The build is missing, so createTasks throws.
    fs.rmSync(path.join(SETTINGS_DIR, 'builds', 'uuid-pm'), { recursive: true, force: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = processSchedules(at(2 * MIN));
    expect(first.errors).toHaveLength(1);
    expect(notices()).toHaveLength(0);
    expect(tasksOf()).toHaveLength(0);

    // Build fixed; agent-2 comes due later the same day.
    writeBuild('uuid-pm');
    const second = processSchedules(at(9 * MIN));
    expect(second.errors).toEqual([]);
    const ns = notices();
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ kind: 'day', state: 'pending', schedule_id: 'pm', window_date: '2026-10-23' });
    const ts = tasksOf();
    expect(ts.map((t) => t.agent_id)).toEqual(['agent-2']);
    expect(ts[0].notice_id).toBe(ns[0].id);
    errSpy.mockRestore();
  });

  it('fleet: a schedule whose createTasks throws is not listed on the shared run notice (I4)', () => {
    insertSchedule('s1', ['agent-1'], { nextRunAt: at(-2 * MIN) });
    insertSchedule('s2', ['agent-2'], { nextRunAt: at(-MIN) });
    fs.rmSync(path.join(SETTINGS_DIR, 'builds', 'uuid-s1'), { recursive: true, force: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = processSchedules(NOW);

    expect(result.errors).toHaveLength(1);
    const ns = notices();
    expect(ns).toHaveLength(1);
    expect(JSON.parse(ns[0].schedule_ids)).toEqual(['s2']);
    expect(tasksOf().map((t) => t.agent_id)).toEqual(['agent-2']);

    // s1 is not blocked by s2's pending notice on its next occurrence.
    writeBuild('uuid-s1');
    testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(at(MIN).toISOString(), 's1');
    processSchedules(at(2 * MIN));
    expect(tasksOf().map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2']);
    errSpy.mockRestore();
  });

  it('leaves notice_id NULL and creates no notices when the gate is disabled', () => {
    writeSettings(false);
    insertSchedule('s1', ['agent-1'], { nextRunAt: at(-MIN) });
    insertSchedule('pm', ['agent-2', 'agent-3'], {
      nextRunAt: at(-MIN),
      config: { time: '12:00', randomize_mode: 'per_machine' },
      agentNextRuns: { 'agent-2': at(-MIN).toISOString(), 'agent-3': at(-MIN).toISOString() },
    });

    processSchedules(NOW);

    const ts = tasksOf();
    expect(ts).toHaveLength(3);
    expect(ts.every((t) => t.notice_id === null)).toBe(true);
    expect(notices()).toHaveLength(0);
  });

  it('does not skip a schedule on a leftover pending notice when the gate is disabled', () => {
    insertSchedule('s1', ['agent-1'], { nextRunAt: at(-MIN) });
    processSchedules(NOW); // creates a pending notice
    writeSettings(false);
    testDb.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(at(60 * MIN).toISOString(), 's1');

    processSchedules(at(61 * MIN));

    expect(tasksOf()).toHaveLength(2);
    expect(notices()).toHaveLength(1);
  });
});

describe('processSchedules: late per_machine runs and a closed day notice (R23)', () => {
  // Friday 2026-10-23, UTC: the weekday day window is 09:00-17:00.
  const T = (hhmmss: string) => new Date(`2026-10-23T${hhmmss}.000Z`);
  const DAY_DEADLINE = T('17:00:00');

  function insertDayNotice(
    id: string,
    scheduleId: string,
    state: 'pending' | 'sent' | 'overridden',
    win: { date: string; start: Date; end: Date } = { date: '2026-10-23', start: T('09:00:00'), end: DAY_DEADLINE },
  ) {
    const released = state !== 'pending';
    const plus = (d: Date, ms: number) => new Date(d.getTime() + ms).toISOString();
    testDb
      .prepare(`
        INSERT INTO run_notices (id, kind, state, source_type, schedule_ids, schedule_id, window_date, timezone,
          announced_agent_ids, day_window_start, day_window_end, created_by, created_at, recipients,
          sent_at, release_at, pickup_deadline, window_end, org_id)
        VALUES (?, 'day', ?, 'schedule', ?, ?, ?, 'UTC', '[]', ?, ?, 'creator', ?, '["a@x.com"]',
          ?, ?, ?, ?, 'org-001')
      `)
      .run(
        id,
        state,
        JSON.stringify([scheduleId]),
        scheduleId,
        win.date,
        win.start.toISOString(),
        win.end.toISOString(),
        plus(win.start, MIN),
        released ? plus(win.start, 5 * MIN) : null,
        released ? plus(win.start, 10 * MIN) : null,
        // The usual case: accepted early, so the deadline is the window end.
        released ? win.end.toISOString() : null,
        released ? plus(win.end, 5 * MIN) : null,
      );
  }

  function perMachine(id: string, due: Record<string, Date>) {
    const runs = Object.fromEntries(Object.entries(due).map(([a, d]) => [a, d.toISOString()]));
    const min = Object.values(due).reduce((m, d) => (d < m ? d : m));
    insertSchedule(id, Object.keys(due), {
      nextRunAt: min,
      config: { time: '12:00', randomize_mode: 'per_machine' },
      agentNextRuns: runs,
    });
  }

  const noticeById = (id: string) => testDb.prepare('SELECT * FROM run_notices WHERE id = ?').get(id) as Record<string, any>;
  const taskStatus = (id: string) => (testDb.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as { status: string }).status;

  async function tick(at: Date) {
    vi.setSystemTime(at);
    resetExpireThrottle();
    return processNotices(at);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCatalog.mockImplementation(() => null);
    mockSendMail.mockResolvedValue({ accepted: ['a@x.com'], rejected: [] });
    mockTestEmailConnection.mockResolvedValue({ success: true, message: 'ok' });
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a schedule saved from the UI (empty metadata) gets the catalog techniques in its notice', async () => {
    mockCatalog.mockImplementation((uuid) =>
      uuid === 'uuid-ui'
        ? { uuid, name: 'T', category: 'intel-driven', techniques: ['T1572', 'T1041'], tactics: ['command-and-control', 'exfiltration'], isMultiStage: false, stages: [] }
        : null,
    );
    insertSchedule('ui', ['agent-1'], {
      nextRunAt: NOW,
      metadata: { ...METADATA, category: '' }, // what the Tasks dialog stores
    });
    vi.setSystemTime(NOW);
    expect(processSchedules(NOW).errors).toEqual([]);
    const payload = JSON.parse((testDb.prepare('SELECT payload FROM tasks').get() as { payload: string }).payload);
    expect(payload.metadata).toMatchObject({ techniques: ['T1572', 'T1041'], tactics: ['command-and-control', 'exfiltration'] });

    await tick(NOW);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][1].html).toContain('T1572, T1041, command-and-control, exfiltration');
  });

  it('late slot: a run due 5 min before the day deadline gets its own run notice and is served after it is sent', async () => {
    insertDayNotice('day-1', 'pm', 'sent');
    perMachine('pm', { 'agent-1': T('16:55:00') });
    const now = T('16:55:30');
    vi.setSystemTime(now);

    expect(processSchedules(now).errors).toEqual([]);

    const [t] = tasksOf();
    expect(t.agent_id).toBe('agent-1');
    expect(t.notice_id).not.toBe('day-1');
    const run = noticeById(t.notice_id!);
    expect(run).toMatchObject({ kind: 'run', state: 'pending', source_type: 'schedule', org_id: 'org-001' });
    expect(JSON.parse(run.schedule_ids)).toEqual(['pm']);
    expect(noticeById('day-1').pickup_deadline).toBe(DAY_DEADLINE.toISOString()); // never extended

    const r = await tick(now);
    expect(r.sent).toBe(1);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][1].html).toContain('Schedule &quot;Sched pm&quot;');
    const sent = noticeById(t.notice_id!);
    expect(sent.state).toBe('sent');
    // Normal run window from its own acceptance: lead 5 + pickup 120.
    expect(sent.release_at).toBe(T('17:00:30').toISOString());
    expect(sent.pickup_deadline).toBe(T('19:00:30').toISOString());

    expect(getNextTask('agent-1', new Date(Date.parse(sent.release_at) - 1000))).toBeNull(); // still held
    await tick(T('17:01:00')); // the day notice's deadline has passed
    expect(taskStatus(t.id)).toBe('pending');
    expect(getNextTask('agent-1', new Date(sent.release_at))?.id).toBe(t.id);
  });

  it('catch-up after a restart: missed runs of closed day notices share one run notice and outlive the day deadline', async () => {
    insertDayNotice('day-pm', 'pm', 'sent');
    insertDayNotice('day-pm2', 'pm2', 'overridden');
    perMachine('pm', { 'agent-1': T('15:00:00'), 'agent-2': T('15:45:00') });
    perMachine('pm2', { 'agent-3': T('16:30:00') });
    const now = T('17:05:00');
    vi.setSystemTime(now);

    expect(processSchedules(now).errors).toEqual([]);

    const ts = tasksOf();
    expect(ts.map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    const ids = new Set(ts.map((t) => t.notice_id));
    expect(ids.size).toBe(1);
    const runId = [...ids][0]!;
    expect(['day-pm', 'day-pm2']).not.toContain(runId);
    const run = noticeById(runId);
    expect(run.kind).toBe('run');
    expect(JSON.parse(run.schedule_ids).sort()).toEqual(['pm', 'pm2']);

    expect((await tick(now)).sent).toBe(1);
    const sent = noticeById(runId);
    expect(sent.pickup_deadline).toBe(T('19:10:00').toISOString());

    // Nothing expires before the run notice's own deadline...
    await tick(T('17:06:00'));
    await tick(T('19:09:00'));
    expect(ts.map((t) => taskStatus(t.id))).toEqual(['pending', 'pending', 'pending']);
    // ...and the day notices were never extended.
    expect(noticeById('day-pm').pickup_deadline).toBe(DAY_DEADLINE.toISOString());
    expect(noticeById('day-pm2').pickup_deadline).toBe(DAY_DEADLINE.toISOString());
  });

  it('normal path unchanged: a run due at 10:00 joins the sent day notice', () => {
    insertDayNotice('day-1', 'pm', 'sent');
    perMachine('pm', { 'agent-1': T('10:00:00') });
    const now = T('10:00:30');
    vi.setSystemTime(now);

    expect(processSchedules(now).errors).toEqual([]);

    expect(tasksOf().map((t) => t.notice_id)).toEqual(['day-1']);
    expect(notices()).toHaveLength(1);
  });

  it('joins the day notice with exactly LATE_LINK_MIN_PICKUP_MS left, and redirects with less', () => {
    expect(LATE_LINK_MIN_PICKUP_MS).toBe(10 * MIN);
    insertDayNotice('day-1', 'pm', 'sent');
    const edge = new Date(DAY_DEADLINE.getTime() - LATE_LINK_MIN_PICKUP_MS);
    perMachine('pm', { 'agent-1': edge, 'agent-2': new Date(edge.getTime() + 1000) });

    vi.setSystemTime(edge);
    processSchedules(edge);
    vi.setSystemTime(new Date(edge.getTime() + 1000));
    processSchedules(new Date(edge.getTime() + 1000));

    const [t1, t2] = tasksOf();
    expect(t1.notice_id).toBe('day-1');
    expect(t2.notice_id).not.toBe('day-1');
    expect(noticeById(t2.notice_id!).kind).toBe('run');
  });

  it('a still-pending day notice keeps taking late runs (its deadline is set at acceptance)', () => {
    insertDayNotice('day-1', 'pm', 'pending');
    perMachine('pm', { 'agent-1': T('16:55:00') });
    const now = T('16:55:30');
    vi.setSystemTime(now);

    expect(processSchedules(now).errors).toEqual([]);

    expect(tasksOf().map((t) => t.notice_id)).toEqual(['day-1']);
    expect(notices()).toHaveLength(1);
  });

  // Guards the redirect against someone adding the fleet collision skip to it:
  // these per-machine runs are already due and must not be dropped.
  it('a pending run notice for the same schedule does not skip the late per_machine runs', () => {
    insertDayNotice('day-1', 'pm', 'sent');
    testDb
      .prepare(`
        INSERT INTO run_notices (id, kind, state, source_type, schedule_ids, timezone, created_by, created_at, recipients, org_id)
        VALUES ('run-old', 'run', 'pending', 'schedule', '["pm"]', 'UTC', 'creator', ?, '["a@x.com"]', 'org-001')
      `)
      .run(T('16:50:00').toISOString());
    perMachine('pm', { 'agent-1': T('16:55:00'), 'agent-2': T('16:56:00') });
    const now = T('16:56:30');
    vi.setSystemTime(now);

    expect(processSchedules(now).errors).toEqual([]);

    const ts = tasksOf();
    expect(ts.map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2']);
    const ids = new Set(ts.map((t) => t.notice_id));
    expect(ids.size).toBe(1);
    const runId = [...ids][0]!;
    expect(['day-1', 'run-old']).not.toContain(runId);
    expect(noticeById(runId)).toMatchObject({ kind: 'run', state: 'pending' });
    expect(notices().filter((n) => n.state === 'skipped')).toHaveLength(0);
  });

  describe('R24: the late tail of a window is batched into one run notice', () => {
    const scheduleRow = (id: string) =>
      testDb.prepare('SELECT agent_next_runs, next_run_at FROM schedules WHERE id = ?').get(id) as {
        agent_next_runs: string;
        next_run_at: string;
      };
    const runNotices = () => notices().filter((n) => n.kind === 'run');

    beforeEach(() => {
      // No Math.random pin: every advanced agent (due or swept tail) uses
      // afterFire (R25), so it moves to tomorrow whatever the roll.
      for (const a of ['agent-4', 'agent-5']) insertTestAgent(testDb, { id: a, hostname: `host-${a}` });
    });

    it('agents due 16:51-16:59 share ONE run notice created on the first late tick; later ticks add nothing', () => {
      insertDayNotice('day-1', 'pm', 'sent');
      perMachine('pm', {
        'agent-1': T('16:51:00'),
        'agent-2': T('16:53:00'),
        'agent-3': T('16:55:00'),
        'agent-4': T('16:57:00'),
        'agent-5': T('16:59:00'),
      });

      for (let m = 51; m <= 59; m++) {
        const now = T(`16:${m}:30`);
        vi.setSystemTime(now);
        expect(processSchedules(now).errors).toEqual([]);
        if (m === 51) {
          // Everything up to the window end is dispatched on the first late tick.
          expect(tasksOf()).toHaveLength(5);
          expect(runNotices()).toHaveLength(1);
        }
      }

      const runs = runNotices();
      expect(runs).toHaveLength(1);
      expect(JSON.parse(runs[0].schedule_ids)).toEqual(['pm']);
      const ts = tasksOf();
      expect(ts.map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5']);
      expect(ts.every((t) => t.notice_id === runs[0].id)).toBe(true);
      // All five were advanced as if they had fired: next run is tomorrow.
      const map = JSON.parse(scheduleRow('pm').agent_next_runs) as Record<string, string>;
      expect(Object.values(map).every((v) => v > DAY_DEADLINE.toISOString())).toBe(true);
      expect(noticeById('day-1').pickup_deadline).toBe(DAY_DEADLINE.toISOString());
    });

    it('a swept tail agent that fires is advanced with afterFire: a later-today roll still moves it to tomorrow', () => {
      // Weekday window 09:00-17:00 (480 min): 479/480 rolls 16:59, later than
      // both the tick (16:55:30) and the tail slot (16:58) it is advanced from.
      const random = vi.spyOn(Math, 'random').mockReturnValue(479.5 / 480);
      try {
        insertDayNotice('day-1', 'pm', 'sent');
        perMachine('pm', { 'agent-1': T('16:55:00'), 'agent-2': T('16:58:00') });
        const now = T('16:55:30');
        vi.setSystemTime(now);

        expect(processSchedules(now).errors).toEqual([]);
        expect(tasksOf().map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2']); // agent-2 swept

        // Tomorrow is Saturday 2026-10-24 (window 00:00-24:00): the same pin
        // gives floor(1438.5) = 1438 min, i.e. 23:58.
        const map = JSON.parse(scheduleRow('pm').agent_next_runs) as Record<string, string>;
        expect(map['agent-2']).toBe('2026-10-24T23:58:00.000Z');
        expect(map['agent-1']).toBe('2026-10-24T23:58:00.000Z');

        // Nothing else fires today.
        for (const at of [T('16:58:30'), T('16:59:30')]) {
          vi.setSystemTime(at);
          expect(processSchedules(at).errors).toEqual([]);
        }
        expect(tasksOf()).toHaveLength(2);
      } finally {
        random.mockRestore();
      }
    });

    it('does not sweep an agent whose next run is tomorrow', () => {
      insertDayNotice('day-1', 'pm', 'sent');
      const tomorrow = new Date('2026-10-24T09:30:00.000Z');
      perMachine('pm', { 'agent-1': T('16:55:00'), 'agent-2': T('16:58:00'), 'agent-3': tomorrow });
      const now = T('16:55:30');
      vi.setSystemTime(now);

      expect(processSchedules(now).errors).toEqual([]);

      expect(tasksOf().map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2']);
      const map = JSON.parse(scheduleRow('pm').agent_next_runs) as Record<string, string>;
      expect(map['agent-3']).toBe(tomorrow.toISOString());
    });

    it('weekend: an agent at next-day 00:00 (the window end instant) is not swept', () => {
      // Saturday 2026-10-24: the window is 00:00 to Sunday 00:00.
      const sat = (hhmmss: string) => new Date(`2026-10-24T${hhmmss}.000Z`);
      const sunday0 = new Date('2026-10-25T00:00:00.000Z');
      insertDayNotice('day-sat', 'pm', 'sent', { date: '2026-10-24', start: sat('00:00:00'), end: sunday0 });
      perMachine('pm', { 'agent-1': sat('23:55:00'), 'agent-2': sat('23:58:00'), 'agent-3': sunday0 });
      const now = sat('23:55:30');
      vi.setSystemTime(now);

      expect(processSchedules(now).errors).toEqual([]);

      expect(tasksOf().map((t) => t.agent_id)).toEqual(['agent-1', 'agent-2']);
      const map = JSON.parse(scheduleRow('pm').agent_next_runs) as Record<string, string>;
      expect(map['agent-3']).toBe(sunday0.toISOString());
    });

    it('tolerates malformed agent_next_runs entries: the tick does not throw and they are advanced', () => {
      insertSchedule('pm', ['agent-1', 'agent-2', 'agent-3'], {
        nextRunAt: T('11:59:00'),
        config: { time: '12:00', randomize_mode: 'per_machine' },
        agentNextRuns: {
          'agent-1': T('11:59:00').toISOString(),
          // Sorts before now, so it counts as past-due; Date.parse gives NaN.
          'agent-2': '0000-garbage',
          // Sorts after any ISO time, so it is never past-due by string compare.
          'agent-3': 'garbage',
        },
      });
      const now = T('12:00:30');
      vi.setSystemTime(now);

      expect(() => processSchedules(now)).not.toThrow();

      const map = JSON.parse(scheduleRow('pm').agent_next_runs) as Record<string, string>;
      for (const id of ['agent-1', 'agent-2', 'agent-3']) {
        expect(map[id]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(map[id] > now.toISOString()).toBe(true);
      }
      expect(scheduleRow('pm').next_run_at > now.toISOString()).toBe(true);
    });

    it('redirect path: a createTasks failure leaves the schedule off the notice, which is skipped without email', async () => {
      insertDayNotice('day-1', 'pm', 'sent');
      perMachine('pm', { 'agent-1': T('16:55:00'), 'agent-2': T('16:58:00') });
      fs.rmSync(path.join(SETTINGS_DIR, 'builds', 'uuid-pm'), { recursive: true, force: true });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const now = T('16:55:30');
      vi.setSystemTime(now);

      expect(processSchedules(now).errors).toHaveLength(1);

      expect(tasksOf()).toHaveLength(0);
      const runs = runNotices();
      expect(runs).toHaveLength(1);
      expect(JSON.parse(runs[0].schedule_ids)).toEqual([]);

      await tick(now);
      expect(noticeById(runs[0].id)).toMatchObject({ state: 'skipped', skip_reason: 'no tasks were created' });
      expect(mockSendMail).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
