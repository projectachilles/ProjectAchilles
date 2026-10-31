// One kept-open Elasticsearch client for request-path readers (the EDR
// analytics tabs). A client per request pays a DNS lookup, TCP connect and TLS
// handshake every time (~165 ms to Elastic Cloud from a distant site, and a
// stall whenever the network drops a handshake); a shared client keeps its
// connections alive. A change to the connection settings builds a new client.

import { createHash } from 'crypto';
import type { Client } from '@elastic/elasticsearch';
import type { AnalyticsSettings } from '../../types/analytics.js';
import { createEsClient } from './client.js';

/** How long a replaced client stays open, so requests already running on it can finish. */
export const CLOSE_GRACE_MS = 60_000;

let shared: { key: string; client: Client } | null = null;

/** Only what decides where and how the client connects; index names don't need a new client. */
function connectionKey(s: AnalyticsSettings): string {
  const fields = [s.connectionType, s.cloudId, s.node, s.apiKey, s.username, s.password, s.caCert, s.tlsInsecureSkipVerify];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** The shared client for these settings; callers check `settings.configured` first and never close it. */
export function getSharedEsClient(settings: AnalyticsSettings): Client {
  const key = connectionKey(settings);
  if (shared?.key === key) return shared.client;
  const previous = shared?.client;
  shared = { key, client: createEsClient(settings) };
  if (previous) {
    setTimeout(() => {
      Promise.resolve(previous.close?.()).catch(() => undefined);
    }, CLOSE_GRACE_MS).unref();
  }
  return shared.client;
}

/** Test-only: forget the shared client without closing it. */
export function __resetSharedEsClientForTests(): void {
  shared = null;
}
