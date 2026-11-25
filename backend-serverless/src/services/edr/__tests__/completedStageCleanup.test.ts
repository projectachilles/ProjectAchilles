import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';

const mockSearch = vi.fn();
const mockBulk = vi.fn();
const esClient = { search: mockSearch, bulk: mockBulk };

import {
  buildCompletedStageCleanupQuery,
  clearPreventionOnCompletedResults,
} from '../completedStageCleanup.js';

const client = esClient as unknown as Client;
const hitsOf = (...hits: unknown[]) => ({ hits: { hits } });
const OK = { items: [{ update: { status: 200, result: 'updated' } }] };

beforeEach(() => {
  mockSearch.mockReset();
  mockBulk.mockReset();
});

describe('completedStageCleanup', () => {
  it('builds a filter-only query with no date range', () => {
    const q = buildCompletedStageCleanupQuery(['defender', 'crowdstrike']);
    expect(q).toEqual({ bool: { filter: [
      { term: { 'event.ERROR': 101 } },
      { bool: { minimum_should_match: 1, should: [
        { term: { 'f0rtika.defender_prevented': true } },
        { term: { 'f0rtika.defender_stage_prevented': true } },
        { exists: { field: 'f0rtika.defender_prevention_action' } },
        { term: { 'f0rtika.crowdstrike_prevented': true } },
        { term: { 'f0rtika.crowdstrike_stage_prevented': true } },
        { exists: { field: 'f0rtika.crowdstrike_prevention_action' } },
      ] } },
    ] } });
    expect(JSON.stringify(q)).not.toContain('range');
  });

  it('clears only the vendors whose flags the result has', async () => {
    mockSearch
      .mockResolvedValueOnce(hitsOf({ _id: 'r1', _index: 'achilles-results-x', _source: { event: { ERROR: 101 }, f0rtika: {
        defender_prevented: true, defender_prevention_action: 'process_killed',
        defender_detected: true, crowdstrike_detected: true,
      } } }))
      .mockResolvedValueOnce(hitsOf());
    mockBulk.mockResolvedValue(OK);

    const res = await clearPreventionOnCompletedResults(client, 'achilles-results-*');

    expect(mockBulk.mock.calls[0][0]).toEqual({ refresh: true, operations: [
      { update: { _index: 'achilles-results-x', _id: 'r1', retry_on_conflict: 3 } },
      { doc: { f0rtika: {
        defender_prevented: false, defender_stage_prevented: false, defender_prevention_action: null,
      } } },
    ] });
    expect(res).toEqual({ matched: 1, sent: 1, cleared: 1, errors: [] });
    const req = mockSearch.mock.calls[0][0];
    expect(req._source).toContain('event.ERROR');
    expect(req).not.toHaveProperty('sort');
    expect(req).not.toHaveProperty('aggs');
    expect(req).toMatchObject({ ignore_unavailable: true, allow_no_indices: true });
  });

  it('clears two vendors on one result', async () => {
    mockSearch
      .mockResolvedValueOnce(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 101 }, f0rtika: {
        defender_stage_prevented: true, crowdstrike_prevention_action: 'blocked',
      } } }))
      .mockResolvedValueOnce(hitsOf());
    mockBulk.mockResolvedValue(OK);

    await clearPreventionOnCompletedResults(client, 'i');

    expect(mockBulk.mock.calls[0][0].operations[1]).toEqual({ doc: { f0rtika: {
      defender_prevented: false, defender_stage_prevented: false, defender_prevention_action: null,
      crowdstrike_prevented: false, crowdstrike_stage_prevented: false, crowdstrike_prevention_action: null,
    } } });
  });

  it('reads flattened sources', async () => {
    mockSearch
      .mockResolvedValueOnce(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 101 }, 'f0rtika.defender_stage_prevented': true } }))
      .mockResolvedValueOnce(hitsOf());
    mockBulk.mockResolvedValue(OK);

    const res = await clearPreventionOnCompletedResults(client, 'i');

    expect(res.cleared).toBe(1);
    expect(mockBulk.mock.calls[0][0].operations[1].doc).toEqual({
      'f0rtika.defender_stage_prevented': false,
      f0rtika: { defender_prevented: false, defender_prevention_action: null },
    });
  });

  it('does nothing when no result matches', async () => {
    mockSearch.mockResolvedValue(hitsOf());
    const res = await clearPreventionOnCompletedResults(client, 'i');
    expect(mockBulk).not.toHaveBeenCalled();
    expect(res).toEqual({ matched: 0, sent: 0, cleared: 0, errors: [] });
  });

  it('stops when a batch clears nothing', async () => {
    mockSearch.mockResolvedValue(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 101 }, f0rtika: { defender_prevented: true } } }));
    mockBulk.mockResolvedValue({ items: [{ update: { error: { reason: 'version conflict' } } }] });

    const res = await clearPreventionOnCompletedResults(client, 'i');

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ matched: 1, sent: 1, cleared: 0 });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('version conflict');
    expect(res.errors[0]).toBe('bulk[0]: version conflict');
  });

  it('a noop update is not progress and does not loop', async () => {
    mockSearch.mockResolvedValue(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 101 }, f0rtika: { defender_prevented: true } } }));
    mockBulk.mockResolvedValue({ items: [{ update: { status: 200, result: 'noop' } }] });
    const res = await clearPreventionOnCompletedResults(client, 'i');
    expect(mockSearch.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mockBulk).toHaveBeenCalledTimes(1);
    expect(res.cleared).toBe(0);
  });

  it('never sends the same document twice in one run', async () => {
    mockSearch.mockResolvedValue(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 101 }, f0rtika: { defender_prevented: true } } }));
    mockBulk.mockResolvedValue(OK);
    const res = await clearPreventionOnCompletedResults(client, 'i');
    expect(mockBulk).toHaveBeenCalledTimes(1);
    // The second search returns the same document: matched again, never re-sent.
    expect(res).toEqual({ matched: 2, sent: 1, cleared: 1, errors: [] });
  });

  it('counts a hit whose stored exit code is 999 as matched, never sent', async () => {
    mockSearch.mockResolvedValueOnce(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 999 }, f0rtika: { defender_prevented: true } } }));
    expect(await clearPreventionOnCompletedResults(client, 'i')).toEqual({ matched: 1, sent: 0, cleared: 0, errors: [] });
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('skips a hit whose stored exit code is not 101', async () => {
    mockSearch.mockResolvedValueOnce(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 999 }, f0rtika: { defender_prevented: true } } }));
    expect(await clearPreventionOnCompletedResults(client, 'i')).toEqual({ matched: 1, sent: 0, cleared: 0, errors: [] });
    expect(mockBulk).not.toHaveBeenCalled();

    mockSearch.mockResolvedValueOnce(hitsOf({ _id: 'r2', _index: 'i', _source: { event: { ERROR: '101' }, f0rtika: { defender_prevented: true } } }))
      .mockResolvedValueOnce(hitsOf());
    mockBulk.mockResolvedValue(OK);
    expect((await clearPreventionOnCompletedResults(client, 'i')).cleared).toBe(1);
  });

  it('reports a failed bulk call', async () => {
    mockSearch.mockResolvedValue(hitsOf({ _id: 'r1', _index: 'i', _source: { event: { ERROR: 101 }, f0rtika: { defender_prevented: true } } }));
    mockBulk.mockRejectedValue(new Error('down'));
    expect(await clearPreventionOnCompletedResults(client, 'i')).toEqual({ matched: 1, sent: 1, cleared: 0, errors: ['bulk: down'] });
  });

  it('never throws', async () => {
    mockSearch.mockRejectedValue(new Error('boom'));
    expect(await clearPreventionOnCompletedResults(client, 'i')).toEqual({ matched: 0, sent: 0, cleared: 0, errors: ['search: boom'] });
  });
});
