// Sophos enrichment: the shared endpoint-EDR evidence-correlation pass
// (edr/alert-enrichment.service.ts) over achilles-sophos, writing
// f0rtika.sophos_* flags. No automatic mitigation exists for Sophos, so no
// Achilles-mitigated exclusion applies.

import type { Client } from '@elastic/elasticsearch';
import { EdrAlertEnrichmentService } from '../edr/alert-enrichment.service.js';
import { SOPHOS_INDEX } from './index-management.js';

export class SophosEnrichmentService extends EdrAlertEnrichmentService {
  constructor(client: Client, resultsIndexPattern: string) {
    super(client, resultsIndexPattern, { alertIndex: SOPHOS_INDEX, flagPrefix: 'sophos' });
  }
}
