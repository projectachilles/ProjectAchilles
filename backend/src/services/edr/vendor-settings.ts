// Per-vendor settings reads, keyed by the EDR registry so a new vendor that
// isn't wired here fails to compile. Settings only: services/notices/ reads
// this and must not load tasks.service.ts (import cycle).
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { EDR_VENDOR_KEYS } from '../outcomes/vendors.js';
import type { EdrVendorKey } from '../outcomes/vendors.js';
import type { AutoResolveMode } from '../../types/defender.js';

export interface VendorSettingsAdapter {
  isConfigured(s: IntegrationsSettingsService): boolean;
  autoResolveMode(s: IntegrationsSettingsService): AutoResolveMode;
}

export const VENDOR_SETTINGS: Record<EdrVendorKey, VendorSettingsAdapter> = {
  defender: {
    isConfigured: (s) => s.isDefenderConfigured(),
    autoResolveMode: (s) => s.getAutoResolveMode(),
  },
  crowdstrike: {
    isConfigured: (s) => s.isCrowdStrikeConfigured(),
    autoResolveMode: (s) => s.getCrowdStrikeAutoResolveMode(),
  },
  sentinelone: {
    isConfigured: (s) => s.isSentinelOneConfigured(),
    autoResolveMode: (s) => s.getSentinelOneAutoResolveMode(),
  },
  sophos: {
    isConfigured: (s) => s.isSophosConfigured(),
    autoResolveMode: (s) => s.getSophosAutoResolveMode(),
  },
};

/** EDR integrations configured right now, in registry order. Deployment-wide settings. */
export function configuredVendorKeys(s: IntegrationsSettingsService = new IntegrationsSettingsService()): EdrVendorKey[] {
  return EDR_VENDOR_KEYS.filter((k) => VENDOR_SETTINGS[k].isConfigured(s));
}
