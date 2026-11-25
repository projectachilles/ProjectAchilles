// Defender enrichment: the shared EDR evidence-correlation pass
// (edr/alert-enrichment.service.ts) over achilles-defender, writing
// f0rtika.defender_* flags. Defender keeps its own evidence queries: their
// time window handles Defender's alert aggregation and re-fires
// (defender/evidence-correlation.ts, docs/edr-alert-refire-watermark.md).
// Prevention comes from evidence[].remediationStatus at sync time; see
// docs/defender-prevention-action-detection.md.

import type { Client } from '@elastic/elasticsearch';
import { EdrAlertEnrichmentService } from '../edr/alert-enrichment.service.js';
import {
  buildDefenderEvidenceQuery, buildStageDefenderEvidenceQuery, defenderAlertTimeQuery, defenderPathNamesTest,
} from './evidence-correlation.js';
import { DEFENDER_INDEX } from './index-management.js';

export class DefenderEnrichmentService extends EdrAlertEnrichmentService {
  /**
   * `runScopedEvidence`: credit a result only from its own run's evidence
   * items (EnrichmentVendorTarget.runScopedEvidence). The sync passes
   * `evidenceItemsReady()`; off, the pass runs exactly as before.
   */
  constructor(client: Client, resultsIndexPattern: string, options: { runScopedEvidence?: boolean } = {}) {
    super(client, resultsIndexPattern, {
      alertIndex: DEFENDER_INDEX,
      flagPrefix: 'defender',
      evidenceQueries: {
        wide: buildDefenderEvidenceQuery,
        stage: buildStageDefenderEvidenceQuery,
        pathNamesTest: defenderPathNamesTest,
        // Crediting by run, alerts are also found by their activity span.
        alertTime: defenderAlertTimeQuery,
      },
      runScopedEvidence: options.runScopedEvidence === true,
    });
  }
}
