import type { BuildInfo, EmbedDependency } from '@/types/test';

export interface BuildQueueItem {
  uuid: string;
  name: string;
}
export type BuildQueueOutcome = 'built' | 'failed' | 'skipped';
export interface BuildQueueResult {
  uuid: string;
  name: string;
  outcome: BuildQueueOutcome;
  reason?: string;
}
export interface BuildQueueDeps {
  getBuildInfo(uuid: string): Promise<BuildInfo>;
  getEmbedDependencies(uuid: string): Promise<EmbedDependency[]>;
  buildTest(uuid: string, opts: { signal?: AbortSignal }): Promise<BuildInfo>;
}

export const SKIP_UPLOADED = 'Uploaded binary, left as it is';
export const skipMissingFile = (names: string[]) => `Needs a file uploaded first: ${names.join(', ')}`;

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Build failed';
  const axiosErr = err as { response?: { data?: { error?: string } } };
  return axiosErr?.response?.data?.error || msg;
}

/** Builds `items` in order, one at a time. Resolves with one result per item that was reached. */
export async function runBuildQueue(
  items: BuildQueueItem[],
  deps: BuildQueueDeps,
  opts: {
    onStart?(item: BuildQueueItem, index: number): void;
    onResult?(result: BuildQueueResult): void;
    shouldStop?(): boolean;
    signal?: AbortSignal;
  },
): Promise<BuildQueueResult[]> {
  const { onStart, onResult, shouldStop, signal } = opts;
  const results: BuildQueueResult[] = [];

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted || shouldStop?.()) break;
    const item = items[i];
    onStart?.(item, i);

    let result: BuildQueueResult;
    try {
      const info = await deps.getBuildInfo(item.uuid);
      if (info.exists && info.source === 'uploaded') {
        result = { ...item, outcome: 'skipped', reason: SKIP_UPLOADED };
      } else {
        const missing = (await deps.getEmbedDependencies(item.uuid))
          .filter((d) => !d.exists && !d.sourceBuilt)
          .map((d) => d.filename);
        if (missing.length > 0) {
          result = { ...item, outcome: 'skipped', reason: skipMissingFile(missing) };
        } else {
          await deps.buildTest(item.uuid, { signal });
          result = { ...item, outcome: 'built' };
        }
      }
    } catch (err) {
      if (signal?.aborted) break;
      result = { ...item, outcome: 'failed', reason: errorMessage(err) };
    }
    if (signal?.aborted) break;
    results.push(result);
    onResult?.(result);
  }
  return results;
}
