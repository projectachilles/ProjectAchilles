import { describe, it, expect, vi } from 'vitest';
import type { AnalyticsSettings } from '../../../types/analytics.js';

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(function (this: any) {
    this.search = vi.fn();
  }),
}));

vi.mock('../../risk-acceptance/risk-acceptance.service.js', () => ({
  RiskAcceptanceService: vi.fn().mockImplementation(function (this: any) {
    this.buildExclusionFilter = vi.fn().mockResolvedValue(null);
    this.invalidateCache = vi.fn();
  }),
}));

const { ElasticsearchService } = await import('../elasticsearch.js');
const { edrDetectedTerms, edrPreventedTerms } = await import('../../outcomes/vendors.js');

const settings: AnalyticsSettings = {
  connectionType: 'direct',
  node: 'http://localhost:9200',
  apiKey: 'test-key',
  indexPattern: 'achilles-results-*',
  configured: true,
};
const service = new ElasticsearchService(settings);
const base = { from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z', org: 'org-a' };

const { EDR_PREVENTED_ERROR_STAGE } = await import('../../reports/stageOutcome.js');
// The scored-results gate: a conclusive code, or an error stage the EDR's own alert says it stopped.
const CONCLUSIVE = { bool: { should: [{ terms: { 'event.ERROR': [101, 105, 126, 127] } }, EDR_PREVENTED_ERROR_STAGE], minimum_should_match: 1 } };
const PROTECTED = { term: { 'f0rtika.is_protected': true } };
const DET = () => edrDetectedTerms();
const PREV = () => edrPreventedTerms();

describe('executions verdict filter (buildExtendedFilters)', () => {
  it('adds nothing without a verdict', () => {
    const filters = service.buildExtendedFilters(base);
    expect(filters).not.toContainEqual(CONCLUSIVE);
  });

  it('restricts a verdict to attack tests (cyber-hygiene excluded)', () => {
    for (const verdict of ['protected', 'prevented', 'detected', 'silent'] as const) {
      expect(service.buildExtendedFilters({ ...base, verdict })).toContainEqual({
        bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] },
      });
    }
    expect(service.buildExtendedFilters(base)).not.toContainEqual({
      bool: { must_not: [{ term: { 'f0rtika.category': 'cyber-hygiene' } }] },
    });
  });

  it('protected', () => {
    const filters = service.buildExtendedFilters({ ...base, verdict: 'protected' });
    expect(filters).toContainEqual(CONCLUSIVE);
    expect(filters).toContainEqual(PROTECTED);
  });

  it('prevented', () => {
    const filters = service.buildExtendedFilters({ ...base, verdict: 'prevented' });
    expect(filters).toContainEqual(CONCLUSIVE);
    expect(filters).toContainEqual({ bool: { must_not: [PROTECTED] } });
    expect(filters).toContainEqual({ bool: { should: DET(), minimum_should_match: 1 } });
    expect(filters).toContainEqual({ bool: { should: PREV(), minimum_should_match: 1 } });
  });

  it('detected', () => {
    const filters = service.buildExtendedFilters({ ...base, verdict: 'detected' });
    expect(filters).toContainEqual(CONCLUSIVE);
    expect(filters).toContainEqual({ bool: { must_not: [PROTECTED] } });
    expect(filters).toContainEqual({ bool: { should: DET(), minimum_should_match: 1 } });
    expect(filters).toContainEqual({ bool: { must_not: PREV() } });
  });

  it('silent', () => {
    const filters = service.buildExtendedFilters({ ...base, verdict: 'silent' });
    expect(filters).toContainEqual(CONCLUSIVE);
    expect(filters).toContainEqual({ bool: { must_not: [PROTECTED] } });
    expect(filters).toContainEqual({ bool: { must_not: DET() } });
  });
});
