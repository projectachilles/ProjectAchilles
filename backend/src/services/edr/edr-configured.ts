// Which EDR integrations are configured, and their alert indices. Settings
// only: services/notices/ reads this, and must not load tasks.service.ts
// (import cycle), so keep agent/ and the reconciler out of this module.
import { IntegrationsSettingsService } from '../integrations/settings.js';
import { DEFENDER_INDEX } from '../defender/index-management.js';
import { CROWDSTRIKE_INDEX } from '../crowdstrike/index-management.js';
import { SENTINELONE_INDEX } from '../sentinelone/index-management.js';
import { SOPHOS_INDEX } from '../sophos/index-management.js';
import { EDR_VENDOR_KEYS } from '../outcomes/vendors.js';
import type { EdrVendorKey } from '../outcomes/vendors.js';
import { configuredVendorKeys } from './vendor-settings.js';

export interface VendorIndex { vendor: EdrVendorKey; index: string }

const INDEX_BY_VENDOR: Record<EdrVendorKey, string> = {
  defender: DEFENDER_INDEX,
  crowdstrike: CROWDSTRIKE_INDEX,
  sentinelone: SENTINELONE_INDEX,
  sophos: SOPHOS_INDEX,
};

export const VENDOR_INDICES: ReadonlyArray<VendorIndex> = EDR_VENDOR_KEYS.map((vendor) => ({
  vendor,
  index: INDEX_BY_VENDOR[vendor],
}));

/** Alert indices of the EDR integrations configured right now. */
export function configuredVendorIndices(): VendorIndex[] {
  const on = new Set(configuredVendorKeys(new IntegrationsSettingsService()));
  return VENDOR_INDICES.filter((v) => on.has(v.vendor));
}

/** True when any EDR integration in the registry is configured. */
export function isAnyEdrConfigured(): boolean {
  return configuredVendorIndices().length > 0;
}
