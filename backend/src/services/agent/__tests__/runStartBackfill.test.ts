import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';

const mockSearch = vi.fn();
const mockBulk = vi.fn();
const esClient = { search: mockSearch, bulk: mockBulk };

let esConfigured = true;
vi.mock('../../analytics/settings.js', () => ({
  SettingsService: class {
    getSettings = () => ({ configured: esConfigured, indexPattern: 'achilles-results-*' });
  },
}));
vi.mock('../../analytics/client.js', () => ({ createEsClient: () => esClient }));

const mockAll = vi.fn();
const mockPrepare = vi.fn(() => ({ all: mockAll }));
vi.mock('../database.js', () => ({ getDatabase: () => ({ prepare: mockPrepare }) }));

import { backfillRunStart, runRunStartBackfill } from '../runStartBackfill.js';

const client = esClient as unknown as Client;
const hit = (id: string, sort: unknown[] = [1]) => ({ _id: id, _index: 'achilles-results-x', sort });
const page = (...hits: unknown[]) => ({ hits: { hits } });
const UPDATED = { update: { status: 200, result: 'updated' } };
const START = '2026-11-01T10:00:00.000Z';

beforeEach(() => {
  mockSearch.mockReset();
  mockBulk.mockReset();
  mockAll.mockReset();
  mockPrepare.mockClear();
  esConfigured = true;
});

describe('backfillRunStart', () => {
  it('sends the documented search', async () => {
    mockSearch.mockResolvedValueOnce(page());
    await backfillRunStart(client, 'idx-*', () => new Map());
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0][0]).toEqual({
      index: 'idx-*',
      size: 500,
      query: { bool: {
        filter: [
          { exists: { field: 'f0rtika.test_uuid' } },
          { range: { 'routing.event_time': { gte: 'now-90d' } } },
        ],
        must_not: [{ exists: { field: 'routing.run_started_at' } }],
      } },
      sort: [{ 'routing.event_time': { order: 'asc', unmapped_type: 'date' } }],
      _source: false,
      ignore_unavailable: true,
      allow_no_indices: true,
    });
  });

  it('returns zeros and makes no bulk call on an empty first page', async () => {
    mockSearch.mockResolvedValueOnce(page());
    const res = await backfillRunStart(client, 'i', () => new Map());
    expect(res).toEqual({ scanned: 0, filled: 0, unfillable: 0, errors: [] });
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('looks up the task ids once per page and fills with a bulk update', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1::T1047'), hit('t2')));
    mockSearch.mockResolvedValueOnce(page());
    mockBulk.mockResolvedValue({ items: [UPDATED, UPDATED] });
    const lookup = vi.fn(() => new Map([['t1', START], ['t2', START]]));

    const res = await backfillRunStart(client, 'i', lookup);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(['t1', 't2']);
    expect(mockBulk.mock.calls[0][0].operations).toEqual([
      { update: { _index: 'achilles-results-x', _id: 't1::T1047', retry_on_conflict: 3 } },
      { doc: { routing: { run_started_at: START } } },
      { update: { _index: 'achilles-results-x', _id: 't2', retry_on_conflict: 3 } },
      { doc: { routing: { run_started_at: START } } },
    ]);
    expect(res).toEqual({ scanned: 2, filled: 2, unfillable: 0, errors: [] });
  });

  it('does not count a noop item as filled', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1'), hit('t2', [2])));
    mockSearch.mockResolvedValueOnce(page());
    mockBulk.mockResolvedValue({ items: [UPDATED, { update: { status: 200, result: 'noop' } }] });
    const res = await backfillRunStart(client, 'i', () => new Map([['t1', START], ['t2', START]]));
    expect(res.filled).toBe(1);
  });

  it.each([
    ['missing task', new Map<string, string>()],
    ['empty string', new Map([['t1', '']])],
    ['not a date', new Map([['t1', 'yesterday']])],
    ['non-string', new Map([['t1', 12345 as unknown as string]])],
  ])('counts %s as unfillable and sends nothing', async (_name, found) => {
    mockSearch.mockResolvedValueOnce(page(hit('t1')));
    mockSearch.mockResolvedValueOnce(page());
    const res = await backfillRunStart(client, 'i', () => found);
    expect(res).toEqual({ scanned: 1, filled: 0, unfillable: 1, errors: [] });
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it('writes the start as received', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1')));
    mockSearch.mockResolvedValueOnce(page());
    mockBulk.mockResolvedValue({ items: [UPDATED] });
    await backfillRunStart(client, 'i', () => new Map([['t1', '2026-11-01 10:00:00']]));
    expect(mockBulk.mock.calls[0][0].operations[1]).toEqual({ doc: { routing: { run_started_at: '2026-11-01 10:00:00' } } });
  });

  it('pages with search_after, even past a page of unfillable results', async () => {
    const first = Array.from({ length: 500 }, (_, i) => hit(`u${i}`, [i, `u${i}`]));
    mockSearch.mockResolvedValueOnce(page(...first));
    mockSearch.mockResolvedValueOnce(page(hit('t1', [900])));
    mockSearch.mockResolvedValueOnce(page());
    mockBulk.mockResolvedValue({ items: [UPDATED] });
    const res = await backfillRunStart(client, 'i', (ids) => new Map(ids.filter((x) => x === 't1').map((x) => [x, START])));

    expect(mockSearch.mock.calls[0][0].search_after).toBeUndefined();
    expect(mockSearch.mock.calls[1][0].search_after).toEqual([499, 'u499']);
    expect(mockSearch.mock.calls[2][0].search_after).toEqual([900]);
    expect(res).toEqual({ scanned: 501, filled: 1, unfillable: 500, errors: [] });
  });

  it('never re-sends a document seen again on a later page', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1', [1])));
    mockSearch.mockResolvedValueOnce(page(hit('t1', [2])));
    mockSearch.mockResolvedValueOnce(page());
    mockBulk.mockResolvedValue({ items: [UPDATED] });
    await backfillRunStart(client, 'i', () => new Map([['t1', START]]));
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('reports a search failure without throwing', async () => {
    mockSearch.mockRejectedValueOnce(new Error('boom'));
    expect(await backfillRunStart(client, 'i', () => new Map())).toEqual({ scanned: 0, filled: 0, unfillable: 0, errors: ['search: boom'] });
  });

  it('reports a bulk item error', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1'), hit('t2', [2])));
    mockSearch.mockResolvedValueOnce(page());
    mockBulk.mockResolvedValue({ items: [UPDATED, { update: { status: 400, error: { reason: 'bad mapping' } } }] });
    const res = await backfillRunStart(client, 'i', () => new Map([['t1', START], ['t2', START]]));
    expect(res.filled).toBe(1);
    expect(res.errors).toEqual(['bulk[1]: bad mapping']);
  });

  it('reports a failing lookup or bulk without throwing', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1')));
    const res = await backfillRunStart(client, 'i', () => { throw new Error('db gone'); });
    expect(res.errors).toEqual(['lookup: db gone']);
  });

  it('stops once maxDurationMs has passed', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1')));
    const res = await backfillRunStart(client, 'i', () => new Map(), { maxDurationMs: -1 });
    expect(mockSearch).not.toHaveBeenCalled();
    expect(res).toEqual({ scanned: 0, filled: 0, unfillable: 0, errors: [] });
  });
});

