import { isAxiosError } from 'axios';
import { apiClient } from '@/hooks/useAuthenticatedApi';

/** One execution (a stage of an Executions row) to find related alerts for. */
export interface AlertsForTestItem {
  techniques: string[];
  timestamp: string;
  windowMinutes?: number;
  hostname?: string;
  binaryName?: string;
  bundleName?: string;
}

/** The backend accepts at most this many items per request. */
const MAX_ITEMS = 100;

/**
 * Related alerts for many executions with one POST per vendor
 * (`<base>/correlation/alerts-for-tests`) instead of one GET per stage. If
 * the backend has no batch route (404/405: an older backend during a deploy,
 * or the serverless backend), falls back to `single` per item. Results come
 * back in input order; null where that item failed.
 */
export async function requestAlertsForTests<T>(
  path: string,
  items: AlertsForTestItem[],
  single: (item: AlertsForTestItem) => Promise<T>,
): Promise<Array<T | null>> {
  if (items.length === 0) return [];
  const chunks: AlertsForTestItem[][] = [];
  for (let i = 0; i < items.length; i += MAX_ITEMS) chunks.push(items.slice(i, i + MAX_ITEMS));

  try {
    const pages = await Promise.all(
      chunks.map(async (chunk) => {
        const res = await apiClient.post<{ results: Array<T | null> }>(path, {
          items: chunk.map((item) => ({ windowMinutes: 30, ...item })),
        });
        return res.data.results;
      }),
    );
    return pages.flat();
  } catch (err) {
    const status = isAxiosError(err) ? err.response?.status : undefined;
    if (status !== 404 && status !== 405) return items.map(() => null);
    return Promise.all(items.map((item) => single(item).catch(() => null)));
  }
}
