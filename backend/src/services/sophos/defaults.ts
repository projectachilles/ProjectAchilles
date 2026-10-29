// Defaults for the Sophos Central integration settings.
// The settings themselves live in IntegrationsSettingsService
// (services/integrations/settings.ts), next to Defender, CrowdStrike and SentinelOne.

import type { AutoResolveMode } from '../../types/sophos.js';

export const SOPHOS_DEFAULT_POLL_INTERVAL_MINUTES = 5;
export const SOPHOS_DEFAULT_DETECTION_BACKFILL_DAYS = 30;
export const SOPHOS_MAX_DETECTION_BACKFILL_DAYS = 90;
/** The Alerts API retains 90 days. */
export const SOPHOS_ALERT_BACKFILL_DAYS = 90;

export const SOPHOS_AUTO_RESOLVE_MODES: ReadonlyArray<AutoResolveMode> = ['disabled', 'dry_run', 'enabled'] as const;
/** Nothing is written to Sophos Central until the user opts in. */
export const SOPHOS_DEFAULT_AUTO_RESOLVE_MODE: AutoResolveMode = 'disabled';
