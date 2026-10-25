// SentinelOne enrichment: the shared endpoint-EDR evidence-correlation pass
// (edr/alert-enrichment.service.ts) over achilles-sentinelone, writing
// f0rtika.sentinelone_* flags. Alerts carrying an Achilles automatic
// mitigation receipt never count as SentinelOne prevention.

import type { Client } from '@elastic/elasticsearch';
import { EdrAlertEnrichmentService } from '../edr/alert-enrichment.service.js';
import { SENTINELONE_INDEX } from './index-management.js';

export class SentinelOneEnrichmentService extends EdrAlertEnrichmentService {
  constructor(client: Client, resultsIndexPattern: string) {
    super(client, resultsIndexPattern, { alertIndex: SENTINELONE_INDEX, flagPrefix: 'sentinelone', ignoreAchillesMitigated: true });
  }
}
