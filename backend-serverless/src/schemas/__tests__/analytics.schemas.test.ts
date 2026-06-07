import { describe, it, expect } from 'vitest';
import { AnalyticsSettingsSchema } from '../analytics.schemas.js';

describe('serverless AnalyticsSettingsSchema write-index fields', () => {
  it('accepts a valid prefix + daily', () => {
    expect(AnalyticsSettingsSchema.safeParse({ connectionType: 'cloud', writeIndexPrefix: 'achilles-results-', writeIndexRollover: 'daily' }).success).toBe(true);
  });
  it('rejects an invalid rollover', () => {
    expect(AnalyticsSettingsSchema.safeParse({ connectionType: 'cloud', writeIndexRollover: 'hourly' }).success).toBe(false);
  });
  it('rejects an empty prefix', () => {
    expect(AnalyticsSettingsSchema.safeParse({ connectionType: 'cloud', writeIndexPrefix: '' }).success).toBe(false);
  });
  it('rejects a wildcard prefix', () => {
    expect(AnalyticsSettingsSchema.safeParse({ connectionType: 'cloud', writeIndexPrefix: 'achilles-*' }).success).toBe(false);
  });
});
