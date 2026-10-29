// Sophos enrichment: the shared endpoint-EDR evidence-correlation pass
// (edr/alert-enrichment.service.ts) over achilles-sophos, writing
// f0rtika.sophos_* flags. No automatic mitigation exists for Sophos, so no
// Achilles-mitigated exclusion applies.
//
// Sophos is the one vendor that re-checks recent detected-but-unprevented
// docs: the Common Alert and the SIEM event that carries the remedy (the
// prevention) often arrive in different polls, so a stage can be flagged
// detected before merge.ts folds the prevention into its alert.

import type { Client } from '@elastic/elasticsearch';
import { EdrAlertEnrichmentService } from '../edr/alert-enrichment.service.js';
import { SOPHOS_INDEX } from './index-management.js';

/** Sophos serves a SIEM event for 24 h, so a late prevention (its remedy) normally lands within that. */
export const SOPHOS_RECHECK_UNPREVENTED_HOURS = 24;

export class SophosEnrichmentService extends EdrAlertEnrichmentService {
  constructor(client: Client, resultsIndexPattern: string) {
    super(client, resultsIndexPattern, {
      alertIndex: SOPHOS_INDEX,
      flagPrefix: 'sophos',
      recheckUnpreventedHours: SOPHOS_RECHECK_UNPREVENTED_HOURS,
    });
  }
}
