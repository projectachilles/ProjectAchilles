/**
 * Fleet results for one test, for the test detail page: the any-stage
 * headline (same rule as `test-results` and the Defense Score tile) and the
 * per-stage split (same rule as `technique-outcomes`). Every number comes
 * from ElasticsearchService.getLatestPairs, so the posture pair rules
 * (latest run per host, freshness, exclusions) are never re-implemented here.
 */
import type { ElasticsearchService } from './elasticsearch.js';
import type { PairRun } from './posture.js';
import type { AnalyticsQueryParams, ExtendedAnalyticsQueryParams } from '../../types/analytics.js';

export interface TestFleetStage {
  controlId: string;
  validator?: string;
  description?: string;
  blocked: number;
  detected: number;
  through: number;
  hosts: number;
  lastRunAt: string;
}

export interface TestFleetResponse {
  headline: { hostCount: number; stoppedCount: number; lastRunAt: string | null };
  stages: TestFleetStage[];
  /** Hosts whose latest run stopped before any stage ran (EDR killed the agent / blocked it at launch). */
  stoppedBeforeStage: number;
}

/** Control id of a per-stage pair (`oid|<bundle>::<control>|host`); undefined for a standalone test's pair. */
function controlIdOf(pairKey: string): string | undefined {
  return (pairKey.split('|')[1] ?? '').split('::')[1];
}

/**
 * The usual filter-bar params apply, but the window and basis are fixed like
 * getTestResults: a caller's from/to/basis/scoringMode are overridden.
 */
export async function getTestFleet(
  es: ElasticsearchService,
  testUuid: string,
  params: AnalyticsQueryParams & Partial<ExtendedAnalyticsQueryParams>,
): Promise<TestFleetResponse> {
  const scope = { ...params, from: 'now-90d', to: 'now', basis: 'latest' as const, testUuid };
  const [chains, realRuns, stagePairs, labels] = await Promise.all([
    es.getLatestPairs({ ...scope, scoringMode: 'any-stage' }),
    es.getLatestPairs({ ...scope, scoringMode: 'any-stage', excludeEdrTerminated: true }),
    es.getLatestPairs({ ...scope, scoringMode: 'all-stages', excludeEdrTerminated: true }),
    es.getControlLabels(testUuid, params.org),
  ]);

  // Headline: any-stage, combined protected rule (stageless runs count as stopped).
  const hosts = new Set<string>();
  let lastTs = Number.NEGATIVE_INFINITY;
  for (const p of chains) {
    hosts.add(p.hostname);
    if (p.ts > lastTs) lastTs = p.ts;
  }

  // A pair whose latest run is newer than its latest run with stages had a stageless latest run.
  const realTs = new Map(realRuns.map((p) => [p.pairKey, p.ts]));
  const stoppedHosts = new Set<string>();
  for (const p of chains) {
    const ts = realTs.get(p.pairKey);
    if (ts === undefined || p.ts > ts) stoppedHosts.add(p.hostname);
  }

  return {
    headline: {
      hostCount: hosts.size,
      stoppedCount: chains.filter((p) => p.protected).length,
      lastRunAt: chains.length > 0 ? new Date(lastTs).toISOString() : null,
    },
    stages: groupStages(stagePairs, labels),
    stoppedBeforeStage: stoppedHosts.size,
  };
}

/** Per-stage split, technique-outcomes rule: blocked = strict, detected = combined only, through = neither. */
function groupStages(
  pairs: PairRun[],
  labels: Record<string, { validator?: string; description?: string }>,
): TestFleetStage[] {
  const byControl = new Map<string, { blocked: number; detected: number; through: number; hosts: Set<string>; lastTs: number }>();
  for (const p of pairs) {
    const controlId = controlIdOf(p.pairKey);
    if (!controlId) continue;
    let s = byControl.get(controlId);
    if (!s) {
      s = { blocked: 0, detected: 0, through: 0, hosts: new Set(), lastTs: Number.NEGATIVE_INFINITY };
      byControl.set(controlId, s);
    }
    if (p.strictProtected) s.blocked++;
    else if (p.protected) s.detected++;
    else s.through++;
    s.hosts.add(p.hostname);
    if (p.ts > s.lastTs) s.lastTs = p.ts;
  }
  return [...byControl]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([controlId, s]) => {
      const label = labels[controlId];
      return {
        controlId,
        ...(label?.validator ? { validator: label.validator } : {}),
        ...(label?.description ? { description: label.description } : {}),
        blocked: s.blocked,
        detected: s.detected,
        through: s.through,
        hosts: s.hosts.size,
        lastRunAt: new Date(s.lastTs).toISOString(),
      };
    });
}
