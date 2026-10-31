// One kept-open Elasticsearch client for request-path readers (the EDR
// analytics tabs). A client per request pays a DNS lookup, TCP connect and TLS
// handshake every time (~165 ms to Elastic Cloud from a distant site, and a
// stall whenever the network drops a handshake); a shared client keeps its
// connections alive. A change to the connection settings builds a new client.

import type { Client } from '@elastic/elasticsearch';
import type { AnalyticsSettings } from '../../types/analytics.js';
import { createEsClient } from './client.js';

/** How long a replaced client stays open, so requests already running on it can finish. */
export const CLOSE_GRACE_MS = 60_000;

type ConnectionFields = readonly unknown[];

let shared: { fields: ConnectionFields; client: Client } | null = null;

/** Only what decides where and how the client connects; index names don't need a new client. */
function connectionFields(s: AnalyticsSettings): ConnectionFields {
  return [s.connectionType, s.cloudId, s.node, s.apiKey, s.username, s.password, s.caCert, s.tlsInsecureSkipVerify];
}

// Compared field by field in memory: credentials are never hashed, serialized or stored elsewhere.
function sameConnection(a: ConnectionFields, b: ConnectionFields): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The shared client for these settings; callers check `settings.configured` first and never close it. */
export function getSharedEsClient(settings: AnalyticsSettings): Client {
  const fields = connectionFields(settings);
  if (shared && sameConnection(shared.fields, fields)) return shared.client;
  const previous = shared?.client;
  shared = { fields, client: createEsClient(settings) };
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
