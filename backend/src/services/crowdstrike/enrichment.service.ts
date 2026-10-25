// CrowdStrike enrichment: the shared endpoint-EDR evidence-correlation pass
// (edr/alert-enrichment.service.ts) over achilles-crowdstrike, writing
// f0rtika.crowdstrike_* flags.

import type { Client } from '@elastic/elasticsearch';
import { EdrAlertEnrichmentService } from '../edr/alert-enrichment.service.js';
import { CROWDSTRIKE_INDEX } from './index-management.js';

export type { EnrichmentVendorTarget } from '../edr/alert-enrichment.service.js';

export class CrowdStrikeEnrichmentService extends EdrAlertEnrichmentService {
  constructor(client: Client, resultsIndexPattern: string) {
    super(client, resultsIndexPattern, { alertIndex: CROWDSTRIKE_INDEX, flagPrefix: 'crowdstrike' });
  }
}
