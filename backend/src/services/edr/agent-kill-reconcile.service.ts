import type { Client, estypes } from '@elastic/elasticsearch';
// Reconciliation pass for test runs whose agent the EDR killed mid-test. The
// watchdog fails such a task and no result ever reaches Elasticsearch; this
// pass looks for proof of the kill in EVERY vendor's alert index (Defender,
// CrowdStrike, SentinelOne) and, when the evidence rule in
// agent-kill-evidence.ts holds, writes the run's Protected whole-test doc,
// links the proving alerts, and stamps the task. Runs after each vendor's
// enrichment pass; the result doesn't depend on which vendor synced first.
//
// The alert-side link is `f0rtika.achilles_agent_kill_*`, never
// `f0rtika.achilles_correlated`, so auto-resolve and automatic mitigation
// never select these alerts.
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { resolveTestNames } from '../analytics/test-name-lookup.js';
import type { LinkedTestName } from '../analytics/test-name-lookup.js';
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { listAgentKillCandidates, recordEdrTermination } from '../agent/tasks.service.js';
import type { AgentKillCandidateRow } from '../agent/tasks.service.js';
import { ingestEdrTerminatedResult } from '../agent/results.service.js';
import { DEFENDER_INDEX } from '../defender/index-management.js';
import { CROWDSTRIKE_INDEX } from '../crowdstrike/index-management.js';
import { SENTINELONE_INDEX } from '../sentinelone/index-management.js';
import { isAchillesMitigated, ACHILLES_MITIGATION_FIELDS, ACHILLES_MITIGATED_QUERY } from '../shared/achillesMitigation.js';
import {
  KILL_PREVENTION_ACTIONS,
  alertProvesKill,
  parseSqliteUtc,
  shortHostname,
  summarizeTermination,
} from './agent-kill-evidence.js';
import type { EdrTermination, EdrVendorKey, KillCandidateTask, KillEvidenceAlert } from './agent-kill-evidence.js';

export interface AgentKillPassResult {
  /** Watchdog-failed tasks examined (with a hostname and parseable times). */
  candidates: number;
  /** Tasks turned into Protected results on this pass. */
  reconciled: number;
  /** Already-reconciled tasks that gained another vendor's proof. */
  vendorsAdded: number;
  errors: string[];
}

const DEFAULT_LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Hits per candidate x vendor sub-search; a kill raises a handful of alerts at most. */
const ALERT_HITS_PER_SEARCH = 20;
/** Candidates per msearch (x3 vendor sub-searches). */
const CANDIDATES_PER_MSEARCH = 50;

const VENDOR_INDICES: ReadonlyArray<{ vendor: EdrVendorKey; index: string }> = [
  { vendor: 'defender', index: DEFENDER_INDEX },
  { vendor: 'crowdstrike', index: CROWDSTRIKE_INDEX },
  { vendor: 'sentinelone', index: SENTINELONE_INDEX },
];
const INDEX_OF_VENDOR = new Map(VENDOR_INDICES.map((v) => [v.vendor, v.index]));

const ALERT_SOURCE_FIELDS = ['created_at', 'evidence_hostnames', 'mitre_techniques', 'prevention_action', ...ACHILLES_MITIGATION_FIELDS];

/** The alert-doc link, declared on each alert index before it is first written. */
const MARKER_MAPPING = {
  achilles_agent_kill_task_id: { type: 'keyword' as const },
  achilles_agent_kill_matched_at: { type: 'date' as const },
};

interface AlertSource {
  created_at?: unknown;
  evidence_hostnames?: unknown;
  mitre_techniques?: unknown;
  prevention_action?: unknown;
}

interface Candidate {
  row: AgentKillCandidateRow;
  kill: KillCandidateTask;
}

interface PlannedWrite {
  candidate: Candidate;
  termination: EdrTermination;
  alerts: KillEvidenceAlert[];
  isNew: boolean;
}

