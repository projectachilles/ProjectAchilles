import { AppError } from '../../middleware/error.middleware.js';
import { getDatabase } from '../agent/database.js';
import { getNoticeRecord, getNoticeSummaries } from '../notices/notices.repo.js';
import { csvCell } from '../notices/render.js';
import { resolveUserLabel } from '../notices/userLabel.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import type { NoticeRecord, NoticeScope, NoticeSummary } from '../notices/types.js';
import type { TaskStatus } from '../../types/agent.js';
import type { CampaignRunRow, CellState, RunSnapshot } from './types.js';
import { fetchEdrDocs, type EdrDocs, type EdrStatus } from '../outcomes/edr.js';
import { cellVerdict, controlsOf, edrTerminatedVerdict, resultDocIds, type StageView } from '../outcomes/verdict.js';
import type { EdrTermination } from '../edr/agent-kill-evidence.js';

export interface MatrixCell {
  state: CellState;
  exit_code: number | null;
  task_id: string | null;
  completed_at: string | null;
  reason: string | null;
  /** payload.metadata.techniques of the latest attempt (for the CSV) */
  techniques: string[];
  /** EDR summary ("Defender: prevented (process killed)"), "unavailable", or null. */
  edr: string | null;
  /** Per-stage results of a multi-stage test (empty otherwise). */
  stages: StageView[];
  /** Compact stage list for the CSV. */
  stages_text: string;
}

export interface RunMatrix {
  run: {
    id: string;
    campaign_id: string;
    campaign_name: string;
    framework_label: string | null;
    started_by: string;
    /** Display name from the run snapshot; started_by for runs without one. */
    started_by_name: string;
    started_at: string;
    /** The run's notice with its delivery record (sent at, recipients, override). */
    notice: NoticeRecord | null;
  };
  /** Whether EDR correlation was applied, and which integrations it reflects. */
  edr: { status: EdrStatus; sources: string[] };
  tests: { uuid: string; name: string }[];
  agents: { id: string; hostname: string; os: string }[];
  cells: Record<string, Record<string, MatrixCell>>;
  totals: Record<CellState, number> & { percent_protected: number | null };
  as_of: string;
}

interface PairTask {
  id: string;
  agent_id: string;
  test_uuid: string;
  status: TaskStatus;
  exit_code: number | null;
  error: string | null;
  /** JSON array text from payload.metadata.techniques */
  techniques: string | null;
  completed_at: string | null;
  notice_id: string | null;
  category: string | null;
  /** JSON array text from result.bundle_results.controls */
  controls: string | null;
  stderr_tail: string | null;
  /** JSON text of result.edr_terminated: set once a watchdog-failed run was proved EDR-killed. */
  edr_terminated: string | null;
}

const STATES: CellState[] = [
  'waiting_for_notice', 'running', 'protected', 'prevented', 'detected', 'unprotected', 'error', 'not_run', 'na',
];

function findRun(runId: string, callerOrg: string | undefined): CampaignRunRow {
  const db = getDatabase();
  const row = (callerOrg !== undefined
    ? db.prepare('SELECT * FROM campaign_runs WHERE id = ? AND org_id = ?').get(runId, callerOrg)
    : db.prepare('SELECT * FROM campaign_runs WHERE id = ?').get(runId)) as CampaignRunRow | undefined;
  if (!row) throw new AppError('Campaign run not found', 404);
  return row;
}

/** Latest attempt per (test, agent) pair in the run: retries inherit campaign_run_id. */
function latestTasksByPair(runId: string): Map<string, PairTask> {
  // Only the latest attempt per pair, and only the small fields the matrix needs:
  // result stdout/stderr can be ~1 MB each and must never be loaded here.
  const rows = getDatabase()
    .prepare(
      `SELECT id, agent_id, test_uuid, status, exit_code, error, techniques, completed_at, notice_id,
              category, controls, stderr_tail, edr_terminated FROM (
         SELECT id, agent_id, json_extract(payload, '$.test_uuid') AS test_uuid, status,
                json_extract(result, '$.exit_code') AS exit_code,
                json_extract(result, '$.error') AS error,
                json_extract(payload, '$.metadata.techniques') AS techniques,
                completed_at, notice_id,
                json_extract(payload, '$.metadata.category') AS category,
                CASE WHEN status = 'completed' THEN json_extract(result, '$.bundle_results.controls') END AS controls,
                CASE WHEN status = 'completed' THEN substr(json_extract(result, '$.stderr'), -400) END AS stderr_tail,
                json_extract(result, '$.edr_terminated') AS edr_terminated,
                ROW_NUMBER() OVER (
                  PARTITION BY json_extract(payload, '$.test_uuid'), agent_id
                  ORDER BY created_at DESC, rowid DESC) AS rn
         FROM tasks WHERE campaign_run_id = ?
       ) WHERE rn = 1`,
    )
    .all(runId) as PairTask[];
  const out = new Map<string, PairTask>();
  for (const r of rows) out.set(`${r.test_uuid}\u0000${r.agent_id}`, r);
  return out;
}

