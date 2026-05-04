// Auto-resolve pillar for the Defender integration.
//
// Reads alerts tagged by the enrichment pass (f0rtika.achilles_correlated:true)
// and PATCHes them to status=resolved with a securityTesting determination,
// so Achilles continuous-validation activity doesn't flood the SOC queue.
//
// This service is the WRITE counterpart to the READ-only correlation done by
// DefenderEnrichmentService. It intentionally never writes to test docs —
// Defense Score reads those, and this feature must not affect scoring.
// (See the plan's Mental Model section for why that invariant matters.)
//
// Operational modes (persisted in integration settings, mutable at runtime):
//   - disabled  → no ES or Graph calls, zero result
//   - dry_run   → compute candidates, log [Defender-AutoResolve-DryRun],
//                 write receipts with mode='dry_run'; NO Graph PATCH
//   - enabled   → PATCH via MicrosoftGraphClient.updateAlert, write receipts
//                 with mode='enabled' on success

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

    // Disabled mode: complete no-op. No ES calls, no Graph calls.
    // This is the customer's default until they opt in.
    if (mode === 'disabled') {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    try {
      const candidates = await this.findCandidates(maxPerPass);
      result.candidates = candidates.length;

      for (const candidate of candidates) {
        // Duration cap — stops the pass cleanly between candidates so the
        // next sync cycle isn't blocked on a slow Graph tenant.
        if (Date.now() - startedAt > maxDurationMs) break;

        // Defensive: a correlation write may have landed without the test_uuid
        // field on older docs. Skip rather than emit a malformed PATCH/receipt.
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
            // Permission missing — the entire pass is blocked until consent
            // is granted. Halt cleanly so we don't spam 403s across candidates.
            result.errors.push(`403: ${patchError.message}`);
            break;
          }

          if (patchError instanceof GraphPatchError && patchError.statusCode === 404) {
            // Alert deleted upstream — write a receipt (with error recorded)
            // so we don't rescan this candidate on every future pass.
            await this.writeReceipt(candidate, 'enabled', 'not_found');
            result.errors.push(`${candidate.alertId}: not_found`);
            continue;
          }

          // Transient or unknown error — record and move on. NO receipt,
          // so the next pass re-attempts the PATCH.
          const msg = patchError instanceof Error ? patchError.message : String(patchError);
          result.errors.push(`${candidate.alertId}: ${msg}`);
          continue;
        }

        // dry_run: log and write a receipt (with mode='dry_run') so we
        // don't re-log the same candidate on every 5-min cycle.
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

  // ---------------------------------------------------------------------------
  // Candidate selection
  // ---------------------------------------------------------------------------

  private async findCandidates(size: number): Promise<Candidate[]> {
    // Whitelist on status='new': we only auto-resolve alerts Defender has not
    // yet acted on. Specifically excluded:
    //   - 'resolved'   — someone (human or Defender's auto-investigation) has
    //                    already closed the alert; leave it alone, even if the
    //                    classification doesn't match what we'd have used.
    //   - 'inProgress' — a human operator is actively triaging. PATCHing the
    //                    alert under them would be a UX surprise; respect their
    //                    acknowledgment.
    //   - 'unknown' / future statuses — fail closed. If Defender ever adds a
    //                    new status value, default to NOT auto-resolving until
    //                    the policy is intentionally updated.
    // The original implementation only excluded 'resolved' via must_not, which
    // would have PATCHed inProgress alerts and any future state values.
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
      // Oldest first so long-standing candidates resolve before fresh ones.
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

  // ---------------------------------------------------------------------------
  // Graph PATCH (with error capture rather than throw)
  // ---------------------------------------------------------------------------

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

  /** Returns the error on failure, or null on success. Never throws. */
  private async patchAlert(alertId: string, patch: GraphAlertPatch): Promise<unknown | null> {
    try {
      await this.graphClient.updateAlert(alertId, patch);
      return null;
    } catch (err) {
      return err;
    }
  }

  // ---------------------------------------------------------------------------
  // Receipt writes (ES update on the alert doc)
  // ---------------------------------------------------------------------------

  /**
   * Mark the alert doc so the next pass skips it. In dry-run this prevents
   * perpetual re-logging; in enabled mode it's the audit trail for the PATCH.
   * Errors here are non-fatal — ES update retry_on_conflict handles races.
   */
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
      // Non-fatal: if the receipt write fails, the next pass will re-PATCH.
      // Defender's PATCH is idempotent for a resolved→resolved transition.
    }
  }
}