function emptyResult(errors: string[] = []): AgentKillPassResult {
  return { candidates: 0, reconciled: 0, vendorsAdded: 0, errors };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function toCandidate(row: AgentKillCandidateRow): Candidate | null {
  if (!row.hostname) return null;
  const assignedAtMs = row.task.assigned_at ? parseSqliteUtc(row.task.assigned_at) : NaN;
  const failedAtMs = row.task.completed_at ? parseSqliteUtc(row.task.completed_at) : NaN;
  if (!Number.isFinite(assignedAtMs) || !Number.isFinite(failedAtMs)) return null;
  return {
    row,
    kill: {
      taskId: row.task.id,
      hostname: row.hostname,
      assignedAtMs,
      failedAtMs,
      techniques: row.task.payload.metadata?.techniques ?? [],
    },
  };
}

/**
 * Coarse ES prefilter for one candidate. `alertProvesKill` is the authority
 * (exact short-hostname match, technique overlap); this only keeps the hit
 * count small. The host prefix runs on both the text field and `.keyword`
 * because legacy clusters map evidence_hostnames either way.
 */
function killEvidenceQuery(c: KillCandidateTask): estypes.QueryDslQueryContainer {
  const hostPrefix = `${shortHostname(c.hostname).replace(/[*?\\]/g, '')}*`;
  return {
    bool: {
      filter: [
        { term: { doc_type: 'alert' } },
        {
          bool: {
            should: [
              { wildcard: { evidence_hostnames: { value: hostPrefix, case_insensitive: true } } },
              { wildcard: { 'evidence_hostnames.keyword': { value: hostPrefix, case_insensitive: true } } },
            ],
            minimum_should_match: 1,
          },
        },
        { range: { created_at: { gte: new Date(c.assignedAtMs).toISOString(), lte: new Date(c.failedAtMs).toISOString() } } },
        { terms: { prevention_action: [...KILL_PREVENTION_ACTIONS] } },
      ],
      must_not: [ACHILLES_MITIGATED_QUERY],
    },
  };
}

function isMissingIndex(error: estypes.ErrorCause): boolean {
  return error.type === 'index_not_found_exception';
}

/**
 * Add the proof found on this pass to an earlier termination. A vendor recorded
 * before stays recorded even when its alert has since left the index (S1 drops
 * items that stop passing its filters); it keeps its place relative to the new
 * proof by the earlier kill time.
 */
function mergeTermination(prev: EdrTermination, fresh: EdrTermination): EdrTermination {
  const keptVendors = prev.vendors.filter((v) => !fresh.vendors.includes(v));
  const keptIds = prev.alert_ids.filter((id) => !fresh.alert_ids.includes(id));
  const prevFirst = parseSqliteUtc(prev.killed_at) <= parseSqliteUtc(fresh.killed_at);
  return {
    vendors: prevFirst ? [...keptVendors, ...fresh.vendors] : [...fresh.vendors, ...keptVendors],
    alert_ids: prevFirst ? [...keptIds, ...fresh.alert_ids] : [...fresh.alert_ids, ...keptIds],
    killed_at: prevFirst ? prev.killed_at : fresh.killed_at,
    reconciled_at: fresh.reconciled_at,
  };
}

export class EdrAgentKillReconciler {
  /** Alert indices whose marker mapping was put during this pass. */
  private readonly mappedIndices = new Set<string>();

  constructor(
    private readonly client: Client,
    private readonly resultsIndexPattern: string,
  ) {}

  async runPass(opts: { lookbackDays?: number; now?: Date } = {}): Promise<AgentKillPassResult> {
    const result = emptyResult();
    const now = opts.now ?? new Date();
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * DAY_MS).toISOString();

    const candidates = listAgentKillCandidates(since)
      .map(toCandidate)
      .filter((c): c is Candidate => c !== null);
    result.candidates = candidates.length;
    if (candidates.length === 0) return result;

    const evidence = await this.fetchEvidence(candidates, result.errors);

    const planned: PlannedWrite[] = [];
    for (const candidate of candidates) {
      const alerts = (evidence.get(candidate.kill.taskId) ?? []).filter((a) => alertProvesKill(candidate.kill, a));
      if (alerts.length === 0) continue;
      const fresh = summarizeTermination(alerts, nowIso);
      const prev = candidate.row.termination;
      if (!prev) {
        planned.push({ candidate, termination: fresh, alerts, isNew: true });
      } else if (fresh.vendors.some((v) => !prev.vendors.includes(v))) {
        planned.push({ candidate, termination: mergeTermination(prev, fresh), alerts, isNew: false });
      }
    }
    if (planned.length === 0) return result;

    // One lookup per pass: a uuid that names a bundle gets bundle_id on its doc.
    const uuids = [...new Set(planned.map((p) => p.candidate.row.task.payload.test_uuid))];
    const names = await resolveTestNames(this.client, this.resultsIndexPattern, uuids);

    for (const p of planned) {
      if (await this.write(p, names, nowIso, result.errors)) {
        if (p.isNew) result.reconciled += 1;
        else result.vendorsAdded += 1;
      }
    }
    return result;
  }

  /** Candidate alerts per task id, from one msearch per chunk of candidates. */
  private async fetchEvidence(candidates: Candidate[], errors: string[]): Promise<Map<string, KillEvidenceAlert[]>> {
    const byTask = new Map<string, KillEvidenceAlert[]>();
    for (let i = 0; i < candidates.length; i += CANDIDATES_PER_MSEARCH) {
      const chunk = candidates.slice(i, i + CANDIDATES_PER_MSEARCH);
      const searches: estypes.MsearchRequestItem[] = [];
      const keys: Array<{ taskId: string; vendor: EdrVendorKey }> = [];
      for (const c of chunk) {
        for (const { vendor, index } of VENDOR_INDICES) {
          searches.push({ index, ignore_unavailable: true });
          searches.push({ size: ALERT_HITS_PER_SEARCH, _source: ALERT_SOURCE_FIELDS, query: killEvidenceQuery(c.kill) });
          keys.push({ taskId: c.kill.taskId, vendor });
        }
      }

      let response: estypes.MsearchResponse<AlertSource>;
      try {
        response = await this.client.msearch<AlertSource>({ searches });
      } catch (err) {
        errors.push(`msearch: ${errMsg(err)}`);
        continue;
      }

      response.responses.forEach((sub, j) => {
        const key = keys[j];
        if (!key) return;
        if ('error' in sub) {
          if (!isMissingIndex(sub.error)) {
            errors.push(`msearch[${key.vendor}]: ${sub.error.reason ?? sub.error.type}`);
          }
          return;
        }
        const list = byTask.get(key.taskId) ?? [];
        for (const hit of sub.hits.hits) {
          if (!hit._id) continue;
          const s = hit._source ?? {};
          list.push({
            id: hit._id,
            vendor: key.vendor,
            createdAt: typeof s.created_at === 'string' ? s.created_at : null,
            evidenceHostnames: strings(s.evidence_hostnames),
            mitreTechniques: strings(s.mitre_techniques),
            preventionAction: typeof s.prevention_action === 'string' ? s.prevention_action : undefined,
            achillesMitigated: isAchillesMitigated(s),
          });
        }
        byTask.set(key.taskId, list);
      });
    }
    return byTask;
  }

  /**
   * Result doc, then alert markers, then the SQLite stamp. A failed doc write
   * leaves the task unstamped so the next pass retries it; failed markers only
   * cost the UI link, so the task is still stamped.
   */
  private async write(p: PlannedWrite, names: Map<string, LinkedTestName>, nowIso: string, errors: string[]): Promise<boolean> {
    const { task } = p.candidate.row;
    const name = names.get(task.payload.test_uuid);
    const bundle = name?.kind === 'bundle' ? { bundleName: name.name } : null;
    try {
      await ingestEdrTerminatedResult(task, p.candidate.kill.hostname, p.termination, bundle);
    } catch (err) {
      errors.push(`result ${task.id}: ${errMsg(err)}`);
      return false;
    }
    const markerError = await this.markAlerts(task.id, p.alerts, nowIso);
    if (markerError) errors.push(`alert markers ${task.id}: ${markerError}`);
    try {
      recordEdrTermination(task.id, p.termination);
    } catch (err) {
      errors.push(`stamp ${task.id}: ${errMsg(err)}`);
      return false;
    }
    return true;
  }

  /** Link the proving alerts to the task. Returns an error message, or null. */
  private async markAlerts(taskId: string, alerts: KillEvidenceAlert[], nowIso: string): Promise<string | null> {
    const operations: NonNullable<estypes.BulkRequest['operations']> = [];
    for (const a of alerts) {
      const index = INDEX_OF_VENDOR.get(a.vendor);
      if (!index) continue;
      await this.ensureMarkerMapping(index);
      operations.push({ update: { _index: index, _id: a.id } });
      operations.push({ doc: { f0rtika: { achilles_agent_kill_task_id: taskId, achilles_agent_kill_matched_at: nowIso } } });
    }
    if (operations.length === 0) return null;
    try {
      const res = await this.client.bulk({ operations });
      if (!res.errors) return null;
      const reasons = res.items
        .map((item) => item.update?.error?.reason)
        .filter((r): r is string => typeof r === 'string');
      return reasons.slice(0, 3).join('; ') || 'bulk reported errors';
    } catch (err) {
      return errMsg(err);
    }
  }

  /**
   * Declare the marker fields before the first write, so an index whose
   * mapping predates them doesn't map the task id as text. Additive and
   * non-fatal, like the vendors' own ensure*Mappings.
   */
  private async ensureMarkerMapping(index: string): Promise<void> {
    if (this.mappedIndices.has(index)) return;
    this.mappedIndices.add(index);
    try {
      await this.client.indices.putMapping({ index, properties: { f0rtika: { properties: MARKER_MAPPING } } });
    } catch (err) {
      console.warn(`[EDR-AgentKill] putMapping failed for ${index}: ${errMsg(err)}`);
    }
  }
}

