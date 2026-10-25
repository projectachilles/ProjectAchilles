// SentinelOne analytics — the CrowdStrike analytics queries pointed at
// achilles-sentinelone. Both indexes share the normalized alert doc shape
// (severity, status, mitre_techniques, evidence_*, prevention_action,
// f0rtika.achilles_correlated), and the SentinelOne enrichment pass writes
// f0rtika.sentinelone_* flags on result docs with the same rules, so every
// alert/correlation/coverage query applies unchanged.
//
// SentinelOne has no Zero Trust Assessment equivalent: the ZTA methods return
// empty data instead of inventing a posture metric.

import { CrowdStrikeAnalyticsService } from '../crowdstrike/analytics.service.js';
import type { ZtaScoreSummary, ZtaScoreTrendPoint } from '../crowdstrike/analytics.service.js';
import { SENTINELONE_INDEX } from './index-management.js';

export class SentinelOneAnalyticsService extends CrowdStrikeAnalyticsService {
  /** Our own automatic mitigation is detection, never SentinelOne prevention. */
  protected override readonly ignoreAchillesMitigated = true;

  constructor() {
    super(SENTINELONE_INDEX, 'sentinelone');
  }

  /** No ZTA-style device posture score in SentinelOne. */
  override async getZtaScoreSummary(): Promise<ZtaScoreSummary> {
    return { overallScore: 0, osScore: 0, sensorConfigScore: 0, deviceCount: 0, minScore: 0, maxScore: 0, timestamp: null };
  }

  /** No posture score history: the score comparison carries only the Defense Score. */
  override async getZtaScoreTrend(_days: number): Promise<ZtaScoreTrendPoint[]> {
    return [];
  }
}
