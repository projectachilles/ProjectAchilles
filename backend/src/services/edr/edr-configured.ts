// Which EDR integrations are configured, and their alert indices. Settings
// only: services/notices/ reads this, and must not load tasks.service.ts
// (import cycle), so keep agent/ and the reconciler out of this module.
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { DEFENDER_INDEX } from '../defender/index-management.js';
import { CROWDSTRIKE_INDEX } from '../crowdstrike/index-management.js';
import { SENTINELONE_INDEX } from '../sentinelone/index-management.js';
import type { EdrVendorKey } from './agent-kill-evidence.js';

export interface VendorIndex { vendor: EdrVendorKey; index: string }

export const VENDOR_INDICES: ReadonlyArray<VendorIndex> = [
  { vendor: 'defender', index: DEFENDER_INDEX },
  { vendor: 'crowdstrike', index: CROWDSTRIKE_INDEX },
  { vendor: 'sentinelone', index: SENTINELONE_INDEX },
];

/** Alert indices of the EDR integrations configured right now. */
export function configuredVendorIndices(): VendorIndex[] {
  const s = new IntegrationsSettingsService();
  const on: Record<EdrVendorKey, boolean> = {
    defender: s.isDefenderConfigured(),
    crowdstrike: s.isCrowdStrikeConfigured(),
    sentinelone: s.isSentinelOneConfigured(),
  };
  return VENDOR_INDICES.filter((v) => on[v.vendor]);
}

/** True when any EDR integration (Defender, CrowdStrike, SentinelOne) is configured. */
export function isAnyEdrConfigured(): boolean {
  return configuredVendorIndices().length > 0;
}
