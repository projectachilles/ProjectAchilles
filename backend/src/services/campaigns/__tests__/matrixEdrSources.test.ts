import { describe, it, expect } from 'vitest';
import type { IntegrationsSettingsService } from '../../integrations/settings.js';
import { matrixEdrSources } from '../matrix.js';

describe('campaign matrix EDR sources', () => {
  it('names every configured EDR exactly as before the registry', () => {
    const svc = {
      isDefenderConfigured: () => true,
      isCrowdStrikeConfigured: () => true,
      isSentinelOneConfigured: () => true,
    } as unknown as IntegrationsSettingsService;
    expect(matrixEdrSources(svc)).toEqual(['Microsoft Defender', 'CrowdStrike Falcon', 'SentinelOne']);
  });
});
