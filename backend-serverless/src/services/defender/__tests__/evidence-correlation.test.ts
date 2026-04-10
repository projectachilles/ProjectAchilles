import { describe, it, expect } from 'vitest';
import { buildDefenderEvidenceQuery } from '../evidence-correlation.js';

describe('buildDefenderEvidenceQuery', () => {
  const baseInput = {
    test_uuid: '92b0b4f6-a09b-4c7b-b593-31ce461f804c::T1204.002',
    routing_event_time: '2026-03-27T07:52:54Z',
    routing_hostname: 'LT-TPL-L50',
  };

  it('strips the :: suffix to get the bundle UUID', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    expect(q).not.toBeNull();
    const must = (q as any).bool.must as any[];
    const filenameClause = must.find((c: any) => 'wildcard' in c && 'evidence_filenames.keyword' in c.wildcard);
    expect(filenameClause.wildcard['evidence_filenames.keyword'].value).toBe('92b0b4f6-a09b-4c7b-b593-31ce461f804c*');
  });

  it('keeps the test_uuid as-is when no :: is present', () => {
    const q = buildDefenderEvidenceQuery({ ...baseInput, test_uuid: 'abc123-def456' });
    const must = (q as any).bool.must;
    const filenameClause = must.find((c: any) => 'wildcard' in c && 'evidence_filenames.keyword' in c.wildcard);
    expect(filenameClause.wildcard['evidence_filenames.keyword'].value).toBe('abc123-def456*');
  });

  it('lowercases the binary prefix', () => {
    const q = buildDefenderEvidenceQuery({ ...baseInput, test_uuid: 'ABC123-DEF::T1' });
    const must = (q as any).bool.must;
    const filenameClause = must.find((c: any) => 'wildcard' in c && 'evidence_filenames.keyword' in c.wildcard);
    expect(filenameClause.wildcard['evidence_filenames.keyword'].value).toBe('abc123-def*');
  });

  it('uppercases the hostname prefix', () => {
    const q = buildDefenderEvidenceQuery({ ...baseInput, routing_hostname: 'lt-tpl-l50' });
    const must = (q as any).bool.must;
    const hostClause = must.find((c: any) => 'wildcard' in c && 'evidence_hostnames.keyword' in c.wildcard);
    expect(hostClause.wildcard['evidence_hostnames.keyword'].value).toBe('LT-TPL-L50*');
  });

  it('builds the time window as -5/+30 minutes around event_time', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must;
    const rangeClause = must.find((c: any) => 'range' in c);
    expect(rangeClause.range.timestamp.gte).toBe('2026-03-27T07:47:54.000Z');
    expect(rangeClause.range.timestamp.lte).toBe('2026-03-27T08:22:54.000Z');
  });

  it('includes the doc_type: alert filter', () => {
    const q = buildDefenderEvidenceQuery(baseInput);
    const must = (q as any).bool.must;
    expect(must).toContainEqual({ term: { doc_type: 'alert' } });
  });

  it('returns null when test_uuid is missing', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, test_uuid: '' })).toBeNull();
  });

  it('returns null when routing_event_time is missing', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, routing_event_time: '' })).toBeNull();
  });

  it('returns null when routing_hostname is missing', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, routing_hostname: '' })).toBeNull();
  });

  it('returns null when the timestamp is unparseable', () => {
    expect(buildDefenderEvidenceQuery({ ...baseInput, routing_event_time: 'not-a-date' })).toBeNull();
  });
});
