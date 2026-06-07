import { describe, it, expect } from 'vitest';
import { AnalyticsSettingsSchema } from '../analytics.schemas.js';

describe('AnalyticsSettingsSchema write-index fields', () => {
  it('accepts writeIndexPrefix and a valid rollover', () => {
    const r = AnalyticsSettingsSchema.safeParse({
      connectionType: 'cloud', cloudId: 'x', apiKey: 'y',
      writeIndexPrefix: 'achilles-results-', writeIndexRollover: 'daily',
    });
    expect(r.success).toBe(true);
  });
  it('rejects an invalid rollover value', () => {
    const r = AnalyticsSettingsSchema.safeParse({
      connectionType: 'cloud', writeIndexRollover: 'hourly',
    });
    expect(r.success).toBe(false);
  });

  // writeIndexPrefix hardening tests
  it('rejects writeIndexPrefix that is empty string', () => {
    const r = AnalyticsSettingsSchema.safeParse({
      connectionType: 'cloud',
      writeIndexPrefix: '',
    });
    expect(r.success).toBe(false);
  });
  it('rejects writeIndexPrefix containing a wildcard character', () => {
    const r = AnalyticsSettingsSchema.safeParse({
      connectionType: 'cloud',
      writeIndexPrefix: 'achilles-*',
    });
    expect(r.success).toBe(false);
  });
  it('accepts writeIndexPrefix with trailing dash (default prefix)', () => {
    const r = AnalyticsSettingsSchema.safeParse({
      connectionType: 'cloud',
      writeIndexPrefix: 'achilles-results-',
    });
    expect(r.success).toBe(true);
  });
});
