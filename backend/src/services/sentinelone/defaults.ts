// Defaults and validation helpers for the SentinelOne integration settings.
// The settings themselves live in IntegrationsSettingsService
// (services/integrations/settings.ts), next to Defender and CrowdStrike.

import type {
  SentinelOneSource,
  SentinelOneAutoMitigationAction,
  SentinelOneAutoMitigationSettings,
  AutoResolveMode,
} from '../../types/sentinelone.js';

export const S1_DEFAULT_POLL_INTERVAL_MINUTES = 5;
export const S1_DEFAULT_BACKFILL_DAYS = 365; // console alert retention is 1 year
export const S1_MAX_BACKFILL_DAYS = 365;
export const S1_DEFAULT_SOURCES: SentinelOneSource[] = ['threats', 'cloud_detection_alerts'];

export const S1_AUTO_RESOLVE_MODES: ReadonlyArray<AutoResolveMode> = ['disabled', 'dry_run', 'enabled'] as const;
/** Same default as Defender: nothing is written to the console until the user opts in. */
export const S1_DEFAULT_AUTO_RESOLVE_MODE: AutoResolveMode = 'disabled';
export const S1_AUTO_MITIGATION_ACTIONS: ReadonlyArray<SentinelOneAutoMitigationAction> = ['kill', 'quarantine'] as const;
export const S1_DEFAULT_AUTO_MITIGATION: SentinelOneAutoMitigationSettings = { mode: 'disabled', action: 'kill' };

/** Normalize a stored auto-mitigation block; unknown values fail closed to the default. */
export function normalizeAutoMitigation(v: unknown): SentinelOneAutoMitigationSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<SentinelOneAutoMitigationSettings>;
  return {
    mode: S1_AUTO_RESOLVE_MODES.includes(o.mode as AutoResolveMode) ? (o.mode as AutoResolveMode) : 'disabled',
    action: S1_AUTO_MITIGATION_ACTIONS.includes(o.action as SentinelOneAutoMitigationAction)
      ? (o.action as SentinelOneAutoMitigationAction)
      : S1_DEFAULT_AUTO_MITIGATION.action,
  };
}
