import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';

let edrConfigured = { defender: false, crowdstrike: false, sentinelone: false, sophos: false };
vi.mock('../../integrations/settings.js', () => ({
  IntegrationsSettingsService: class {
    isDefenderConfigured = () => edrConfigured.defender;
    isCrowdStrikeConfigured = () => edrConfigured.crowdstrike;
    isSentinelOneConfigured = () => edrConfigured.sentinelone;
    isSophosConfigured = () => edrConfigured.sophos;
    getSophosAutoResolveMode = () => 'disabled';
  },
}));

const { isAnyEdrConfigured, configuredVendorIndices } = await import('../edr-configured.js');

describe('isAnyEdrConfigured', () => {
  it('is true when any one EDR is configured', () => {
    edrConfigured = { defender: false, crowdstrike: false, sentinelone: false, sophos: false };
    expect(isAnyEdrConfigured()).toBe(false);
    edrConfigured = { defender: false, crowdstrike: true, sentinelone: false, sophos: false };
    expect(isAnyEdrConfigured()).toBe(true);
    expect(configuredVendorIndices()).toEqual([{ vendor: 'crowdstrike', index: 'achilles-crowdstrike' }]);
    edrConfigured = { defender: false, crowdstrike: false, sentinelone: false, sophos: true };
    expect(configuredVendorIndices()).toEqual([{ vendor: 'sophos', index: 'achilles-sophos' }]);
  });
});

describe('import boundaries', () => {
  // services/notices/ must not load tasks.service.ts (import cycle).
  it('keeps the settings-only module and notices off the reconciler and tasks.service', () => {
    const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    const own = read('../edr-configured.ts');
    expect(own).not.toMatch(/from '\.\.\/agent\//);
    expect(own).not.toContain('agent-kill-reconcile');
    const notices = read('../../notices/notices.service.ts');
    expect(notices).not.toMatch(/from '[^']*agent-kill-reconcile\.service/);
    expect(notices).not.toMatch(/from '[^']*tasks\.service/);
  });
});
