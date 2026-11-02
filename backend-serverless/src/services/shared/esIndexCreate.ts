/**
 * Single entry point for creating Achilles Elasticsearch indices.
 *
 * Without an explicit replica setting Elasticsearch defaults to 1 replica,
 * which a single-node cluster can never assign (the cluster stays yellow and
 * every index adds an unassignable shard). `auto_expand_replicas: 0-1` gives
 * 0 replicas on one node and 1 replica when a second data node exists.
 *
 * Elastic Cloud Serverless rejects replica settings, so a rejection of this
 * setting is retried once without it. Every other error is rethrown unchanged
 * (callers detect `resource_already_exists_exception` from the 400).
 */
import type { Client } from '@elastic/elasticsearch';

export const ACHILLES_INDEX_SETTINGS = { 'index.auto_expand_replicas': '0-1' } as const;

export interface AchillesIndexBody {
  mappings: unknown;
  settings?: Record<string, unknown>;
}

function errorText(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as {
    message?: unknown;
    meta?: { body?: unknown };
    body?: unknown;
  };
  const parts: string[] = [];
  if (typeof e.message === 'string') parts.push(e.message);
  for (const body of [e.meta?.body, e.body]) {
    if (body === undefined || body === null) continue;
    try {
      parts.push(typeof body === 'string' ? body : JSON.stringify(body));
    } catch {
      /* unserialisable body: ignore */
    }
  }
  return parts.join(' ');
}

function isReplicaSettingRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { statusCode?: unknown; meta?: { statusCode?: unknown } };
  const status = e.statusCode ?? e.meta?.statusCode;
  if (status !== 400) return false;
  return errorText(err).includes('auto_expand_replicas');
}

export async function createAchillesIndex(
  client: Client,
  index: string,
  body: AchillesIndexBody,
): Promise<void> {
  try {
    await client.indices.create({
      index,
      ...body,
      settings: { ...body.settings, ...ACHILLES_INDEX_SETTINGS },
    } as Parameters<Client['indices']['create']>[0]);
  } catch (err) {
    if (!isReplicaSettingRejection(err)) throw err;
    await client.indices.create({
      index,
      ...body,
    } as Parameters<Client['indices']['create']>[0]);
  }
}
