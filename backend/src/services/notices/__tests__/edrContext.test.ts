import { describe, it, expect } from 'vitest';
import type { IntegrationsSettingsService } from '../../integrations/settings.js';
import { noticeEdrContext } from '../edrContext.js';

function stub(on: { defender: boolean; crowdstrike: boolean; sentinelone: boolean; sophos: boolean }) {
  return {
    isDefenderConfigured: () => on.defender,
    isCrowdStrikeConfigured: () => on.crowdstrike,
    isSentinelOneConfigured: () => on.sentinelone,
    isSophosConfigured: () => on.sophos,
    getAutoResolveMode: () => 'enabled',
    getCrowdStrikeAutoResolveMode: () => 'dry_run',
    getSentinelOneAutoResolveMode: () => 'disabled',
    getSophosAutoResolveMode: () => 'dry_run',
  } as unknown as IntegrationsSettingsService;
}

describe('notice EDR context', () => {
  it('lists every configured EDR, SentinelOne and Sophos included, with its auto-resolve mode', () => {
    expect(noticeEdrContext(stub({ defender: true, crowdstrike: true, sentinelone: true, sophos: true }))).toEqual([
      { vendor: 'Microsoft Defender', autoResolve: 'enabled' },
      { vendor: 'CrowdStrike Falcon', autoResolve: 'dry_run' },
      { vendor: 'SentinelOne Singularity', autoResolve: 'disabled' },
      { vendor: 'Sophos Intercept X', autoResolve: 'dry_run' },
    ]);
  });

  it('is empty when no EDR is configured', () => {
    expect(noticeEdrContext(stub({ defender: false, crowdstrike: false, sentinelone: false, sophos: false }))).toEqual([]);
  });
});
