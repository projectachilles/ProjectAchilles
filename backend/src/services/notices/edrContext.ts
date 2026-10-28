// The "EDR context" block of the pre-execution notice: which EDR integrations
// will see the run and whether auto-resolve will close their alerts. Reads
// settings only (must not load tasks.service.ts: import cycle).
import type { IntegrationsSettingsService } from '../integrations/settings.js';
import { configuredVendorKeys, VENDOR_SETTINGS } from '../edr/vendor-settings.js';
import { edrVendor } from '../outcomes/vendors.js';
import type { NoticeEmailData } from './render.js';

export function noticeEdrContext(svc: IntegrationsSettingsService): NoticeEmailData['edr'] {
  return configuredVendorKeys(svc).map((k) => ({
    vendor: edrVendor(k).label,
    autoResolve: VENDOR_SETTINGS[k].autoResolveMode(svc),
  }));
}
