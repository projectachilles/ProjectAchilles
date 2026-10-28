import type { TaskType } from '@/types/agent';

export type TaskKind = 'tests' | 'commands' | 'maintenance' | 'all';

/** The Tasks page type pills. Security tests is the default; maintenance is agent upkeep. */
export const TASK_KINDS: ReadonlyArray<{ id: TaskKind; label: string; types: TaskType[] }> = [
  { id: 'tests', label: 'Security tests', types: ['execute_test'] },
  { id: 'commands', label: 'Commands', types: ['execute_command'] },
  { id: 'maintenance', label: 'Maintenance', types: ['update_agent', 'uninstall'] },
  { id: 'all', label: 'All', types: [] },
];

export const DEFAULT_TASK_KIND: TaskKind = 'tests';

export function typesForKind(kind: TaskKind): TaskType[] {
  return TASK_KINDS.find((k) => k.id === kind)?.types ?? [];
}

/** Tasks a pill would list, from the backend's per-type counts; null when the backend sends none. */
export function kindCount(kind: TaskKind, counts: Partial<Record<TaskType, number>> | undefined): number | null {
  if (!counts) return null;
  const types = typesForKind(kind);
  const pick = types.length > 0 ? types : (Object.keys(counts) as TaskType[]);
  return pick.reduce((sum, t) => sum + (counts[t] ?? 0), 0);
}
