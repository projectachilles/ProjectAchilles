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
});
