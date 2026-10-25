// Auto-resolve for the SentinelOne integration — the Defender pattern
// (services/defender/auto-resolve.service.ts) applied to S1.
//
// Reads alert docs the enrichment pass matched to an Achilles test
// (f0rtika.achilles_correlated:true) and closes them in the console so
// continuous-validation activity doesn't flood the SOC queue:
//   - threats:          POST /threats/incident  { incidentStatus: 'resolved' }
//                       + POST /threats/notes   (best-effort audit note)
//   - detection alerts: POST /cloud-detection/alerts/incident { incidentStatus: 'resolved' }
//                       (no note: no verified notes endpoint for detection alerts)
//
// Deliberately NOT done:
//   - no analyst verdict is written (Achilles tests are real techniques, not
//     false positives — analysts' verdicts stay theirs);
//   - no mitigation of any kind (that is auto-mitigation.service.ts, opt-in);
//   - nothing outside the configured scope, nothing not matched to a test,
//     nothing a human already moved off 'unresolved'. The local status can
//     be stale (detection alerts are only re-synced by createdAt), so every
//     candidate's status is re-read from the console right before acting;
//     anything that can't be confirmed as still 'unresolved' is skipped.
//
// Modes: disabled (default, no-op) | dry_run (log + receipts, no API call) |
// enabled (API call + receipts; requires Response mode — checked here and by
// the client, which refuses every write in read-only mode).

import type { Client } from '@elastic/elasticsearch';
import { SentinelOneClient, SentinelOneApiError, SentinelOnePermissionError } from './s1-client.js';
import { SENTINELONE_INDEX } from './index-management.js';
import { scopeFilters } from './scope-filter.js';
import { normalizeToken } from './normalize.js';
import type { AutoResolveMode, AutoResolvePassResult } from '../../types/defender.js';
import type { SentinelOneScope, SentinelOneSource } from '../../types/sentinelone.js';

const DEFAULT_MAX_PER_PASS = 30;
const DEFAULT_MAX_DURATION_MS = 30_000;

/** Incident statuses auto-resolve may act on. Anything else (in_progress, resolved, future values) is left alone. */
const ELIGIBLE_STATUS = 'unresolved';
/** S1 object ids are numeric strings (the client refuses anything else). */
const S1_ID_RE = /^\d{1,24}$/;

interface Candidate {
  s1Id: string;
  sourceType: SentinelOneSource;
  alertDocId: string;
  alertDocIndex: string;
  testUuid: string;
}

export interface S1AutoResolveOptions {
  modeOverride?: AutoResolveMode;
  maxPerPass?: number;
  maxDurationMs?: number;
}

/** Minimal client surface (lets tests pass a mock). */
export type S1IncidentClient = Pick<SentinelOneClient, 'permissionMode' | 'updateThreatIncidentStatus' | 'addThreatNote' | 'updateAlertIncidentStatus' | 'listThreats' | 'listCloudDetectionAlerts'>;

export class SentinelOneAutoResolveService {
  constructor(
    private readonly esClient: Client,
    private readonly s1Client: S1IncidentClient,
    private readonly mode: AutoResolveMode,
    private readonly scope: SentinelOneScope | undefined,
  ) {}

