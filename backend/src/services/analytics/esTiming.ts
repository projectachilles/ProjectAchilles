// Per-request Elasticsearch timing: how many ES calls an API request made,
// how long the client waited for them, and how long ES itself says it worked
// (`took`). The gap between the two is network, TLS handshakes and queueing,
// which is what separates "slow query" from "far away cluster".
//
// Exposed as a Server-Timing header (visible in the browser's DevTools) and
// one log line per API request that touched ES. Never logs query strings:
// analytics filters can carry hostnames and test names.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Client } from '@elastic/elasticsearch';
import type { NextFunction, Request, Response } from 'express';

interface EsTiming {
  calls: number;
  /** Sum of client-side waits; concurrent calls overlap, so it can exceed wall time. */
  waitMs: number;
  /** Sum of the `took` values ES reported. */
  tookMs: number;
}

const requestTiming = new AsyncLocalStorage<EsTiming>();
const instrumented = new WeakSet<Client>();

/**
 * Attach timing listeners to an ES client. Calls made inside an API request
 * (esTimingMiddleware) are added to that request's totals; calls made outside
 * one, such as background syncs, are ignored. Idempotent per client.
 */
export function instrumentEsClient(client: Client): Client {
  // Test doubles of Client often have no diagnostic emitter.
  if (instrumented.has(client) || typeof client?.diagnostic?.on !== 'function') return client;
  instrumented.add(client);

  const startedAt = new Map<unknown, number>();
  client.diagnostic.on('request', (_err, event) => {
    if (!event || !requestTiming.getStore()) return;
    startedAt.set(event.meta.request.id, performance.now());
  });
  client.diagnostic.on('response', (_err, event) => {
    if (!event) return;
    const id = event.meta.request.id;
    const start = startedAt.get(id);
    startedAt.delete(id);
    const timing = requestTiming.getStore();
    if (!timing || start === undefined) return;
    timing.calls += 1;
    timing.waitMs += performance.now() - start;
    const took = (event.body as { took?: unknown } | undefined)?.took;
    if (typeof took === 'number') timing.tookMs += took;
  });
  return client;
}

function logEnabled(): boolean {
  return (process.env.ES_TIMING_LOG ?? 'on').toLowerCase() !== 'off';
}

/** Mount on /api: collects ES timing for each request. */
export function esTimingMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const timing: EsTiming = { calls: 0, waitMs: 0, tookMs: 0 };
    const started = performance.now();

    // Add the header at the last moment headers can still change, i.e. once
    // the handler has finished its queries and starts the response.
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(this: Response, ...args: Parameters<Response['writeHead']>) {
      if (timing.calls > 0 && !this.headersSent) {
        this.setHeader(
          'Server-Timing',
          `es;dur=${timing.waitMs.toFixed(1)};desc="Elasticsearch wait (${timing.calls} calls)", ` +
            `es-took;dur=${timing.tookMs};desc="Elasticsearch took"`,
        );
      }
      return writeHead.apply(this, args);
    } as Response['writeHead'];

    res.on('finish', () => {
      if (timing.calls === 0 || !logEnabled()) return;
      const path = req.originalUrl.split('?')[0]; // never the query string
      console.log(
        `[es-timing] ${req.method} ${path} ${res.statusCode} total=${Math.round(performance.now() - started)}ms ` +
          `es_calls=${timing.calls} es_wait=${Math.round(timing.waitMs)}ms es_took=${timing.tookMs}ms`,
      );
    });

    requestTiming.run(timing, next);
  };
}
