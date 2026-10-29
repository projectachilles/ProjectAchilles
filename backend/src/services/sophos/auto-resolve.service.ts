// Auto-resolve for the Sophos Central integration (the S1/Defender pattern).
//
// The only code in the Sophos integration that writes to a customer tenant.
// Reads alert docs the enrichment pass matched to an Achilles test
// (f0rtika.achilles_correlated:true) and closes them so continuous-validation
// activity doesn't flood the SOC queue:
//   - Common alerts:  POST /common/v1/alerts/{id}/actions  action 'acknowledge'
//   - XDR detections: GraphQL detectionUpdateResolutionInfo TRUE_POSITIVE_BENIGN
//
// Fail closed: every candidate is re-read from Sophos right before acting
// (the local status can be stale) and only acted on when still open. SIEM-only
// rows, agent-kill rows and anything unconfirmable are skipped. Receipts are
// written on the alert doc only, never on test docs.
//
// Dry run writes f0rtika.auto_resolve_dry_run_at (never auto_resolved:true), and
// enabled ignores dry-run receipts, so switching modes works.

import type { Client } from '@elastic/elasticsearch';
import { SophosApiError, SophosPermissionError, type SophosClient } from './sophos-client.js';
import { SOPHOS_INDEX } from './index-management.js';
import type { AutoResolveMode, AutoResolvePassResult } from '../../types/edr.js';

const DEFAULT_MAX_PER_PASS = 30;
const DEFAULT_MAX_DURATION_MS = 30_000;

/** Stored statuses (lowercased by normalize.ts) of a Common alert that mean it is no longer open. */
export const ALERT_CLOSED_STATUSES = ['resolved', 'acknowledged', 'closed'] as const;
/** Stored status of an XDR detection that is open (Sophos 'OPEN'). */
export const XDR_OPEN_STATUSES = ['open'] as const;
/** Live XDR resolution status auto-resolve may act on. */
const XDR_LIVE_OPEN = 'OPEN';
/** Common alert action auto-resolve performs; must be offered by the live alert. */
const ACKNOWLEDGE = 'acknowledge';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DETECTION_ID_RE = /^[A-Za-z0-9:/._@-]{1,256}$/;

const DETECTION_STATUS_QUERY =
  'query AchillesDetectionStatus($in: GetByIDRequestInput) { detectionRetrieveById(in: $in) { alerts { list { id status } } } }';

type SourceType = 'alert' | 'xdr_detection' | 'other';

interface Candidate {
  sophosId: string;
  sourceType: SourceType;
  docId: string;
  docIndex: string;
  testUuid: string;
  host: string;
}

export interface SophosAutoResolveOptions {
  modeOverride?: AutoResolveMode;
  maxPerPass?: number;
  maxDurationMs?: number;
}

export type SophosResolveClient = Pick<SophosClient, 'permissionMode' | 'getAlert' | 'acknowledgeAlert' | 'graphql' | 'resolveDetections'>;

/** What the live re-check concluded for one candidate. */
type Live = { kind: 'open' } | { kind: 'closed'; status: string } | { kind: 'gone' } | { kind: 'unknown' };

export class SophosAutoResolveService {
  constructor(
    private readonly es: Client,
    private readonly client: SophosResolveClient,
    private readonly mode: AutoResolveMode,
  ) {}

  static reasonText(bundleUuid: string, host: string): string {
    return `ProjectAchilles security test ${bundleUuid} on ${host} (auto-resolve)`;
  }

