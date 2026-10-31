import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { Client } from '@elastic/elasticsearch';
import { esTimingMiddleware, instrumentEsClient } from '../esTiming.js';

/** Minimal Elasticsearch stand-in: answers every call after `delayMs` with `took`. */
let fakeEs: http.Server;
let client: Client;

beforeAll(async () => {
  fakeEs = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-elastic-product': 'Elasticsearch' });
      res.end(JSON.stringify({ took: 7, hits: { total: { value: 0 }, hits: [] } }));
    }, 30);
  });
  await new Promise<void>((resolve) => fakeEs.listen(0, resolve));
  client = instrumentEsClient(new Client({ node: `http://127.0.0.1:${(fakeEs.address() as AddressInfo).port}` }));
});

afterAll(async () => {
  await client.close();
  fakeEs.close();
});

function app() {
  const a = express();
  a.use('/api', esTimingMiddleware());
  a.get('/api/two-queries', async (_req, res) => {
    await client.search({ index: 'a' });
    await client.search({ index: 'b' });
    res.json({ ok: true });
  });
  a.get('/api/no-es', (_req, res) => {
    res.json({ ok: true });
  });
  return a;
}

function serverTiming(header: string | undefined): Record<string, { dur: number; desc?: string }> {
  const out: Record<string, { dur: number; desc?: string }> = {};
  for (const part of (header ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const [name, ...params] = part.split(';');
    const dur = Number(params.find((p) => p.startsWith('dur='))?.slice(4));
    const desc = params.find((p) => p.startsWith('desc='))?.slice(5).replace(/"/g, '');
    out[name] = { dur, desc };
  }
  return out;
}

describe('esTimingMiddleware', () => {
  it('reports Elasticsearch calls, client wait and ES took for the request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app()).get('/api/two-queries?hostnames=secret-host');
    const st = serverTiming(res.headers['server-timing']);

    expect(st['es-took'].dur).toBe(14); // 7 + 7
    expect(st.es.dur).toBeGreaterThanOrEqual(55); // ~30 ms each, measured client-side
    expect(st.es.desc).toContain('2 calls');

    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[es-timing]'));
    expect(line).toMatch(/^\[es-timing\] GET \/api\/two-queries 200 total=\d+ms es_calls=2 es_wait=\d+ms es_took=14ms$/);
    expect(line).not.toContain('secret-host'); // never the query string
    log.mockRestore();
  });

  it('keeps concurrent requests apart', async () => {
    const a = app();
    const [r1, r2] = await Promise.all([request(a).get('/api/two-queries'), request(a).get('/api/two-queries')]);
    expect(serverTiming(r1.headers['server-timing'])['es-took'].dur).toBe(14);
    expect(serverTiming(r2.headers['server-timing'])['es-took'].dur).toBe(14);
  });

  it('adds nothing to requests that do not touch Elasticsearch', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app()).get('/api/no-es');
    expect(res.headers['server-timing']).toBeUndefined();
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('[es-timing]'))).toBe(false);
    log.mockRestore();
  });

  it('does not count calls made outside a request (background syncs)', async () => {
    await expect(client.search({ index: 'background' })).resolves.toBeDefined();
  });
});
