import { describe, it, expect } from 'vitest';
import type { IntegrationsSettingsService } from '../../integrations/settings.js';
import { VENDOR_SETTINGS, configuredVendorKeys } from '../vendor-settings.js';

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

describe('vendor settings adapter', () => {
  it('returns configured vendors in registry order', () => {
    expect(configuredVendorKeys(stub({ defender: false, crowdstrike: true, sentinelone: true })))
      .toEqual(['crowdstrike', 'sentinelone']);
    expect(configuredVendorKeys(stub({ defender: true, crowdstrike: false, sentinelone: true })))
      .toEqual(['defender', 'sentinelone']);
    expect(configuredVendorKeys(stub({ defender: false, crowdstrike: false, sentinelone: false }))).toEqual([]);
  });

  it("reads each vendor's own auto-resolve mode", () => {
    const s = stub({ defender: true, crowdstrike: true, sentinelone: true });
    expect(VENDOR_SETTINGS.defender.autoResolveMode(s)).toBe('enabled');
    expect(VENDOR_SETTINGS.crowdstrike.autoResolveMode(s)).toBe('dry_run');
    expect(VENDOR_SETTINGS.sentinelone.autoResolveMode(s)).toBe('disabled');
  });
});
