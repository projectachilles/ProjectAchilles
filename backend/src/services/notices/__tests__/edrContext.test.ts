import { describe, it, expect } from 'vitest';
import type { IntegrationsSettingsService } from '../../integrations/settings.js';
import { noticeEdrContext } from '../edrContext.js';

function stub(on: { defender: boolean; crowdstrike: boolean; sentinelone: boolean }) {
  return {
    isDefenderConfigured: () => on.defender,
    isCrowdStrikeConfigured: () => on.crowdstrike,
    isSentinelOneConfigured: () => on.sentinelone,
    getAutoResolveMode: () => 'enabled',
    getCrowdStrikeAutoResolveMode: () => 'dry_run',
    getSentinelOneAutoResolveMode: () => 'disabled',
  } as unknown as IntegrationsSettingsService;
}

describe('notice EDR context', () => {
  it('lists every configured EDR, SentinelOne included, with its auto-resolve mode', () => {
    expect(noticeEdrContext(stub({ defender: true, crowdstrike: true, sentinelone: true }))).toEqual([
      { vendor: 'Microsoft Defender', autoResolve: 'enabled' },
      { vendor: 'CrowdStrike Falcon', autoResolve: 'dry_run' },
      { vendor: 'SentinelOne Singularity', autoResolve: 'disabled' },
    ]);
  });

  it('is empty when no EDR is configured', () => {
    expect(noticeEdrContext(stub({ defender: false, crowdstrike: false, sentinelone: false }))).toEqual([]);
  });
});
