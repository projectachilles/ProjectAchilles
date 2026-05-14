/**
 * Map Microsoft Graph alerts_v2 `serviceSource` enum values to human-readable
 * labels for display in the UI.
 *
 * Microsoft uses "evolvable enums" — when an alert's source doesn't match a
 * named enum value, the API returns the literal string "unknownFutureValue"
 * (a sentinel meaning "this is a real source but we don't have a specific
 * label for it yet"). Some Entra ID / Sentinel alerts forwarded through the
 * unified Defender pipeline also surface as "unknownFutureValue" because the
 * field isn't populated.
 *
 * We map known tokens to friendly labels and fall back to "Other" for the
 * sentinel values. Empty / null inputs return null so callers can choose
 * whether to omit the meta line entirely.
 *
 * Reference: https://learn.microsoft.com/en-us/graph/api/resources/security-alert
 */

const KNOWN_SOURCES: Record<string, string> = {
  microsoftDefenderForEndpoint: 'Defender for Endpoint',
  microsoftDefenderForIdentity: 'Defender for Identity',
  microsoftDefenderForCloudApps: 'Defender for Cloud Apps',
  microsoftDefenderForOffice365: 'Defender for Office 365',
  microsoft365Defender: 'Microsoft 365 Defender',
  azureAdIdentityProtection: 'Entra ID Protection',
  microsoftAppGovernance: 'App Governance',
  dataLossPrevention: 'Purview DLP',
  microsoftPurviewDataLossPrevention: 'Purview DLP',
  microsoftDefenderForCloud: 'Defender for Cloud',
  microsoftSentinel: 'Sentinel',
  microsoftInsiderRiskManagement: 'Insider Risk Mgmt',
  microsoftDefenderForIoT: 'Defender for IoT',
};

const UNKNOWN_TOKENS = new Set(['unknownFutureValue', 'unknown']);

/**
 * Returns a display-friendly label for a Microsoft Graph service source.
 *
 * - Known tokens → readable label (e.g., "Defender for Endpoint")
 * - `unknownFutureValue` / `unknown` → "Other"
 * - empty / null / undefined → null (caller decides whether to render anything)
 * - anything else → the raw value (so a new Microsoft enum value still renders
 *   something rather than silently disappearing)
 */
export function formatServiceSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (KNOWN_SOURCES[raw]) return KNOWN_SOURCES[raw];
  if (UNKNOWN_TOKENS.has(raw)) return 'Other';
  return raw;
}
