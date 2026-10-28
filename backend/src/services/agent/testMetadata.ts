import { getTestMetadata } from './test-catalog.service.js';
import type { TaskTestMetadata } from '../../types/agent.js';

const EMPTY_TASK_METADATA: TaskTestMetadata = {
  category: '',
  subcategory: '',
  severity: '',
  techniques: [],
  tactics: [],
  threat_actor: '',
  target: [],
  complexity: '',
  tags: [],
  score: null,
  integrations: [],
};

/**
 * A run's test metadata: the stored copy, or the catalog's when the stored
 * copy is empty (no category, no techniques). The Tasks dialog and the
 * Browser drawer always send it empty, for runs and schedules alike.
 */
export function withCatalogMetadata(
  testUuid: string,
  metadata: Partial<TaskTestMetadata> | null | undefined,
): TaskTestMetadata {
  const stored: TaskTestMetadata = { ...EMPTY_TASK_METADATA, ...metadata };
  if (stored.category || stored.techniques.length > 0) return stored;
  const entry = getTestMetadata(testUuid);
  if (!entry) return stored;
  return {
    category: entry.category ?? '',
    subcategory: entry.subcategory ?? '',
    severity: entry.severity ?? '',
    techniques: entry.techniques ?? [],
    tactics: entry.tactics ?? [],
    threat_actor: entry.threatActor ?? '',
    target: entry.target ?? [],
    complexity: entry.complexity ?? '',
    tags: entry.tags ?? [],
    score: entry.score ?? null,
    integrations: entry.integrations ?? [],
  };
}