function noticeReleased(n: NoticeSummary | undefined, nowIso: string): boolean {
  return !!n && (n.state === 'sent' || n.state === 'overridden') && n.release_at !== null && n.release_at <= nowIso;
}

function parseTechniques(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseControls(raw: string | null) {
  if (!raw) return null;
  try {
    return controlsOf(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseTermination(raw: string | null): EdrTermination | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as EdrTermination;
    return Array.isArray(v?.vendors) && v.vendors.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Result-doc ids of a completed cell (none while running, or for cyber-hygiene bundles). */
function docIdsFor(task: PairTask): string[] {
  return task.status === 'completed' ? resultDocIds(task.id, task.category, parseControls(task.controls)) : [];
}

const EMPTY = { edr: null, stages: [] as StageView[], stages_text: '' };

function cellFor(task: PairTask, notices: Record<string, NoticeSummary>, nowIso: string, edr: EdrDocs): MatrixCell {
  const base = { exit_code: task.exit_code, task_id: task.id, completed_at: task.completed_at, techniques: parseTechniques(task.techniques) };
  switch (task.status) {
    case 'pending': {
      const state = task.notice_id && !noticeReleased(notices[task.notice_id], nowIso) ? 'waiting_for_notice' : 'running';
      return { state, ...base, reason: null, ...EMPTY };
    }
    case 'assigned':
    case 'downloading':
    case 'executing':
      return { state: 'running', ...base, reason: null, ...EMPTY };
    case 'completed': {
      const v = cellVerdict({
        taskId: task.id,
        exitCode: task.exit_code,
        error: task.error,
        stderrTail: task.stderr_tail,
        category: task.category,
        controls: parseControls(task.controls),
        edr,
      });
      return { state: v.state, ...base, reason: v.reason, edr: v.edr, stages: v.stages, stages_text: v.stagesText };
    }
    case 'failed': {
      // The EDR killed the agent mid-run (reconciled from its alerts): Protected, stages unknown.
      const killed = parseTermination(task.edr_terminated);
      if (killed) {
        const v = edrTerminatedVerdict(killed);
        return { state: v.state, ...base, reason: v.reason, edr: v.edr, stages: v.stages, stages_text: v.stagesText };
      }
      // The reason a pair did not produce a verdict (agent error).
      return { state: 'error', ...base, reason: task.error, ...EMPTY };
    }
    default:
      return { state: 'not_run', ...base, reason: task.error, ...EMPTY }; // expired / cancelled
  }
}

function totalsOf(cells: Record<string, Record<string, MatrixCell>>): RunMatrix['totals'] {
  const t = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<CellState, number>;
  for (const row of Object.values(cells)) for (const c of Object.values(row)) t[c.state]++;
  // Same basis as the Defense Score: EDR-prevented and EDR-detected results count as protected.
  const covered = t.protected + t.prevented + t.detected;
  const denom = covered + t.unprotected;
  return { ...t, percent_protected: denom === 0 ? null : Math.round((covered / denom) * 100) };
}

/**
 * The snapshot's display name. Runs launched before names were looked up
 * stored the Clerk user id; resolve those for display (the snapshot itself
 * is never rewritten).
 */
async function startedByName(row: CampaignRunRow, snap: RunSnapshot): Promise<string> {
  const name = snap.started_by_name || row.started_by;
  return name.startsWith('user_') ? resolveUserLabel(name) : name;
}

/** EDR integrations are deployment-wide (their sync ignores org sections). */
function edrSources(): string[] {
  const svc = new IntegrationsSettingsService();
  return [
    ...(svc.isDefenderConfigured() ? ['Microsoft Defender'] : []),
    ...(svc.isCrowdStrikeConfigured() ? ['CrowdStrike Falcon'] : []),
    ...(svc.isSentinelOneConfigured() ? ['SentinelOne'] : []),
  ];
}

async function build(row: CampaignRunRow): Promise<RunMatrix> {
  const snap = JSON.parse(row.snapshot) as RunSnapshot;
  const nowIso = new Date().toISOString();
  const byPair = latestTasksByPair(row.id);
  const skipped = new Map(snap.skipped.map((s) => [`${s.test_uuid}\u0000${s.agent_id}`, s.reason]));
  const noticeIds = [...byPair.values()].map((t) => t.notice_id).filter((id): id is string => !!id);
  const scope: NoticeScope = { kind: 'org', orgId: row.org_id };
  const notices = getNoticeSummaries(noticeIds, scope);
  const edr = await fetchEdrDocs([...byPair.values()].flatMap(docIdsFor));

  const cells: RunMatrix['cells'] = {};
  for (const t of snap.tests) {
    cells[t.uuid] = {};
    for (const a of snap.agents) {
      const key = `${t.uuid}\u0000${a.id}`;
      const reason = skipped.get(key);
      const task = byPair.get(key);
      cells[t.uuid][a.id] = reason !== undefined
        ? { state: 'na', exit_code: null, task_id: null, completed_at: null, reason, techniques: [], ...EMPTY }
        : task
          ? cellFor(task, notices, nowIso, edr)
          : { state: 'not_run', exit_code: null, task_id: null, completed_at: null, reason: null, techniques: [], ...EMPTY };
    }
  }
  return {
    run: {
      id: row.id,
      campaign_id: row.campaign_id,
      campaign_name: snap.campaign_name,
      framework_label: snap.framework_label,
      started_by: row.started_by,
      started_by_name: await startedByName(row, snap),
      started_at: row.started_at,
      notice: row.notice_id ? getNoticeRecord(row.notice_id, scope) : null,
    },
    edr: { status: edr.status, sources: edrSources() },
    tests: snap.tests,
    agents: snap.agents,
    cells,
    totals: totalsOf(cells),
    as_of: nowIso,
  };
}

export async function getRunMatrix(runId: string, callerOrg: string | undefined): Promise<RunMatrix> {
  return build(findRun(runId, callerOrg));
}

export async function computeRunTotals(runId: string): Promise<RunMatrix['totals']> {
  return (await build(findRun(runId, undefined))).totals;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface RunListItem {
  id: string;
  started_at: string;
  started_by: string;
  started_by_name: string;
  task_count: number;
  percent_protected: number | null;
}

export interface AllRunsItem extends RunListItem {
  campaign_id: string;
  campaign_name: string;
  campaign_deleted: boolean;
}

async function runListItem(r: CampaignRunRow, snap: RunSnapshot): Promise<RunListItem> {
  return {
    id: r.id,
    started_at: r.started_at,
    started_by: r.started_by,
    started_by_name: await startedByName(r, snap),
    task_count: r.task_count,
    // Per-row totals are fine: the page is at most 100 rows.
    percent_protected: (await build(r)).totals.percent_protected,
  };
}

/** Runs of one campaign, newest first, one page at a time. */
export async function listRuns(campaignId: string, callerOrg: string | undefined, limit: number, offset: number): Promise<Page<RunListItem>> {
  const db = getDatabase();
  const where = callerOrg !== undefined ? 'campaign_id = ? AND org_id = ?' : 'campaign_id = ?';
  const params = callerOrg !== undefined ? [campaignId, callerOrg] : [campaignId];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM campaign_runs WHERE ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM campaign_runs WHERE ${where} ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as CampaignRunRow[];
  return { items: await Promise.all(rows.map((r) => runListItem(r, JSON.parse(r.snapshot) as RunSnapshot))), total };
}

/** All runs of the caller's org, newest first, including runs whose campaign was deleted. */
export async function listAllRuns(callerOrg: string | undefined, limit: number, offset: number): Promise<Page<AllRunsItem>> {
  const db = getDatabase();
  const where = callerOrg !== undefined ? 'WHERE org_id = ?' : '';
  const params = callerOrg !== undefined ? [callerOrg] : [];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM campaign_runs ${where}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT * FROM campaign_runs ${where} ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as CampaignRunRow[];
  const ids = [...new Set(rows.map((r) => r.campaign_id))];
  const live = new Set(
    ids.length === 0
      ? []
      : (db.prepare(`SELECT id FROM campaigns WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as { id: string }[])
          .map((c) => c.id),
  );
  const items = await Promise.all(rows.map(async (r) => {
    const snap = JSON.parse(r.snapshot) as RunSnapshot;
    return {
      ...(await runListItem(r, snap)),
      campaign_id: r.campaign_id,
      campaign_name: snap.campaign_name,
      campaign_deleted: !live.has(r.campaign_id),
    };
  }));
  return { items, total };
}

/**
 * CSV header (Ruling C10, extended). Every pair is a row: skipped pairs are
 * `na`. `reason` explains every outcome. `exit_code` is blank for na and
 * not_run (no verdict, so no exit code is evidence of anything). `stages` and
 * `edr` were appended later, at the end, so existing parsers keep working.
 */
export const RUN_CSV_HEADER = 'test,techniques,host,os,outcome,exit_code,reason,completed_at,as_of,stages,edr';

export function runMatrixCsv(m: RunMatrix): string {
  const lines = [RUN_CSV_HEADER];
  for (const t of m.tests) {
    for (const a of m.agents) {
      const c = m.cells[t.uuid]?.[a.id];
      if (!c) continue;
      lines.push(
        [
          csvCell(t.name),
          csvCell(c.techniques.join('; ')),
          csvCell(a.hostname),
          csvCell(a.os),
          c.state,
          c.exit_code === null || c.state === 'na' || c.state === 'not_run' ? '' : String(c.exit_code),
          csvCell(c.reason ?? ''),
          csvCell(c.completed_at ?? ''),
          csvCell(m.as_of),
          csvCell(c.stages_text),
          csvCell(c.edr ?? ''),
        ].join(','),
      );
    }
  }
  return lines.join('\r\n') + '\r\n';
}
