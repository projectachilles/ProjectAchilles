import { describe, it, expect } from 'vitest';
import { formatServiceSource } from '../defenderServiceSource';

describe('formatServiceSource', () => {
  it('maps known Microsoft tokens to readable labels', () => {
    expect(formatServiceSource('microsoftDefenderForEndpoint')).toBe('Defender for Endpoint');
    expect(formatServiceSource('microsoftDefenderForIdentity')).toBe('Defender for Identity');
    expect(formatServiceSource('microsoftDefenderForOffice365')).toBe('Defender for Office 365');
    expect(formatServiceSource('microsoftSentinel')).toBe('Sentinel');
    expect(formatServiceSource('azureAdIdentityProtection')).toBe('Entra ID Protection');
  });

  it('renders the Graph "unknownFutureValue" sentinel as "Other"', () => {
    // This is the case the user reported — Entra/Sentinel alerts surface with
    // this sentinel value and were previously rendering it verbatim.
    expect(formatServiceSource('unknownFutureValue')).toBe('Other');
  });

  it('renders the related "unknown" enum value as "Other"', () => {
    expect(formatServiceSource('unknown')).toBe('Other');
  });

  it('returns null for empty / null / undefined so the caller can omit the meta line', () => {
    expect(formatServiceSource('')).toBeNull();
    expect(formatServiceSource(null)).toBeNull();
    expect(formatServiceSource(undefined)).toBeNull();
  });

  it('passes through unrecognized tokens verbatim so new Microsoft enum values stay visible', () => {
    // If Microsoft ships a new enum value before we update KNOWN_SOURCES, we
    // surface the raw token rather than silently dropping it — better to look
    // ugly than to lie.
    expect(formatServiceSource('microsoftDefenderForAtariST')).toBe('microsoftDefenderForAtariST');
  });
});
