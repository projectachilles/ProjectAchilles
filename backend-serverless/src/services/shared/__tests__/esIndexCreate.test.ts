import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Client } from '@elastic/elasticsearch';
import { createAchillesIndex, ACHILLES_INDEX_SETTINGS } from '../esIndexCreate.js';

function mockClient(create: ReturnType<typeof vi.fn>): Client {
  return { indices: { create } } as unknown as Client;
}

describe('createAchillesIndex', () => {
  it('sends auto_expand_replicas 0-1 with the mappings', async () => {
    const create = vi.fn().mockResolvedValue({});
    const mappings = { properties: { a: { type: 'keyword' } } };
    await createAchillesIndex(mockClient(create), 'idx', { mappings });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      index: 'idx',
      mappings,
      settings: { 'index.auto_expand_replicas': '0-1' },
    });
  });

  it('keeps caller settings and lets ours win only for the replica key', async () => {
    const create = vi.fn().mockResolvedValue({});
    await createAchillesIndex(mockClient(create), 'idx', {
      mappings: {},
      settings: { 'index.auto_expand_replicas': '5-9', 'index.refresh_interval': '30s' },
    });
    expect(create.mock.calls[0][0].settings).toEqual({
      'index.refresh_interval': '30s',
      ...ACHILLES_INDEX_SETTINGS,
    });
  });

  it('retries without the setting when the cluster rejects it (error body in meta)', async () => {
    const rejection = Object.assign(new Error('illegal_argument_exception'), {
      statusCode: 400,
      meta: {
        statusCode: 400,
        body: {
          error: {
            type: 'illegal_argument_exception',
            reason: 'unknown setting [index.auto_expand_replicas] please check ...',
          },
        },
      },
    });
    const create = vi.fn().mockRejectedValueOnce(rejection).mockResolvedValueOnce({});
    await expect(
      createAchillesIndex(mockClient(create), 'idx', {
        mappings: { m: 1 },
        settings: { 'index.refresh_interval': '30s' },
      }),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(2);
    const second = create.mock.calls[1][0];
    expect(JSON.stringify(second)).not.toContain('auto_expand_replicas');
    expect(second.mappings).toEqual({ m: 1 });
    expect(second.settings).toEqual({ 'index.refresh_interval': '30s' });
  });

  it('retries when the rejection is a plain object with body.error.reason', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({
        statusCode: 400,
        body: { error: { type: 'illegal_argument_exception', reason: 'unknown setting [index.auto_expand_replicas]' } },
      })
      .mockResolvedValueOnce({});
    await createAchillesIndex(mockClient(create), 'idx', { mappings: {} });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rethrows resource_already_exists unchanged', async () => {
    const exists = {
      statusCode: 400,
      meta: { body: { error: { type: 'resource_already_exists_exception', reason: 'index [idx] already exists' } } },
    };
    const create = vi.fn().mockRejectedValue(exists);
    await expect(createAchillesIndex(mockClient(create), 'idx', { mappings: {} })).rejects.toBe(exists);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rethrows other errors unchanged and does not retry', async () => {
    const boom = Object.assign(new Error('boom'), { statusCode: 503 });
    const create = vi.fn().mockRejectedValue(boom);
    await expect(createAchillesIndex(mockClient(create), 'idx', { mappings: {} })).rejects.toBe(boom);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rethrows the error when the retry itself fails', async () => {
    const rejection = { statusCode: 400, body: { error: { reason: 'unknown setting [index.auto_expand_replicas]' } } };
    const second = new Error('second');
    const create = vi.fn().mockRejectedValueOnce(rejection).mockRejectedValueOnce(second);
    await expect(createAchillesIndex(mockClient(create), 'idx', { mappings: {} })).rejects.toBe(second);
  });
});

describe('index creation guard', () => {
  it('no direct indices.create calls remain in src', () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === '__tests__' || name === 'node_modules') continue;
          walk(full);
        } else if (/\.ts$/.test(name) && name !== 'esIndexCreate.ts') {
          if (/\bindices\s*\.\s*create\s*\(/.test(readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
