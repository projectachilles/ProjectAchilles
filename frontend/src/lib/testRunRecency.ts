// Folds per-test run history (GET /agent/admin/tasks/test-recency) into one
// answer per host for the target picker's "Not run in" filter.

export interface TestRunRecency {
  agent_id: string;
  test_uuid: string;
  /** ISO time of the most recent run that produced a result; null when none. */
  last_run_at: string | null;
  /** A run of this test is waiting for, or running on, this agent. */
  queued: boolean;
}

/**
 * How recently a host ran the selected tests, judged by the test it ran
 * longest ago:
 * - `never`: at least one selected test has no run and none queued
 * - `ran`: every selected test ran (or is queued); `at` is the oldest of those runs
 * - `queued`: every selected test is queued or running, so nothing is left to send
 */
export type HostRecency =
  | { state: 'never' }
  | { state: 'queued' }
  | { state: 'ran'; at: string };

/** Filter values: `any` (off), `never`, or a number of days as a string. */
export type RecencyWindow = 'any' | 'never' | '7' | '30' | '90';

export const RECENCY_WINDOW_OPTIONS: Array<{ value: RecencyWindow; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'never', label: 'Never run' },
];

const DAY_MS = 86_400_000;

/** One HostRecency per agent id. Agents with no task for any selected test are `never`. */
export function summarizeHostRecency(
  agentIds: readonly string[],
  testUuids: readonly string[],
  runs: readonly TestRunRecency[],
): Map<string, HostRecency> {
  const byPair = new Map<string, TestRunRecency>();
  for (const run of runs) byPair.set(`${run.agent_id}::${run.test_uuid}`, run);

  const out = new Map<string, HostRecency>();
  for (const agentId of agentIds) {
    let oldest: string | null = null;
    let never = false;
    for (const testUuid of testUuids) {
      const run = byPair.get(`${agentId}::${testUuid}`);
      if (run?.queued) continue;
      if (!run?.last_run_at) {
        never = true;
        break;
      }
      if (oldest === null || run.last_run_at < oldest) oldest = run.last_run_at;
    }
    if (never) out.set(agentId, { state: 'never' });
    else if (oldest === null) out.set(agentId, { state: 'queued' });
    else out.set(agentId, { state: 'ran', at: oldest });
  }
  return out;
}

/** Whether a host passes the "Not run in" filter. A queued host never does. */
export function matchesRecencyWindow(recency: HostRecency | undefined, window: RecencyWindow, now: number): boolean {
  if (window === 'any') return true;
  if (!recency || recency.state === 'never') return true;
  if (recency.state === 'queued' || window === 'never') return false;
  return new Date(recency.at).getTime() < now - Number(window) * DAY_MS;
}

/** Short row label: "never", "queued", "today", "12d ago". */
export function recencyLabel(recency: HostRecency | undefined, now: number): string {
  if (!recency || recency.state === 'never') return 'never';
  if (recency.state === 'queued') return 'queued';
  const days = Math.floor((now - new Date(recency.at).getTime()) / DAY_MS);
  return days <= 0 ? 'today' : `${days}d ago`;
}
