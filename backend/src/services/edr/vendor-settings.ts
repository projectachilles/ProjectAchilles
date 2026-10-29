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
  /**
   * May this vendor's prevention alert turn an exit-260 launch block into a
   * Protected result (edr/launch-block-reconcile.service.ts)? Required, so a
   * new vendor has to decide. Only when its alert proves the EDR itself blocked
   * the orchestrator: a vendor whose alerts can't be told apart from a
   * prevalence/app-control block (what 260 was built for) must say false.
   */
  launchBlockEvidence: boolean;
}

export const VENDOR_SETTINGS: Record<EdrVendorKey, VendorSettingsAdapter> = {
  defender: {
    isConfigured: (s) => s.isDefenderConfigured(),
    autoResolveMode: (s) => s.getAutoResolveMode(),
    // 260 exists for Defender ASR rule 01443614 (a prevalence gate, never
    // counted as protection), and telling an ASR block from an AV block on a
    // Defender alert needs fields we haven't verified on live data.
    launchBlockEvidence: false,
  },
  crowdstrike: {
    isConfigured: (s) => s.isCrowdStrikeConfigured(),
    autoResolveMode: (s) => s.getCrowdStrikeAutoResolveMode(),
    launchBlockEvidence: true,
  },
  sentinelone: {
    isConfigured: (s) => s.isSentinelOneConfigured(),
    autoResolveMode: (s) => s.getSentinelOneAutoResolveMode(),
    launchBlockEvidence: true,
  },
  sophos: {
    isConfigured: (s) => s.isSophosConfigured(),
    autoResolveMode: (s) => s.getSophosAutoResolveMode(),
    launchBlockEvidence: true,
  },
};

/** EDR integrations configured right now, in registry order. Deployment-wide settings. */
export function configuredVendorKeys(s: IntegrationsSettingsService = new IntegrationsSettingsService()): EdrVendorKey[] {
  return EDR_VENDOR_KEYS.filter((k) => VENDOR_SETTINGS[k].isConfigured(s));
}
