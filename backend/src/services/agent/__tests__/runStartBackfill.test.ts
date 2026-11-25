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
const hit = (id: string, sort: unknown[] = [1764031669000]) => ({ _id: id, _index: 'achilles-results-x', sort });
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
    const res = await backfillRunStart(client, 'i', () => found);
    expect(res).toEqual({ scanned: 1, filled: 0, unfillable: 1, errors: [] });
    expect(mockBulk).not.toHaveBeenCalled();
  });

  it.each([
    ['RFC 3339 with no milliseconds', '2026-11-01T10:00:00Z'],
    ['an offset (the UTC instant)', '2026-11-01T12:00:00+02:00'],
    ['a parseable non-ISO string', 'Sun, 01 Nov 2026 10:00:00 GMT'],
  ])('writes the start in UTC ISO form for %s', async (_label, start) => {
    mockSearch.mockResolvedValueOnce(page(hit('t1')));
    mockBulk.mockResolvedValue({ items: [UPDATED] });
    await backfillRunStart(client, 'i', () => new Map([['t1', start]]));
    expect(mockBulk.mock.calls[0][0].operations[1]).toEqual({ doc: { routing: { run_started_at: '2026-11-01T10:00:00.000Z' } } });
  });

  it('pages past a full page of unfillable results, overlapping the boundary by one millisecond', async () => {
    const X = 1764031669000;
    const first = Array.from({ length: 500 }, (_, i) => hit(`u${i}`, [X + i]));
    mockSearch.mockResolvedValueOnce(page(...first));
    mockSearch.mockResolvedValueOnce(page(hit('u499', [X + 499]), hit('t1', [X + 900])));
    mockBulk.mockResolvedValue({ items: [UPDATED] });
    const res = await backfillRunStart(client, 'i', (ids) => new Map(ids.filter((x) => x === 't1').map((x) => [x, START])));

    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch.mock.calls[0][0].search_after).toBeUndefined();
    expect(mockSearch.mock.calls[1][0].search_after).toEqual([X + 499 - 1]);
    expect(res).toEqual({ scanned: 501, filled: 1, unfillable: 500, errors: [] });
  });

  it('does not lose a bundle split across a page boundary', async () => {
    const X = 1764031669000;
    mockSearch.mockResolvedValueOnce(page(hit('a', [X - 5]), hit('b', [X - 4]), hit('t9::T1', [X])));
    mockSearch.mockResolvedValueOnce(page(hit('t9::T1', [X]), hit('t9::T2', [X])));
    mockBulk.mockResolvedValue({ items: [UPDATED, UPDATED, UPDATED] });
    mockBulk.mockResolvedValueOnce({ items: [UPDATED, UPDATED, UPDATED] });
    mockBulk.mockResolvedValueOnce({ items: [UPDATED] });
    const lookup = vi.fn((ids: string[]) => new Map(ids.map((id) => [id, START])));
    const res = await backfillRunStart(client, 'i', lookup, { pageSize: 3 });

    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch.mock.calls[1][0].search_after).toEqual([X - 1]);
    expect(lookup).toHaveBeenNthCalledWith(2, ['t9']);
    const sentIds = mockBulk.mock.calls.flatMap((c) => c[0].operations).filter((o: any) => o.update).map((o: any) => o.update._id);
    expect(sentIds).toEqual(['a', 'b', 't9::T1', 't9::T2']);
    expect(res).toEqual({ scanned: 4, filled: 4, unfillable: 0, errors: [] });
  });

  it('ends after a short page following a full page, with no third search', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('u1', [10]), hit('u2', [20])));
    mockSearch.mockResolvedValueOnce(page(hit('u2', [20])));
    await backfillRunStart(client, 'i', () => new Map(), { pageSize: 2 });
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('ends on a short last page holding only already-seen unfillable documents', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('u1', [10]), hit('u2', [20])));
    mockSearch.mockResolvedValueOnce(page(hit('u2', [20])));
    const res = await backfillRunStart(client, 'i', () => new Map(), { pageSize: 2 });
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ scanned: 2, filled: 0, unfillable: 2, errors: [] });
  });

  it('stall guard: full pages of seen documents at one time move strictly past it, one error line', async () => {
    const X = 1764031669000;
    mockSearch.mockResolvedValueOnce(page(hit('u1', [X]), hit('u2', [X])));
    mockSearch.mockResolvedValueOnce(page(hit('u1', [X]), hit('u2', [X])));
    mockSearch.mockResolvedValueOnce(page());
    const res = await backfillRunStart(client, 'i', () => new Map(), { pageSize: 2 });

    expect(mockSearch).toHaveBeenCalledTimes(3);
    expect(mockSearch.mock.calls[1][0].search_after).toEqual([X - 1]);
    expect(mockSearch.mock.calls[2][0].search_after).toEqual([X]);
    expect(res.errors).toEqual(['paging: more than 2 results share one event time; some were not read']);
    expect(res.scanned).toBe(2);
  });

  it('ends when the last hit has no numeric sort value', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('u1', ['x'])));
    await backfillRunStart(client, 'i', () => new Map(), { pageSize: 1 });
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('never re-sends a document seen again on a later page', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1', [1])));
    mockSearch.mockResolvedValueOnce(page(hit('t1', [1])));
    mockSearch.mockResolvedValueOnce(page());
    mockBulk.mockResolvedValue({ items: [UPDATED] });
    await backfillRunStart(client, 'i', () => new Map([['t1', START]]), { pageSize: 1 });
    expect(mockBulk).toHaveBeenCalledTimes(1);
  });

  it('reports a search failure without throwing', async () => {
    mockSearch.mockRejectedValueOnce(new Error('boom'));
    expect(await backfillRunStart(client, 'i', () => new Map())).toEqual({ scanned: 0, filled: 0, unfillable: 0, errors: ['search: boom'] });
  });

  it('reports a bulk item error', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1'), hit('t2', [2])));
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

  it('stops once maxDurationMs has passed, and says the pass is incomplete', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('t1')));
    const res = await backfillRunStart(client, 'i', () => new Map(), { maxDurationMs: -1 });
    expect(mockSearch).not.toHaveBeenCalled();
    expect(res).toEqual({ scanned: 0, filled: 0, unfillable: 0, errors: [], incomplete: true });
  });

  it('the time budget ending after a full page is incomplete', async () => {
    const now = vi.spyOn(Date, 'now');
    try {
      // Deadline at 1,000; the first loop check passes, the second is past it.
      now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(2_000);
      mockSearch.mockResolvedValueOnce(page(hit('u1', [10])));
      const res = await backfillRunStart(client, 'i', () => new Map(), { pageSize: 1, maxDurationMs: 1_000 });
      expect(mockSearch).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ scanned: 1, filled: 0, unfillable: 1, errors: [], incomplete: true });
    } finally {
      now.mockRestore();
    }
  });

  it('a short or empty last page is not incomplete', async () => {
    mockSearch.mockResolvedValueOnce(page(hit('u1', [10])));
    const short = await backfillRunStart(client, 'i', () => new Map(), { pageSize: 2 });
    expect(short).not.toHaveProperty('incomplete');

    mockSearch.mockResolvedValueOnce(page());
    const empty = await backfillRunStart(client, 'i', () => new Map());
    expect(empty).not.toHaveProperty('incomplete');
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

  it('ends the log line with incomplete=true when the time budget ended the pass, even with nothing scanned', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = vi.spyOn(Date, 'now');
    try {
      // The deadline is set from the first reading; every later one is past it.
      now.mockReturnValueOnce(0).mockReturnValue(10 * 60_000);
      const res = await runRunStartBackfill();
      expect(mockSearch).not.toHaveBeenCalled();
      expect(res.incomplete).toBe(true);
      expect(log).toHaveBeenCalledWith('[Run-Start-Backfill] scanned=0 filled=0 unfillable=0 incomplete=true');
    } finally {
      now.mockRestore();
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
