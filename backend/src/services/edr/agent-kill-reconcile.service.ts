// Reconciliation pass for test runs whose agent the EDR killed mid-test. The
// watchdog fails such a task and no result ever reaches Elasticsearch; this
// pass looks for proof of the kill in EVERY configured vendor's alert index
// (Defender, CrowdStrike, SentinelOne) and, when the evidence rule in
// agent-kill-evidence.ts holds, writes the run's Protected whole-test doc,
// links the proving alerts, and stamps the task. Runs after each vendor's
// enrichment pass; the result doesn't depend on which vendor synced first.
//
// The alert-side link is `f0rtika.achilles_agent_kill_*`, never
// `f0rtika.achilles_correlated`, so auto-resolve and automatic mitigation
// never select these alerts.
import type { Client, estypes } from '@elastic/elasticsearch';
import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';
import { listAgentKillCandidates, recordEdrTermination } from '../agent/tasks.service.js';
import type { AgentKillCandidateRow } from '../agent/tasks.service.js';
import { ingestEdrTerminatedResult } from '../agent/results.service.js';
import { resolveBundleNames } from './bundle-identity.js';
import { VENDOR_INDICES, configuredVendorIndices, isAnyEdrConfigured } from './edr-configured.js';
import type { VendorIndex } from './edr-configured.js';
import { isAchillesMitigated, ACHILLES_MITIGATION_FIELDS, ACHILLES_MITIGATED_QUERY } from '../shared/achillesMitigation.js';
import {
  KILL_PREVENTION_ACTIONS,
  alertProvesKill,
  parseSqliteUtc,
  shortHostname,
  summarizeTermination,
} from './agent-kill-evidence.js';
import type { EdrTermination, EdrVendorKey, KillCandidateTask, KillEvidenceAlert } from './agent-kill-evidence.js';
import type { AgentKillPassResult } from '../../types/agent-kill.js';

export type { AgentKillPassResult };

/** Lookback of a process's first full pass: covers kills from before a restart or deploy. */
const DEFAULT_LOOKBACK_DAYS = 30;
/** Lookback of every later pass; vendor alerts sync within minutes, so 2 days is ample. */
const RECENT_LOOKBACK_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long after the agent's next pickup an alert still counts for the dead
 * task: the console's createdAt can lag the kill itself by a few seconds.
 */
const NEXT_TASK_GRACE_MS = 60 * 1000;
/** Hits per candidate x vendor sub-search, earliest first; a kill raises a handful of alerts at most. */
const ALERT_HITS_PER_SEARCH = 50;
/** Candidates per msearch (one sub-search per configured vendor each). */
const CANDIDATES_PER_MSEARCH = 50;

const INDEX_OF_VENDOR = new Map(VENDOR_INDICES.map((v) => [v.vendor, v.index]));

