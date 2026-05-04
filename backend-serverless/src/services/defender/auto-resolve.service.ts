// Auto-resolve pillar for the Defender integration — serverless mirror.
//
// Identical semantics to backend/ but adapted for the serverless settings
// service's async API. See backend/ for the full design rationale.

import type { Client } from '@elastic/elasticsearch';
import type { MicrosoftGraphClient } from './graph-client.js';
import { GraphPatchError } from './graph-client.js';
import { DEFENDER_INDEX } from './index-management.js';
import type {
  AutoResolveMode,
  AutoResolvePassOptions,
  AutoResolvePassResult,
  GraphAlertPatch,
} from '../../types/defender.js';

const DEFAULT_MAX_PER_PASS = 30;
const DEFAULT_MAX_DURATION_MS = 30_000;

interface Candidate {
  alertId: string;
  alertDocId: string;
  alertDocIndex: string;
  testUuid: string;
}

export class DefenderAutoResolveService {
  constructor(
    private readonly esClient: Client,
    private readonly graphClient: MicrosoftGraphClient,
    private readonly mode: AutoResolveMode,
  ) {}

  async runAutoResolvePass(
    options: AutoResolvePassOptions = {},
  ): Promise<AutoResolvePassResult> {
    const startedAt = Date.now();
    const mode = options.modeOverride ?? this.mode;
    const maxPerPass = options.maxPerPass ?? DEFAULT_MAX_PER_PASS;
    const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

    const result: AutoResolvePassResult = {
      mode,
      candidates: 0,
      patched: 0,
      wouldPatch: 0,
      skipped: 0,
      errors: [],
      durationMs: 0,
    };

    if (mode === 'disabled') {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    try {
      const candidates = await this.findCandidates(maxPerPass);
      result.candidates = candidates.length;

      for (const candidate of candidates) {
        if (Date.now() - startedAt > maxDurationMs) break;

        if (!candidate.alertId || !candidate.testUuid) {
          result.skipped += 1;
          continue;
        }

        const patch = this.buildPatch(candidate.testUuid);

        if (mode === 'enabled') {
          const patchError = await this.patchAlert(candidate.alertId, patch);

          if (!patchError) {
            result.patched += 1;
            await this.writeReceipt(candidate, 'enabled');
            continue;
          }

          if (patchError instanceof GraphPatchError && patchError.statusCode === 403) {
            result.errors.push(`403: ${patchError.message}`);
            break;
          }

          if (patchError instanceof GraphPatchError && patchError.statusCode === 404) {
            await this.writeReceipt(candidate, 'enabled', 'not_found');
            result.errors.push(`${candidate.alertId}: not_found`);
            continue;
          }

          const msg = patchError instanceof Error ? patchError.message : String(patchError);
          result.errors.push(`${candidate.alertId}: ${msg}`);
          continue;
        }

        // dry_run
        console.log(
          `[Defender-AutoResolve-DryRun] would_patch alert_id=${candidate.alertId} test_uuid=${candidate.testUuid}`,
        );
        result.wouldPatch += 1;
        await this.writeReceipt(candidate, 'dry_run');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`pass: ${msg}`);
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  }

  private async findCandidates(size: number): Promise<Candidate[]> {
    // Whitelist on status='new': only auto-resolve alerts Defender has not yet
    // acted on. Excludes 'resolved' (already closed), 'inProgress' (human is
    // actively triaging — respect their acknowledgment), and 'unknown' / any
    // future status (fail closed). Mirror of backend/.
    const response = await this.esClient.search({
      index: DEFENDER_INDEX,
      size,
      query: {
        bool: {
          filter: [
            { term: { doc_type: 'alert' } },
            { term: { 'f0rtika.achilles_correlated': true } },
            { term: { status: 'new' } },
          ],
          must_not: [
            { term: { 'f0rtika.auto_resolved': true } },
          ],
        },
      },
      sort: [{ 'f0rtika.achilles_matched_at': 'asc' }],
    } as any);

    const hits = ((response as any).hits?.hits ?? []) as any[];
    return hits
      .map((h): Candidate | null => {
        const src = h._source ?? {};
        const f0rtika = src.f0rtika ?? {};
        const alertId = typeof src.alert_id === 'string' ? src.alert_id : '';
        const testUuid = typeof f0rtika.achilles_test_uuid === 'string' ? f0rtika.achilles_test_uuid : '';
        if (!alertId) return null;
        return {
          alertId,
          alertDocId: h._id,
          alertDocIndex: h._index,
          testUuid,
        };
      })
      .filter((c): c is Candidate => c !== null);
  }

  private buildPatch(testUuid: string): GraphAlertPatch {
    return {
      status: 'resolved',
      classification: 'informationalExpectedActivity',
      determination: 'securityTesting',
      comments: [
        {
          comment: `Achilles test ${testUuid} — authorized continuous validation. Resolved automatically by Project Achilles.`,
        },
      ],
    };
  }

  private async patchAlert(alertId: string, patch: GraphAlertPatch): Promise<unknown | null> {
    try {
      await this.graphClient.updateAlert(alertId, patch);
      return null;
    } catch (err) {
      return err;
    }
  }

  private async writeReceipt(
    candidate: Candidate,
    mode: AutoResolveMode,
    error?: string,
  ): Promise<void> {
    const doc: Record<string, unknown> = {
      f0rtika: {
        auto_resolved: true,
        auto_resolved_at: new Date().toISOString(),
        auto_resolve_mode: mode,
        ...(error ? { auto_resolve_error: error } : {}),
      },
    };
    try {
      await this.esClient.update({
        index: candidate.alertDocIndex,
        id: candidate.alertDocId,
        doc,
        retry_on_conflict: 3,
      } as any);
    } catch {
      // Non-fatal.
    }
  }
}
