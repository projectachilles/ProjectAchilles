import { describe, it, expect } from 'vitest';
import { normalizeDashboardRange, DEFAULT_DASHBOARD_RANGE } from '../useDashboardData';

describe('normalizeDashboardRange', () => {
  it('accepts valid presets', () => {
    expect(normalizeDashboardRange('7d')).toBe('7d');
    expect(normalizeDashboardRange('30d')).toBe('30d');
    expect(normalizeDashboardRange('90d')).toBe('90d');
  });

  it('falls back to the default for missing or invalid values', () => {
    expect(normalizeDashboardRange(null)).toBe(DEFAULT_DASHBOARD_RANGE);
    expect(normalizeDashboardRange('')).toBe(DEFAULT_DASHBOARD_RANGE);
    expect(normalizeDashboardRange('365d')).toBe(DEFAULT_DASHBOARD_RANGE);
    expect(normalizeDashboardRange('all')).toBe(DEFAULT_DASHBOARD_RANGE);
  });

  it('defaults to 90d (the range that actually shows data on sparse tenants)', () => {
    expect(DEFAULT_DASHBOARD_RANGE).toBe('90d');
  });
});
