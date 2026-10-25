// Automatic mitigation for SentinelOne — OFF by default, explicit opt-in.
//
// Narrow by design. A threat is a candidate only when ALL of these hold:
//   - it is a threat (source_type 'threats'); detection alerts have no
//     mitigation endpoint and are never touched;
//   - the enrichment pass matched it to an Achilles test
//     (f0rtika.achilles_correlated + achilles_test_uuid) — so the binary is
//     the Achilles test artefact, not something found in the wild;
//   - S1 left it unmitigated (mitigation_status 'not_mitigated', no
//     prevention_action recorded) and its incident is still 'unresolved';
//   - it is inside the configured account / site / group scope;
//   - it has not been processed by this pass before (receipt).
// The only actions are 'kill' and 'quarantine' (configured). Remediate,
// rollback and network isolation stay manual-only.
//
// The ES copy is only as fresh as the last poll, so each candidate is
// re-read from the console right before acting: it must still be
// unresolved and unmitigated. Anything that can't be confirmed is skipped.
//
// Guards (server-side): the settings layer refuses any non-disabled mode
// unless permission_mode is 'response' and reads as disabled otherwise; this
// pass re-checks the permission mode, and the client refuses writes in
// read-only mode. Every real call goes through SentinelOneResponseService, so
// it is also written to the response-action audit trail.

import type { Client } from '@elastic/elasticsearch';
import { SENTINELONE_INDEX } from './index-management.js';
import { scopeFilters } from './scope-filter.js';
import { normalizeToken, hasStopAttempt } from './normalize.js';
import type { SentinelOneClient } from './s1-client.js';
import type { ResponseActionOutcome } from './response.service.js';
import type {
  AutoMitigationPassResult,
  AutoResolveMode,
  SentinelOneAutoMitigationAction,
  SentinelOnePermissionMode,
  SentinelOneResponseAction,
  SentinelOneScope,
} from '../../types/sentinelone.js';

const DEFAULT_MAX_PER_PASS = 10;
const DEFAULT_MAX_DURATION_MS = 30_000;
export const AUTO_MITIGATION_ACTOR = 'achilles-auto-mitigation';

interface Candidate {
  threatId: string;
  docId: string;
  docIndex: string;
  testUuid: string;
}

/** Reads the live threat state (the S1 client). */
export type ThreatReader = Pick<SentinelOneClient, 'listThreats'>;

/** The one method of SentinelOneResponseService this pass needs. */
export interface ResponseExecutor {
  execute(action: SentinelOneResponseAction, actor: { userId: string; orgId?: string }): Promise<ResponseActionOutcome>;
}

export class SentinelOneAutoMitigationService {
  constructor(
    private readonly esClient: Client,
    private readonly executor: ResponseExecutor,
    private readonly config: {
      mode: AutoResolveMode;
      action: SentinelOneAutoMitigationAction;
      permissionMode: SentinelOnePermissionMode;
      scope?: SentinelOneScope;
    },
    private readonly reader: ThreatReader,
  ) {}

