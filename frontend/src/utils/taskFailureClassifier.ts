import type { AgentTask, TaskResult } from '@/types/agent';

/**
 * Failure classes surfaced in the UI for operator triage. Distinct enough that
 * an operator can decide an action just from the badge, without expanding the
 * row to read stderr.
 */
export type FailureClass =
  | 'edr_blocked'        // EDR/WDAC/AppLocker blocked the binary at CreateProcess
  | 'agent_offline'      // server-side expireStaleTasks marked the task failed
  | 'execution_timeout'  // task ran past its execution_timeout + buffer
  | 'binary_integrity'   // SHA256 mismatch or download failure
  | 'generic_failure';   // catch-all for anything else with status='failed'

/**
 * Pattern-match a failed task's `result` payload to determine why it failed.
 * Patterns are deliberately loose against stderr/error/stdout so they cover
 * server-written sentinels (e.g. `expireStaleTasks` writes a known JSON
 * shape) AND agent-side error strings (Go's `os/exec` wraps errors as
 * `start binary: fork/exec <path>: Access is denied.`).
 *
 * Returns `null` if the task is not in a `failed` status — UI shouldn't badge
 * pending/completed/expired with a failure-class.
 */
export function classifyFailure(task: Pick<AgentTask, 'status' | 'result'>): FailureClass | null {
  if (task.status !== 'failed') return null;

  const r = task.result;
  if (!r) return 'generic_failure';

  const haystack = [r.error ?? '', r.stderr ?? '', r.stdout ?? ''].join('\n');

  // Order matters — most specific first. EDR-block wins over generic
  // fork/exec mentions.
  if (matchesEdrBlock(haystack)) return 'edr_blocked';
  if (/Agent went offline/i.test(haystack)) return 'agent_offline';
  if (/exceeded (execution|maximum allowed) (execution )?time/i.test(haystack)) return 'execution_timeout';
  if (/SHA256 mismatch|size mismatch|download binary/i.test(haystack)) return 'binary_integrity';

  return 'generic_failure';
}

/**
 * Match the canonical Windows EDR-block signature. Go's os/exec wraps Win32
 * CreateProcess errors as `fork/exec <path>: Access is denied.` — and the
 * agent further wraps it as `start binary: fork/exec...`. Detecting both
 * tokens (`fork/exec` AND `Access is denied`) avoids false positives on
 * generic ENOENT / similar.
 */
function matchesEdrBlock(haystack: string): boolean {
  return /fork\/exec/.test(haystack) && /Access is denied/i.test(haystack);
}

/**
 * Human-readable label for each failure class. Used as the badge text.
 */
export const failureClassLabel: Record<FailureClass, string> = {
  edr_blocked: 'Blocked by endpoint policy',
  agent_offline: 'Agent offline',
  execution_timeout: 'Timed out',
  binary_integrity: 'Binary integrity',
  generic_failure: 'Failed',
};

/**
 * One-line operator hint surfaced as the badge tooltip. Keeps the row
 * compact while giving useful context on hover.
 */
export const failureClassTooltip: Record<FailureClass, string> = {
  edr_blocked: 'EDR/WDAC/AppLocker blocked the test binary at CreateProcess. Sign with an allowlisted cert or whitelist the staging path on the endpoint.',
  agent_offline: 'Server marked this task failed because the agent stopped heartbeating during execution.',
  execution_timeout: 'Task ran longer than its execution_timeout + buffer (default 300s+120s). May indicate a hung process.',
  binary_integrity: 'Binary download or SHA256 verification failed. Re-trigger; persistent failures suggest a build mismatch.',
  generic_failure: 'Task failed without a recognised cause. Expand the row for stderr.',
};

// Re-export TaskResult for convenience in tests.
export type { TaskResult };