  async runAutoResolvePass(opts: SophosAutoResolveOptions = {}): Promise<AutoResolvePassResult> {
    const startedAt = Date.now();
    const mode = opts.modeOverride ?? this.mode;
    const result: AutoResolvePassResult = { mode, candidates: 0, patched: 0, wouldPatch: 0, skipped: 0, errors: [], durationMs: 0 };

    if (mode === 'disabled') return this.done(result, startedAt);
    if (mode === 'enabled' && this.client.permissionMode !== 'response') {
      result.errors.push('auto-resolve is enabled but the integration is read-only — nothing was written (switch to Response mode or use dry_run)');
      return this.done(result, startedAt);
    }

    try {
      const candidates = await this.findCandidates(opts.maxPerPass ?? DEFAULT_MAX_PER_PASS, mode);
      result.candidates = candidates.length;
      const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

      for (const c of candidates) {
        if (Date.now() - startedAt > maxDurationMs) break;
        // Defense in depth: the query already excludes SIEM-only rows; never act or write a receipt for them.
        if (c.sourceType === 'other') { result.skipped += 1; continue; }
        if (!c.sophosId || !c.testUuid) { result.skipped += 1; continue; }
        const idOk = c.sourceType === 'alert' ? UUID_RE.test(c.sophosId) : DETECTION_ID_RE.test(c.sophosId);
        if (!idOk) {
          result.skipped += 1;
          await this.writeReceipt(c, mode, 'invalid_id');
          continue;
        }

        let live: Live;
        try {
          live = await this.liveState(c);
        } catch (err) {
          if (isAuthError(err)) { result.errors.push(authMessage(err)); break; }
          result.skipped += 1;
          result.errors.push(`${c.sophosId}: live status: ${errMsg(err)}`);
          continue;
        }
        if (live.kind === 'unknown') { result.skipped += 1; continue; }
        if (live.kind === 'gone') {
          result.skipped += 1;
          await this.writeReceipt(c, mode, 'not_found');
          continue;
        }
        if (live.kind === 'closed') {
          result.skipped += 1;
          if (live.status) await this.mirrorStatus(c, live.status);
          else await this.writeReceipt(c, mode, 'not_actionable');
          continue;
        }

        if (mode === 'dry_run') {
          console.log(`[Sophos-AutoResolve-DryRun] would_resolve ${c.sourceType} id=${c.sophosId} test_uuid=${c.testUuid}`);
          result.wouldPatch += 1;
          await this.writeReceipt(c, 'dry_run');
          continue;
        }

        try {
          const reason = SophosAutoResolveService.reasonText(c.testUuid, c.host);
          if (c.sourceType === 'alert') await this.client.acknowledgeAlert(c.sophosId, reason);
          else await this.client.resolveDetections([c.sophosId], reason);
          result.patched += 1;
          await this.writeReceipt(c, 'enabled', undefined, c.sourceType === 'alert' ? 'acknowledged' : 'resolved');
        } catch (err) {
          if (isAuthError(err)) { result.errors.push(authMessage(err)); break; }
          if (err instanceof SophosApiError && err.statusCode === 404) {
            await this.writeReceipt(c, 'enabled', 'not_found');
            result.errors.push(`${c.sophosId}: not_found`);
            continue;
          }
          // Transient / unknown: no receipt, retried next pass.
          result.errors.push(`${c.sophosId}: ${errMsg(err)}`);
        }
      }
    } catch (err) {
      result.errors.push(`pass: ${errMsg(err)}`);
    }
    return this.done(result, startedAt);
  }