  async runAutoMitigationPass(options: { maxPerPass?: number; maxDurationMs?: number } = {}): Promise<AutoMitigationPassResult> {
    const startedAt = Date.now();
    const { action } = this.config;
    // Fail closed: outside Response mode the pass is a no-op whatever is stored.
    const mode: AutoResolveMode = this.config.permissionMode === 'response' ? this.config.mode : 'disabled';
    const result: AutoMitigationPassResult = { mode, action, candidates: 0, mitigated: 0, wouldMitigate: 0, skipped: 0, errors: [], durationMs: 0 };

    if (mode === 'disabled' || (action !== 'kill' && action !== 'quarantine')) {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    try {
      const candidates = await this.findCandidates(options.maxPerPass ?? DEFAULT_MAX_PER_PASS, mode);
      result.candidates = candidates.length;
      const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const live = await this.liveState(candidates, result.errors);

      for (const c of candidates) {
        if (Date.now() - startedAt > maxDurationMs) break;
        if (!c.threatId || !c.testUuid) { result.skipped += 1; continue; }
        // Fail closed: only act on what the console still reports as open and unmitigated.
        if (!live.open.has(c.threatId)) {
          result.skipped += 1;
          // Gone from the console (purged, deleted, out of scope): shelve it so
          // it can't hold a slot of this oldest-first queue forever.
          if (live.ok && !live.returned.has(c.threatId)) await this.writeReceipt(c, mode, 'not_found');
          continue;
        }

        if (mode === 'dry_run') {
          console.log(`[SentinelOne-AutoMitigation-DryRun] would_${action} threat id=${c.threatId} test_uuid=${c.testUuid}`);
          result.wouldMitigate += 1;
          await this.writeReceipt(c, 'dry_run');
          continue;
        }

        // The receipt is what keeps our own kill from counting as SentinelOne
        // prevention (enrichment + analytics read it), so it is written
        // BEFORE the action, and no receipt means no action.
        if (!(await this.writeReceipt(c, 'enabled'))) {
          result.skipped += 1;
          result.errors.push(`${c.threatId}: receipt write failed, not mitigated`);
          continue;
        }
        const outcome = await this.executor.execute(
          { kind: 'threat_mitigation', action, threatIds: [c.threatId] },
          { userId: AUTO_MITIGATION_ACTOR },
        );
        if (outcome.success) {
          result.mitigated += 1;
          continue;
        }
        if (outcome.statusCode === 401 || outcome.statusCode === 403) {
          await this.clearReceipt(c); // retried once the role is fixed
          result.errors.push(`${outcome.statusCode}: ${outcome.error ?? 'forbidden'}`);
          break;
        }
        if (outcome.statusCode === 404) {
          await this.writeReceipt(c, 'enabled', 'not_found');
          result.errors.push(`${c.threatId}: not_found`);
          continue;
        }
        await this.clearReceipt(c); // transient: retried next pass
        result.errors.push(`${c.threatId}: ${outcome.error ?? `HTTP ${outcome.statusCode}`}`);
      }
    } catch (err) {
      result.errors.push(`pass: ${err instanceof Error ? err.message : String(err)}`);
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  /**
   * Live console state of the candidates (one GET): which ids came back at
   * all, and which are still unresolved with no mitigation attempt.
   * `ok: false` when the lookup failed, so nothing is concluded from absence.
   */
  private async liveState(candidates: Candidate[], errors: string[]): Promise<{ ok: boolean; returned: Set<string>; open: Set<string> }> {
    const returned = new Set<string>();
    const open = new Set<string>();
    const ids = candidates.map((c) => c.threatId).filter((id) => /^\d{1,24}$/.test(id));
    if (ids.length === 0) return { ok: true, returned, open };
    try {
      const res = await this.reader.listThreats({ ids, limit: ids.length, skipCount: 'true' });
      for (const t of res.data) {
        if (!t.id) continue;
        returned.add(t.id);
        const stillOpen = normalizeToken(t.threatInfo?.incidentStatus) === 'unresolved'
          && t.threatInfo?.mitigationStatus === 'not_mitigated'
          && !hasStopAttempt(t);
        if (stillOpen) open.add(t.id);
      }
      return { ok: true, returned, open };
    } catch (err) {
      errors.push(`live status: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, returned, open };
    }
  }

  /** Remove a pre-written receipt so the candidate is retried (best effort). */
  private async clearReceipt(c: Candidate): Promise<void> {
    try {
      await this.esClient.update({
        index: c.docIndex,
        id: c.docId,
        doc: { f0rtika: { auto_mitigated: false, auto_mitigation_mode: null, auto_mitigated_at: null } },
        retry_on_conflict: 3,
      } as any);
    } catch {
      // The candidate then stays shelved: fails closed (no further kill).
    }
  }

  private async findCandidates(size: number, mode: AutoResolveMode): Promise<Candidate[]> {
    const response = await this.esClient.search({
      index: SENTINELONE_INDEX,
      size,
      query: {
        bool: {
          filter: [
            { term: { doc_type: 'alert' } },
            { term: { source_type: 'threats' } },
            { term: { 'f0rtika.achilles_correlated': true } },
            { exists: { field: 'f0rtika.achilles_test_uuid' } },
            { term: { status: 'unresolved' } },
            { term: { mitigation_status: 'not_mitigated' } },
            ...scopeFilters(this.config.scope),
          ],
          must_not: [
            { exists: { field: 'prevention_action' } },
            // A receipt from the same mode means "already handled"; a dry-run
            // receipt does not block a later real run.
            { bool: { filter: [{ term: { 'f0rtika.auto_mitigated': true } }, { term: { 'f0rtika.auto_mitigation_mode': mode } }] } },
          ],
        },
      },
      sort: [{ 'f0rtika.achilles_matched_at': { order: 'asc', unmapped_type: 'date' } }],
    } as any);
    const hits = ((response as any).hits?.hits ?? []) as any[];
    return hits.map((h) => {
      const src = h._source ?? {};
      return {
        threatId: typeof src.alert_id === 'string' ? src.alert_id : '',
        docId: h._id,
        docIndex: h._index,
        testUuid: typeof src.f0rtika?.achilles_test_uuid === 'string' ? src.f0rtika.achilles_test_uuid : '',
      };
    });
  }

  /** Write (or overwrite) the receipt; resolves false when the write failed. */
  private async writeReceipt(c: Candidate, mode: AutoResolveMode, error?: string): Promise<boolean> {
    try {
      await this.esClient.update({
        index: c.docIndex,
        id: c.docId,
        doc: {
          f0rtika: {
            auto_mitigated: true,
            auto_mitigated_at: new Date().toISOString(),
            auto_mitigation_mode: mode,
            auto_mitigation_action: this.config.action,
            ...(error ? { auto_mitigation_error: error } : {}),
          },
        },
        retry_on_conflict: 3,
      } as any);
      return true;
    } catch {
      return false;
    }
  }
}