  async runAutoResolvePass(options: S1AutoResolveOptions = {}): Promise<AutoResolvePassResult> {
    const startedAt = Date.now();
    const mode = options.modeOverride ?? this.mode;
    const result: AutoResolvePassResult = { mode, candidates: 0, patched: 0, wouldPatch: 0, skipped: 0, errors: [], durationMs: 0 };

    if (mode === 'disabled') {
      result.durationMs = Date.now() - startedAt;
      return result;
    }
    if (mode === 'enabled' && this.s1Client.permissionMode !== 'response') {
      result.errors.push('auto-resolve is enabled but the integration is read-only — nothing was written (switch to Response mode or use dry_run)');
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    try {
      const candidates = await this.findCandidates(options.maxPerPass ?? DEFAULT_MAX_PER_PASS, mode);
      result.candidates = candidates.length;
      const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      const live = await this.liveStatuses(candidates, result.errors);

      for (const c of candidates) {
        if (Date.now() - startedAt > maxDurationMs) break;
        if (!c.s1Id || !c.testUuid) { result.skipped += 1; continue; }
        if (!S1_ID_RE.test(c.s1Id)) {
          // Would fail the same way on every pass: shelve it.
          result.skipped += 1;
          await this.writeReceipt(c, mode, 'invalid_id');
          continue;
        }

        // Fail closed: act only on what the console still reports as unresolved.
        const current = live.statuses.get(`${c.sourceType}:${c.s1Id}`);
        if (current !== ELIGIBLE_STATUS) {
          result.skipped += 1;
          if (current) await this.mirrorStatus(c, current);
          // Gone from the console (purged, deleted, out of scope): shelve it so
          // it can't hold a slot of this oldest-first queue forever.
          else if (live.checked.has(c.sourceType)) await this.writeReceipt(c, mode, 'not_found');
          continue;
        }

        if (mode === 'dry_run') {
          console.log(`[SentinelOne-AutoResolve-DryRun] would_resolve ${c.sourceType} id=${c.s1Id} test_uuid=${c.testUuid}`);
          result.wouldPatch += 1;
          await this.writeReceipt(c, 'dry_run');
          continue;
        }

        try {
          const { affected } = c.sourceType === 'threats'
            ? await this.s1Client.updateThreatIncidentStatus([c.s1Id], 'resolved')
            : await this.s1Client.updateAlertIncidentStatus([c.s1Id], 'resolved');
          if (affected < 1) {
            // HTTP 200 but nothing changed (e.g. the id is outside the token's
            // scope): not resolved. Shelve it rather than claim success.
            await this.writeReceipt(c, 'enabled', 'not_applied');
            result.errors.push(`${c.s1Id}: not_applied`);
            continue;
          }
          if (c.sourceType === 'threats') await this.addNoteBestEffort(c);
          result.patched += 1;
          await this.writeReceipt(c, 'enabled', undefined, true);
        } catch (err) {
          const status = err instanceof SentinelOneApiError ? err.statusCode : err instanceof SentinelOnePermissionError ? 403 : 0;
          if (status === 401 || status === 403) {
            // Token lacks the role, or writes are refused — halt the pass.
            result.errors.push(`${status}: ${err instanceof Error ? err.message : String(err)}`);
            break;
          }
          if (status === 404) {
            await this.writeReceipt(c, 'enabled', 'not_found');
            result.errors.push(`${c.s1Id}: not_found`);
            continue;
          }
          // Transient / unknown: no receipt, retried next pass.
          result.errors.push(`${c.s1Id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      result.errors.push(`pass: ${err instanceof Error ? err.message : String(err)}`);
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  static noteText(testUuid: string): string {
    return `Achilles test ${testUuid} — authorized continuous validation. Incident resolved automatically by Project Achilles (no verdict or mitigation changed).`;
  }

  private async addNoteBestEffort(c: Candidate): Promise<void> {
    try {
      await this.s1Client.addThreatNote([c.s1Id], SentinelOneAutoResolveService.noteText(c.testUuid));
    } catch (err) {
      console.warn(`[SentinelOne-AutoResolve] note failed for threat ${c.s1Id}: ${err instanceof Error ? err.message : String(err)}`);
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
            { term: { 'f0rtika.achilles_correlated': true } },
            { term: { status: ELIGIBLE_STATUS } },
            { exists: { field: 'f0rtika.achilles_test_uuid' } },
            ...scopeFilters(this.scope),
          ],
          // Same-mode receipt = already handled; a dry-run receipt doesn't block a later real run.
          must_not: [{ bool: { filter: [{ term: { 'f0rtika.auto_resolved': true } }, { term: { 'f0rtika.auto_resolve_mode': mode } }] } }],
        },
      },
      sort: [{ 'f0rtika.achilles_matched_at': { order: 'asc', unmapped_type: 'date' } }],
    } as any);
    const hits = ((response as any).hits?.hits ?? []) as any[];
    return hits.map((h) => {
      const src = h._source ?? {};
      return {
        s1Id: typeof src.alert_id === 'string' ? src.alert_id : '',
        sourceType: src.source_type === 'cloud_detection_alerts' ? 'cloud_detection_alerts' : 'threats',
        alertDocId: h._id,
        alertDocIndex: h._index,
        testUuid: typeof src.f0rtika?.achilles_test_uuid === 'string' ? src.f0rtika.achilles_test_uuid : '',
      } as Candidate;
    });
  }

  /**
   * Current incident status of each candidate, read from the console (one
   * GET per source type). `statuses` is keyed `<sourceType>:<id>`; `checked`
   * holds the source types whose lookup succeeded, so an id missing from a
   * checked source is known to be gone, while a failed lookup concludes
   * nothing. Either way the candidate is not resolved.
   */
  private async liveStatuses(candidates: Candidate[], errors: string[]): Promise<{ statuses: Map<string, string>; checked: Set<SentinelOneSource> }> {
    const out = new Map<string, string>();
    const checked = new Set<SentinelOneSource>();
    // Malformed ids are shelved by the caller; keep them out so one can't fail the whole lookup.
    const valid = candidates.filter((c) => S1_ID_RE.test(c.s1Id));
    const threatIds = valid.filter((c) => c.sourceType === 'threats').map((c) => c.s1Id);
    const alertIds = valid.filter((c) => c.sourceType === 'cloud_detection_alerts').map((c) => c.s1Id);
    if (threatIds.length > 0) {
      try {
        const res = await this.s1Client.listThreats({ ids: threatIds, limit: threatIds.length, skipCount: 'true' });
        for (const t of res.data) if (t.id) out.set(`threats:${t.id}`, normalizeToken(t.threatInfo?.incidentStatus));
        checked.add('threats');
      } catch (err) {
        errors.push(`live status (threats): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (alertIds.length > 0) {
      try {
        const res = await this.s1Client.listCloudDetectionAlerts({ ids: alertIds, limit: alertIds.length, skipCount: 'true' });
        for (const a of res.data) {
          const id = a.alertInfo?.alertId;
          if (id) out.set(`cloud_detection_alerts:${id}`, normalizeToken(a.alertInfo?.incidentStatus));
        }
        checked.add('cloud_detection_alerts');
      } catch (err) {
        errors.push(`live status (alerts): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { statuses: out, checked };
  }

  /** Bring a stale local status up to date so the doc stops being a candidate. */
  private async mirrorStatus(c: Candidate, status: string): Promise<void> {
    try {
      await this.esClient.update({ index: c.alertDocIndex, id: c.alertDocId, doc: { status }, retry_on_conflict: 3 } as any);
    } catch {
      // Non-fatal: the next pass re-checks the console anyway.
    }
  }

  private async writeReceipt(c: Candidate, mode: AutoResolveMode, error?: string, resolved = false): Promise<void> {
    const now = new Date().toISOString();
    const doc: Record<string, unknown> = {
      f0rtika: {
        auto_resolved: true,
        auto_resolved_at: now,
        auto_resolve_mode: mode,
        ...(error ? { auto_resolve_error: error } : {}),
      },
      // Mirror the console change locally (detection alerts are re-synced by
      // createdAt, so their status would otherwise stay stale).
      ...(resolved ? { status: 'resolved', resolved_at: now } : {}),
    };
    try {
      await this.esClient.update({ index: c.alertDocIndex, id: c.alertDocId, doc, retry_on_conflict: 3 } as any);
    } catch {
      // Non-fatal: next pass retries (setting resolved twice is idempotent).
    }
  }
}
