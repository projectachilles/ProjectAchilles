import type { HostTestMatrixCell } from '@/services/api/analytics';
import type { AgentSummary } from '@/types/agent';

/** One host of the Test Breadth by Host card. */
export interface BreadthHost {
  hostname: string;
  /** False for an enrolled host with no result in the window. */
  tested: boolean;
  /** Test name -> runs in the window. */
  runsByTest: Map<string, number>;
  ranCount: number;
  /** Tests of the set this host did not run, sorted. */
  missing: string[];
  totalRuns: number;
  /** Share of the test set this host ran, 0..1. */
  breadth: number;
}

export interface BreadthModel {
  /** The test set every host is measured against, sorted. */
  tests: string[];
  /** Not tested first, then breadth ascending, then hostname. */
  hosts: BreadthHost[];
  testedCount: number;
  untestedCount: number;
}

const byName = (a: string, b: string) => a.localeCompare(b);

/**
 * Joins the host-test matrix with the baseline tests and the enrolled hosts.
 *
 * The test set is the baseline plus every test run in the window (the window's tests alone when
 * `baselineTests` is null), so a host's ran + missing always equals the set and breadth never
 * passes 100%. `enrolledHostnames` adds the hosts with no result; null means the fleet could not
 * be read, and adds none.
 */
export function buildBreadthModel(
  matrix: readonly HostTestMatrixCell[],
  baselineTests: readonly string[] | null,
  enrolledHostnames: readonly string[] | null,
): BreadthModel {
  const testSet = new Set<string>(baselineTests ?? []);
  const runs = new Map<string, Map<string, number>>();
  for (const cell of matrix) {
    testSet.add(cell.testName);
    let perTest = runs.get(cell.hostname);
    if (!perTest) runs.set(cell.hostname, (perTest = new Map()));
    perTest.set(cell.testName, (perTest.get(cell.testName) ?? 0) + cell.count);
  }
  const tests = [...testSet].sort(byName);

  const hosts: BreadthHost[] = [];
  const seen = new Set<string>();
  for (const [hostname, runsByTest] of runs) {
    seen.add(hostname.toLowerCase());
    let totalRuns = 0;
    for (const n of runsByTest.values()) totalRuns += n;
    hosts.push({
      hostname,
      tested: true,
      runsByTest,
      ranCount: runsByTest.size,
      missing: tests.filter((t) => !runsByTest.has(t)),
      totalRuns,
      breadth: tests.length > 0 ? runsByTest.size / tests.length : 0,
    });
  }
  const testedCount = hosts.length;

  for (const hostname of enrolledHostnames ?? []) {
    const key = hostname.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hosts.push({ hostname, tested: false, runsByTest: new Map(), ranCount: 0, missing: tests, totalRuns: 0, breadth: 0 });
  }

  hosts.sort(
    (a, b) => Number(a.tested) - Number(b.tested) || a.breadth - b.breadth || byName(a.hostname, b.hostname),
  );
  return { tests, hosts, testedCount, untestedCount: hosts.length - testedCount };
}

/** Shade of a tile: 0 = not tested, 1..4 = under 25%, 25-49%, 50-79%, 80% and over. */
export type BreadthStep = 0 | 1 | 2 | 3 | 4;

export function breadthStep(host: Pick<BreadthHost, 'tested' | 'breadth'>): BreadthStep {
  if (!host.tested) return 0;
  if (host.breadth >= 0.8) return 4;
  if (host.breadth >= 0.5) return 3;
  if (host.breadth >= 0.25) return 2;
  return 1;
}

export function breadthWord(breadth: number): 'Poor' | 'Fair' | 'Good' {
  if (breadth >= 0.8) return 'Good';
  if (breadth >= 0.5) return 'Fair';
  return 'Poor';
}

/**
 * Hostnames of the active agents the card should count, narrowed by the Analytics org and
 * hostname filters (an empty hostname filter does not narrow).
 */
export function selectEnrolledHostnames(
  agents: readonly Pick<AgentSummary, 'hostname' | 'org_id' | 'status'>[],
  filter: { org?: string | null; hostnames?: readonly string[] },
): string[] {
  const wanted = filter.hostnames?.length ? new Set(filter.hostnames.map((h) => h.toLowerCase())) : null;
  return agents
    .filter((a) => a.status === 'active')
    .filter((a) => !filter.org || a.org_id === filter.org)
    .filter((a) => !wanted || wanted.has(a.hostname.toLowerCase()))
    .map((a) => a.hostname);
}
