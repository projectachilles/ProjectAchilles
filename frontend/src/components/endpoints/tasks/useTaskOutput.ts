import { useEffect, useState } from 'react';
import { agentApi } from '@/services/api/agent';
import type { AgentTask } from '@/types/agent';

export type TaskOutput =
  | { state: 'ready'; stdout: string; stderr: string }
  | { state: 'loading' }
  | { state: 'error'; retry: () => void };

/**
 * The stdout and stderr of the task a detail panel shows.
 *
 * The task list gets light results (`summary: true`, no output), so the
 * output of the one task being looked at is fetched by id. A result that came
 * whole (a backend without light results) is used as it is.
 */
export function useTaskOutput(task: AgentTask): TaskOutput {
  const needed = task.result?.summary === true;
  // One fetch per finished run of a task: the list refreshes with new objects
  // for the same task, and a result does not change once it is in.
  const key = `${task.id}|${task.completed_at ?? ''}`;
  const [loaded, setLoaded] = useState<{ key: string; stdout: string; stderr: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needed) return;
    // An answer for a task that is no longer the one shown is dropped.
    let current = true;
    agentApi.getTask(task.id).then(
      (full) => {
        if (current) setLoaded({ key, stdout: full.result?.stdout ?? '', stderr: full.result?.stderr ?? '' });
      },
      () => {
        if (current) setFailedKey(key);
      },
    );
    return () => {
      current = false;
    };
  }, [needed, key, task.id, attempt]);

  if (!needed) return { state: 'ready', stdout: task.result?.stdout ?? '', stderr: task.result?.stderr ?? '' };
  if (loaded?.key === key) return { state: 'ready', stdout: loaded.stdout, stderr: loaded.stderr };
  if (failedKey === key) {
    return {
      state: 'error',
      retry: () => {
        setFailedKey(null);
        setAttempt((n) => n + 1);
      },
    };
  }
  return { state: 'loading' };
}
