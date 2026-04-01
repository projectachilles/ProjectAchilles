// Elasticsearch index management for risk acceptance records.
// Separate index "achilles-risk-acceptances" — immutable audit trail.

import { SettingsService } from '../analytics/settings.js';
import { createEsClient } from '../analytics/client.js';

export const RISK_ACCEPTANCE_INDEX = 'achilles-risk-acceptances';

export const RISK_ACCEPTANCE_MAPPING = {
  mappings: {
    properties: {
      acceptance_id: { type: 'keyword' as const },
      test_name: { type: 'keyword' as const },
      control_id: { type: 'keyword' as const },
      hostname: { type: 'keyword' as const },
      scope: { type: 'keyword' as const },
      justification: { type: 'text' as const },
      accepted_by: { type: 'keyword' as const },
      accepted_by_name: { type: 'keyword' as const },
      accepted_at: { type: 'date' as const },
      status: { type: 'keyword' as const },
      revoked_at: { type: 'date' as const },
      revoked_by: { type: 'keyword' as const },
      revoked_by_name: { type: 'keyword' as const },
      revocation_reason: { type: 'text' as const },
    },
  },
};

/** Create the risk acceptance index if it doesn't exist. */
export async function createRiskAcceptanceIndex(): Promise<{ created: boolean; message: string }> {
  const settingsService = new SettingsService();
  const settings = settingsService.getSettings();

  if (!settings.configured) {
    throw new Error('Elasticsearch is not configured');
  }

  const client = createEsClient(settings);

  try {
    await client.indices.create({
      index: RISK_ACCEPTANCE_INDEX,
      ...RISK_ACCEPTANCE_MAPPING,
    });
    return { created: true, message: `Index "${RISK_ACCEPTANCE_INDEX}" created successfully` };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 400) {
      return { created: false, message: `Index "${RISK_ACCEPTANCE_INDEX}" already exists` };
    }
    throw err;
  }
}

/** Ensure the risk acceptance index exists (create if missing, no-op if exists). */
export async function ensureRiskAcceptanceIndex(): Promise<void> {
  await createRiskAcceptanceIndex();
}