  private done(result: AutoResolvePassResult, startedAt: number): AutoResolvePassResult {
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  private async findCandidates(size: number, mode: AutoResolveMode): Promise<Candidate[]> {
    const receiptForMode = mode === 'dry_run'
      // A real resolve also satisfies a dry run; a dry-run receipt satisfies only dry runs.
      ? [{ exists: { field: 'f0rtika.auto_resolve_dry_run_at' } }, { term: { 'f0rtika.auto_resolved': true } }]
      : [{ term: { 'f0rtika.auto_resolved': true } }];
    const response = await this.es.search({
      index: SOPHOS_INDEX,
      size,
      query: {
        bool: {
          filter: [
            { term: { doc_type: 'alert' } },
            { term: { 'f0rtika.achilles_correlated': true } },
            { terms: { source_type: ['alert', 'xdr_detection'] } },
            { exists: { field: 'f0rtika.achilles_test_uuid' } },
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  { bool: { filter: [{ term: { source_type: 'alert' } }], must_not: [{ terms: { status: [...ALERT_CLOSED_STATUSES] } }] } },
                  { bool: { filter: [{ term: { source_type: 'xdr_detection' } }, { terms: { status: [...XDR_OPEN_STATUSES] } }] } },
                ],
              },
            },
          ],
          must_not: [
            { exists: { field: 'f0rtika.achilles_agent_kill_task_id' } },
            ...receiptForMode,
          ],
        },
      },
      sort: [{ 'f0rtika.achilles_matched_at': { order: 'asc', unmapped_type: 'date' } }],
    } as never);
    const hits = ((response as { hits?: { hits?: Array<{ _id: string; _index: string; _source?: Record<string, unknown> }> } }).hits?.hits ?? []);
    return hits.map((h) => {
      const src = h._source ?? {};
      const f0 = (src.f0rtika ?? {}) as Record<string, unknown>;
      const hosts = Array.isArray(src.evidence_hostnames) ? src.evidence_hostnames : [];
      return {
        sophosId: typeof src.alert_id === 'string' ? src.alert_id : '',
        sourceType: src.source_type === 'xdr_detection' ? 'xdr_detection' : src.source_type === 'alert' ? 'alert' : 'other',
        docId: h._id,
        docIndex: h._index,
        testUuid: typeof f0.achilles_test_uuid === 'string' ? f0.achilles_test_uuid : '',
        host: typeof hosts[0] === 'string' && hosts[0] ? hosts[0] : 'unknown host',
      } as Candidate;
    });
  }

  /** Re-read the candidate from Sophos. Throws on API errors (caller decides halt vs skip). */
  private async liveState(c: Candidate): Promise<Live> {
    if (c.sourceType === 'alert') {
      const alert = await this.client.getAlert(c.sophosId);
      if (alert === null) return { kind: 'gone' };
      const actions = (alert as { allowedActions?: unknown }).allowedActions;
      if (Array.isArray(actions) && actions.includes(ACKNOWLEDGE)) return { kind: 'open' };
      return { kind: 'closed', status: '' };
    }
    const data = await this.client.graphql<{ detectionRetrieveById?: { alerts?: { list?: Array<{ id?: string; status?: string }> | null } | null } | null }>(
      DETECTION_STATUS_QUERY,
      { in: { iDs: [c.sophosId] } },
    );
    const list = data?.detectionRetrieveById?.alerts?.list;
    if (!Array.isArray(list)) return { kind: 'unknown' };
    const found = list.find((d) => d?.id === c.sophosId);
    if (!found) return { kind: 'gone' };
    if (found.status === XDR_LIVE_OPEN) return { kind: 'open' };
    return { kind: 'closed', status: typeof found.status === 'string' ? found.status.toLowerCase() : '' };
  }

  private async mirrorStatus(c: Candidate, status: string): Promise<void> {
    try {
      await this.es.update({ index: c.docIndex, id: c.docId, doc: { status }, retry_on_conflict: 3 } as never);
    } catch {
      // Non-fatal: the next pass re-checks Sophos anyway.
    }
  }

  private async writeReceipt(c: Candidate, mode: AutoResolveMode, error?: string, status?: string): Promise<void> {
    const now = new Date().toISOString();
    const f0rtika: Record<string, unknown> = mode === 'dry_run'
      ? { auto_resolve_dry_run_at: now, auto_resolve_mode: 'dry_run' }
      : { auto_resolved: true, auto_resolved_at: now, auto_resolve_mode: mode };
    if (error) f0rtika.auto_resolve_error = error;
    const doc: Record<string, unknown> = { f0rtika, ...(status ? { status } : {}) };
    try {
      await this.es.update({ index: c.docIndex, id: c.docId, doc, retry_on_conflict: 3 } as never);
    } catch {
      // Non-fatal: next pass retries.
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function isAuthError(err: unknown): boolean {
  if (err instanceof SophosPermissionError) return true;
  return err instanceof SophosApiError && (err.statusCode === 401 || err.statusCode === 403);
}
function authMessage(err: unknown): string {
  const code = err instanceof SophosApiError ? err.statusCode : 403;
  return `${code}: ${errMsg(err)} — the API credential needs the Service Principal Management role to acknowledge alerts and resolve detections`;
}