const ALERT_SOURCE_FIELDS = [
  'created_at', 'evidence_hostnames', 'mitre_techniques', 'prevention_action',
  'f0rtika.achilles_test_uuid', ...ACHILLES_MITIGATION_FIELDS,
];

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
  f0rtika?: { achilles_test_uuid?: unknown };
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
  // A restarted agent (service recovery, quick reboot) runs its next test
  // while this one still waits for the watchdog; that test's alerts must not
  // count. The window ends at the next pickup, plus a grace for console lag.
  const nextMs = row.nextAssignedAt ? parseSqliteUtc(row.nextAssignedAt) + NEXT_TASK_GRACE_MS : NaN;
  return {
    row,
    kill: {
      taskId: row.task.id,
      testUuid: row.task.payload.test_uuid,
      hostname: row.hostname,
      assignedAtMs,
      failedAtMs: Number.isFinite(nextMs) ? Math.min(failedAtMs, nextMs) : failedAtMs,
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
 * Add the proof found on this pass to an earlier termination. What was
 * recorded stays, in its order, even when its alert has since left the index
 * (S1 drops items that stop passing its filters); new vendors and alerts are
 * appended in earliest-alert order. `killed_at` stays as recorded even when
 * the new vendor alerted earlier: it is the doc's event time and picks its
 * dated write index, so moving it could leave a second doc in another index.
 * The bundle decision is reused as stored.
 */
function mergeTermination(prev: EdrTermination, fresh: EdrTermination): EdrTermination {
  return {
    vendors: [...prev.vendors, ...fresh.vendors.filter((v) => !prev.vendors.includes(v))],
    alert_ids: [...prev.alert_ids, ...fresh.alert_ids.filter((id) => !prev.alert_ids.includes(id))],
    killed_at: prev.killed_at,
    reconciled_at: fresh.reconciled_at,
    ...(prev.bundle_name ? { bundle_name: prev.bundle_name } : {}),
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

    const vendors = configuredVendorIndices();
    if (vendors.length === 0) return result;

    const candidates = listAgentKillCandidates(since)
      .map(toCandidate)
      .filter((c): c is Candidate => c !== null);
    result.candidates = candidates.length;
    if (candidates.length === 0) return result;

    const evidence = await this.fetchEvidence(candidates, vendors, result.errors);

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

    // Decide bundle identity once, for new tasks only; a vendor-add rewrite
    // reuses the stored decision so a later lookup failure can't drop bundle_id.
    const fresh = planned.filter((p) => p.isNew);
    const bundles = await resolveBundleNames(this.client, this.resultsIndexPattern, [...new Set(fresh.map((p) => p.candidate.row.task.payload.test_uuid))]);
    for (const p of fresh) {
      const bundleName = bundles.get(p.candidate.row.task.payload.test_uuid);
      if (bundleName) p.termination.bundle_name = bundleName;
    }

    for (const p of planned) {
      if (await this.write(p, nowIso, result.errors)) {
        if (p.isNew) result.reconciled += 1;
        else result.vendorsAdded += 1;
      }
    }
    return result;
  }

  /** Candidate alerts per task id, from one msearch per chunk of candidates. */
  private async fetchEvidence(candidates: Candidate[], vendors: VendorIndex[], errors: string[]): Promise<Map<string, KillEvidenceAlert[]>> {
    const byTask = new Map<string, KillEvidenceAlert[]>();
    for (let i = 0; i < candidates.length; i += CANDIDATES_PER_MSEARCH) {
      const chunk = candidates.slice(i, i + CANDIDATES_PER_MSEARCH);
      const searches: estypes.MsearchRequestItem[] = [];
      const keys: Array<{ taskId: string; vendor: EdrVendorKey }> = [];
      for (const c of chunk) {
        for (const { vendor, index } of vendors) {
          searches.push({ index, ignore_unavailable: true });
          searches.push({
            size: ALERT_HITS_PER_SEARCH,
            sort: [{ created_at: 'asc' }],
            _source: ALERT_SOURCE_FIELDS,
            query: killEvidenceQuery(c.kill),
          });
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
            ...(typeof s.f0rtika?.achilles_test_uuid === 'string' ? { achillesTestUuid: s.f0rtika.achilles_test_uuid } : {}),
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
  private async write(p: PlannedWrite, nowIso: string, errors: string[]): Promise<boolean> {
    const { task } = p.candidate.row;
    const bundle = p.termination.bundle_name ? { bundleName: p.termination.bundle_name } : null;
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
      operations.push({ update: { _index: index, _id: a.id, retry_on_conflict: 3 } });
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

/** What a vendor sync records when the pass could not run at all. */
export function failedAgentKillPass(err: unknown): AgentKillPassResult {
  return emptyResult([errMsg(err)]);
}

let current: Promise<AgentKillPassResult> | null = null;
let trailing: Promise<AgentKillPassResult> | null = null;
/** Set once this process has run a clean 30-day pass with an EDR configured. */
let fullLookbackDone = false;

/** Test hook: forget that the first full-lookback pass ran. */
export function resetAgentKillLookback(): void {
  fullLookbackDone = false;
}

/**
 * Run one reconciliation pass with the analytics ES client. Never throws:
 * failures come back in `errors` and the next sync retries. Passes never
 * overlap: a call made while one runs waits for it and then gets exactly one
 * trailing pass (shared by every such caller), so alerts a vendor synced
 * mid-pass are still seen.
 */
export function runAgentKillReconciliation(): Promise<AgentKillPassResult> {
  if (trailing) return trailing;
  if (!current) return startPass();
  trailing = current.then(() => {
    trailing = null;
    return startPass();
  });
  return trailing;
}

function startPass(): Promise<AgentKillPassResult> {
  const pass: Promise<AgentKillPassResult> = runOnce().finally(() => {
    if (current === pass) current = null;
  });
  current = pass;
  return pass;
}

async function runOnce(): Promise<AgentKillPassResult> {
  try {
    const settings = new SettingsService().getSettings();
    if (!settings.configured) return emptyResult(['Elasticsearch is not configured']);
    const reconciler = new EdrAgentKillReconciler(createEsClient(settings), settings.indexPattern);
    // The first pass per process looks back 30 days (kills from before a
    // restart or deploy); later passes only 2. A pass that hit errors, or had
    // no EDR to search, doesn't count, so the next one still looks back 30.
    const lookbackDays = fullLookbackDone ? RECENT_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS;
    const result = await reconciler.runPass({ lookbackDays });
    if (result.errors.length === 0 && isAnyEdrConfigured()) fullLookbackDone = true;
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
