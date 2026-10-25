// SentinelOne analytics: the shared endpoint-EDR alert analytics
// (edr/alert-analytics.service.ts) pointed at achilles-sentinelone. Its alert
// docs share the normalized shape (severity, status, mitre_techniques,
// evidence_*, prevention_action, f0rtika.achilles_correlated), and the SentinelOne enrichment pass writes
// f0rtika.sentinelone_* flags on result docs with the same rules, so every
// alert/correlation/coverage query applies unchanged.
//
// SentinelOne has no posture score like CrowdStrike's ZTA, so the score
// comparison carries only the Defense Score (ztaScore: null).

import { EdrAlertAnalyticsService } from '../edr/alert-analytics.service.js';
import { SENTINELONE_INDEX } from './index-management.js';

export class SentinelOneAnalyticsService extends EdrAlertAnalyticsService {
  /** Our own automatic mitigation is detection, never SentinelOne prevention. */
  protected override readonly ignoreAchillesMitigated = true;

  constructor() {
    super(SENTINELONE_INDEX, 'sentinelone');
  }
}
