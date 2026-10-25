// SentinelOne analytics: the shared endpoint-EDR alert analytics
// (edr/alert-analytics.service.ts) pointed at achilles-sentinelone. Its alert
// docs share the normalized shape (severity, status, mitre_techniques,
// evidence_*, prevention_action, f0rtika.achilles_correlated), and the SentinelOne enrichment pass writes
// f0rtika.sentinelone_* flags on result docs with the same rules, so every
// alert/correlation/coverage query applies unchanged.
//
// SentinelOne has no posture score like CrowdStrike's ZTA; the score
// comparison's posture series (ztaScore) is the Achilles Endpoint Protection
// score from the posture pass (protection-score.ts).

import { EdrAlertAnalyticsService } from '../edr/alert-analytics.service.js';
import { SENTINELONE_INDEX, SENTINELONE_POSTURE_INDEX } from './index-management.js';

export class SentinelOneAnalyticsService extends EdrAlertAnalyticsService {
  /** Our own automatic mitigation is detection, never SentinelOne prevention. */
  protected override readonly ignoreAchillesMitigated = true;

  constructor() {
    super(SENTINELONE_INDEX, 'sentinelone');
  }

  /** The Endpoint Protection score beside the Defense Score (getScoreComparison). */
  protected override async getPostureScoreTrend(days: number): Promise<Array<{ date: string; score: number }>> {
    const res = await this.getEsClient().search({
      index: SENTINELONE_POSTURE_INDEX,
      size: 10_000,
      query: { bool: { filter: [{ term: { doc_type: 'protection_score' } }, { range: { timestamp: { gte: `now-${days}d` } } }] } },
      sort: [{ timestamp: 'asc' }],
      _source: ['timestamp', 'protection.score'],
    }).catch(() => null);
    const hits = (res?.hits.hits ?? []) as Array<{ _source?: { timestamp?: string; protection?: { score?: number | null } } }>;
    return hits.flatMap((h) => {
      const score = h._source?.protection?.score;
      return h._source?.timestamp && typeof score === 'number' ? [{ date: h._source.timestamp, score }] : [];
    });
  }
}
