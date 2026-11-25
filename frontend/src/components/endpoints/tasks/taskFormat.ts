import type { AgentTask, TaskGroup } from '@/types/agent';

// Date, duration and name formatting shared by the task timeline and the task detail panel.

export function normalizeUtc(dateStr: string): string {
  return dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
}

export function clockTime(dateStr: string): string {
  return new Date(normalizeUtc(dateStr)).toLocaleTimeString('en-GB', { hour12: false });
}

export function dayKey(dateStr: string): string {
  return new Date(normalizeUtc(dateStr)).toDateString();
}

export function dayLabel(dateStr: string): string {
  const date = new Date(normalizeUtc(dateStr));
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'today';
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDuration(ms: number | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export function taskName(task: Pick<AgentTask, 'type' | 'payload'>): string {
  return task.payload?.test_name || task.type.replace(/_/g, ' ');
}

/**
 * What a run is called on the timeline: its test's name, the command text of
 * a command run (so two command runs can be told apart without opening them),
 * or the task type.
 */
export function runName(group: Pick<TaskGroup, 'type' | 'payload'>): { text: string; command: boolean } {
  if (group.payload?.test_name) return { text: group.payload.test_name, command: false };
  const command = group.type === 'execute_command' ? group.payload?.command?.trim() : undefined;
  if (command) return { text: command, command: true };
  return { text: group.type.replace(/_/g, ' '), command: false };
}