describe('runRunStartBackfill', () => {
  it('skips when Analytics is not configured', async () => {
    esConfigured = false;
    expect(await runRunStartBackfill()).toEqual({ scanned: 0, filled: 0, unfillable: 0, errors: [] });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('reads started_at from tasks.result with bound parameters and logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      mockSearch.mockResolvedValueOnce(page(hit('t1::A'), hit('t2', [2]), hit('t3', [3])));
      mockSearch.mockResolvedValueOnce(page());
      mockBulk.mockResolvedValue({ items: [UPDATED] });
      mockAll.mockReturnValue([
        { id: 't1', result: JSON.stringify({ started_at: START }) },
        { id: 't2', result: 'not json' },
        { id: 't3', result: null },
      ]);

      const res = await runRunStartBackfill();

      expect(mockPrepare).toHaveBeenCalledWith('SELECT id, result FROM tasks WHERE id IN (?,?,?)');
      expect(mockAll).toHaveBeenCalledWith('t1', 't2', 't3');
      expect(res).toEqual({ scanned: 3, filled: 1, unfillable: 2, errors: [] });
      expect(log).toHaveBeenCalledWith('[Run-Start-Backfill] scanned=3 filled=1 unfillable=2');
    } finally {
      log.mockRestore();
    }
  });

  it('does not log when nothing was scanned', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      mockSearch.mockResolvedValueOnce(page());
      await runRunStartBackfill();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
