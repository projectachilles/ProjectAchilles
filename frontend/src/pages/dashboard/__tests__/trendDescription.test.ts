process.env.TZ = 'America/Santo_Domingo';

import { describe, it, expect } from 'vitest';
import { buildTrendPoints, buildTrendDescription } from '../useDashboardData';

const dp = (timestamp: string, score: number | null) => ({
  timestamp,
  score,
  total: 20,
  protected: 10,
});

describe('buildTrendPoints', () => {
  it('joins secure/zta/error to the defense day by UTC key', () => {
    const points = buildTrendPoints(
      [dp('2026-10-13T23:59:59.999Z', 57)],
      [{ timestamp: '2026-10-13T23:59:59.999Z', errorRate: 0.1, errorCount: 1, conclusiveCount: 9, total: 10 }],
      [{ date: '2026-10-13', score: 80, maxScore: 100, percentage: 86.6 }],
      [{ date: '2026-10-13', overallScore: 96.3, score: 96.3, osScore: 0, sensorConfigScore: 0, deviceCount: 3 }],
    );
    expect(points).toEqual([
      { date: 'Oct 13', defense: 57, secure: 86.6, zta: 96.3, errorRate: 0.1 },
    ]);
  });

  it('keeps null defense scores as null', () => {
    const points = buildTrendPoints([dp('2026-10-13T23:59:59.999Z', null)], null, null, null);
    expect(points[0].defense).toBeNull();
    expect(points[0].secure).toBeNull();
  });

  it('returns [] for an empty defense trend', () => {
    expect(buildTrendPoints([], null, null, null)).toEqual([]);
  });
});

describe('buildTrendDescription', () => {
  it('joins current values without a rolling suffix', () => {
    const s = buildTrendDescription({ defense: 57, secure: 86.6, zta: 96.3, errorRate: 0.1 });
    expect(s).toBe('Defense 57.0% · Secure 86.6% · ZTA 96.3% · Error rate 0.1%');
    expect(s).not.toMatch(/rolling/i);
  });

  it('omits null parts', () => {
    expect(buildTrendDescription({ defense: null, secure: 50, zta: null, errorRate: null })).toBe('Secure 50.0%');
  });
});

describe('Sophos Health Check series', () => {
  it('joins the Sophos trend by UTC day and omits the key when no Sophos series', () => {
    const defense = [dp('2026-10-13T23:59:59.999Z', 57)];
    const withSophos = buildTrendPoints(defense, null, null, null, [{ date: '2026-10-13', score: 77 }]);
    expect(withSophos[0].sophos).toBe(77);
    const without = buildTrendPoints(defense, null, null, null);
    expect('sophos' in without[0]).toBe(false);
  });

  it('describes the current Sophos headline', () => {
    expect(buildTrendDescription({ defense: 57, secure: null, zta: null, errorRate: null, sophos: 77 })).toBe('Defense 57.0% · Sophos 77.0%');
  });
});