/** True when any EDR integration (Defender, CrowdStrike, SentinelOne) is configured. */
export function isAnyEdrConfigured(): boolean {
  const s = new IntegrationsSettingsService();
  return s.isDefenderConfigured() || s.isCrowdStrikeConfigured() || s.isSentinelOneConfigured();
}

/** What a vendor sync records when the pass could not run at all. */
export function failedAgentKillPass(err: unknown): AgentKillPassResult {
  return emptyResult([errMsg(err)]);
}

let inFlight: Promise<AgentKillPassResult> | null = null;

/**
 * Run one reconciliation pass with the analytics ES client. Never throws:
 * failures come back in `errors` and the next sync retries. Overlapping calls
 * (two vendors finishing their syncs together) share one pass.
 */
export function runAgentKillReconciliation(): Promise<AgentKillPassResult> {
  inFlight ??= runOnce().finally(() => { inFlight = null; });
  return inFlight;
}

async function runOnce(): Promise<AgentKillPassResult> {
  try {
    const settings = new SettingsService().getSettings();
    if (!settings.configured) return emptyResult(['Elasticsearch is not configured']);
    const reconciler = new EdrAgentKillReconciler(createEsClient(settings), settings.indexPattern);
    const result = await reconciler.runPass();
    if (result.reconciled || result.vendorsAdded || result.errors.length) {
      console.log(
        `[EDR-AgentKill] candidates=${result.candidates} reconciled=${result.reconciled} ` +
        `vendorsAdded=${result.vendorsAdded} errors=${result.errors.length}`,
      );
      for (const e of result.errors.slice(0, 5)) console.warn(`[EDR-AgentKill-ERROR] ${e}`);
    }
    return result;
  } catch (err) {
    const msg = errMsg(err);
    console.error(`[EDR-AgentKill] pass threw: ${msg}`);
    return emptyResult([msg]);
  }
}
