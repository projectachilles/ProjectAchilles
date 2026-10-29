// Sophos analytics: the shared endpoint-EDR alert analytics
// (edr/alert-analytics.service.ts) pointed at achilles-sophos. Alert docs share
// the normalized shape and the Sophos enrichment pass writes f0rtika.sophos_*
// flags with the same rules, so every alert/correlation/coverage query applies
// unchanged.
//
// The posture series beside the Defense Score (getScoreComparison, field
// ztaScore) is the Achilles average of Sophos Health Check scores: the last
// health_check headline per UTC day (live snapshots and imported history).

import { EdrAlertAnalyticsService } from '../edr/alert-analytics.service.js';
import { SOPHOS_INDEX } from './index-management.js';
import { dailyLastHeadline } from './health-score.js';

export class SophosAnalyticsService extends EdrAlertAnalyticsService {
  constructor() {
    super(SOPHOS_INDEX, 'sophos');
  }

  protected override async getPostureScoreTrend(days: number): Promise<Array<{ date: string; score: number }>> {
    const res = await this.getEsClient().search({
      index: SOPHOS_INDEX,
      size: 10_000,
      query: { bool: { filter: [{ term: { doc_type: 'health_check' } }, { range: { timestamp: { gte: `now-${days}d` } } }] } },
      sort: [{ timestamp: 'asc' }],
      _source: ['timestamp', 'health.headline'],
    }).catch(() => null);
    return dailyLastHeadline((res?.hits.hits ?? []) as Array<{ _source?: { timestamp?: string; health?: { headline?: number | null } } }>);
  }
}
