import { describe, it, expect } from 'vitest';
import type { HostTestMatrixCell } from '@/services/api/analytics';
import { buildBreadthModel, breadthStep, breadthWord, selectEnrolledHostnames } from '../testBreadth';

const cell = (hostname: string, testName: string, count = 1): HostTestMatrixCell => ({ hostname, testName, count });
const host = (model: ReturnType<typeof buildBreadthModel>, name: string) => {
  const h = model.hosts.find((x) => x.hostname === name);
  if (!h) throw new Error(`host ${name} not in model`);
  return h;
};

describe('buildBreadthModel', () => {
  it('test set is the baseline plus the tests run in the window', () => {
    const m = buildBreadthModel([cell('h1', 'A'), cell('h1', 'D')], ['A', 'B', 'C'], null);
    expect(m.tests).toEqual(['A', 'B', 'C', 'D']);
    const h1 = host(m, 'h1');
    expect(h1.ranCount).toBe(2);
    expect(h1.missing).toEqual(['B', 'C']);
    expect(h1.breadth).toBe(0.5);
  });

  it('window mode uses only the tests run in the window', () => {
    const m = buildBreadthModel([cell('h1', 'A'), cell('h2', 'B')], null, null);
    expect(m.tests).toEqual(['A', 'B']);
    expect(host(m, 'h1').breadth).toBe(0.5);
    expect(host(m, 'h1').missing).toEqual(['B']);
  });

  it('ran + missing equals the set size for every host', () => {
    const m = buildBreadthModel(
      [cell('h1', 'A'), cell('h1', 'B'), cell('h2', 'Z'), cell('h3', 'A')],
      ['A', 'B', 'C', 'D', 'E', 'F'],
      ['h1', 'h2', 'h3', 'h4'],
    );
    for (const h of m.hosts) expect(h.ranCount + h.missing.length).toBe(m.tests.length);
  });

  it('breadth never exceeds 100% when the window is longer than the baseline', () => {
    const m = buildBreadthModel([cell('h1', 'A'), cell('h1', 'OLD1'), cell('h1', 'OLD2')], ['A'], null);
    expect(host(m, 'h1').breadth).toBe(1);
  });

  it('an enrolled host with no row is not tested', () => {
    const m = buildBreadthModel([cell('h1', 'A')], ['A', 'B'], ['h1', 'h9']);
    const h9 = host(m, 'h9');
    expect(h9.tested).toBe(false);
    expect(h9.ranCount).toBe(0);
    expect(h9.breadth).toBe(0);
    expect(h9.missing).toEqual(['A', 'B']);
    expect(m.untestedCount).toBe(1);
    expect(m.testedCount).toBe(1);
  });

  it('hostname match ignores case and keeps the name from the results', () => {
    const m = buildBreadthModel([cell('LAP-X', 'A')], ['A'], ['lap-x']);
    expect(m.hosts.map((h) => h.hostname)).toEqual(['LAP-X']);
    expect(m.hosts[0].tested).toBe(true);
    expect(m.untestedCount).toBe(0);
  });

  it('duplicate enrolled hostnames give one host', () => {
    const m = buildBreadthModel([cell('h1', 'A')], ['A'], ['h9', 'H9', 'h9']);
    expect(m.hosts.filter((h) => h.hostname.toLowerCase() === 'h9')).toHaveLength(1);
    expect(m.untestedCount).toBe(1);
  });

  it('enrolled null adds no host', () => {
    const m = buildBreadthModel([cell('h1', 'A')], ['A'], null);
    expect(m.hosts).toHaveLength(1);
    expect(m.untestedCount).toBe(0);
  });

  it('orders hosts: not tested, then breadth ascending, then hostname', () => {
    const m = buildBreadthModel(
      [cell('full', 'A'), cell('full', 'B'), cell('b-half', 'A'), cell('a-half', 'B')],
      ['A', 'B'],
      ['zz-none', 'aa-none', 'full'],
    );
    expect(m.hosts.map((h) => h.hostname)).toEqual(['aa-none', 'zz-none', 'a-half', 'b-half', 'full']);
  });

  it('totalRuns sums the cell counts and keeps runs per test', () => {
    const h1 = host(buildBreadthModel([cell('h1', 'A', 3), cell('h1', 'B', 4)], ['A', 'B'], null), 'h1');
    expect(h1.totalRuns).toBe(7);
    expect(h1.runsByTest.get('B')).toBe(4);
  });

  it('an empty matrix with enrolled hosts lists them against the baseline', () => {
    const m = buildBreadthModel([], ['A', 'B'], ['h1']);
    expect(m.tests).toEqual(['A', 'B']);
    expect(m.hosts).toHaveLength(1);
    expect(m.hosts[0].missing).toEqual(['A', 'B']);
  });
});

describe('breadthStep', () => {
  it('is 0 for a host that was not tested', () => {
    expect(breadthStep({ tested: false, breadth: 0 })).toBe(0);
  });
  it.each([
    [0.17, 1], [0.249, 1], [0.25, 2], [0.49, 2], [0.5, 3], [0.79, 3], [0.8, 4], [1, 4],
  ])('breadth %s is step %s', (breadth, step) => {
    expect(breadthStep({ tested: true, breadth })).toBe(step);
  });
});

describe('breadthWord', () => {
  it.each([[0.49, 'Poor'], [0.5, 'Fair'], [0.79, 'Fair'], [0.8, 'Good']])('%s is %s', (b, w) => {
    expect(breadthWord(b)).toBe(w);
  });
});

describe('selectEnrolledHostnames', () => {
  // The agent list carries no organization id: the server narrows it by organization.
  const agents = [
    { hostname: 'LAP-X', status: 'active' as const },
    { hostname: 'lap-y', status: 'active' as const },
    { hostname: 'gone', status: 'decommissioned' as const },
    { hostname: 'off', status: 'disabled' as const },
  ];

  it('keeps active agents only', () => {
    expect(selectEnrolledHostnames(agents, {})).toEqual(['LAP-X', 'lap-y']);
  });
  it('narrows by the hostname filter, ignoring case', () => {
    expect(selectEnrolledHostnames(agents, { hostnames: ['lap-x'] })).toEqual(['LAP-X']);
  });
  it('an empty hostname filter does not narrow', () => {
    expect(selectEnrolledHostnames(agents, { hostnames: [] })).toHaveLength(2);
  });
});
