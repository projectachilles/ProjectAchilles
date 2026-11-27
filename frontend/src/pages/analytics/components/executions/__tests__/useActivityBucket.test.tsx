import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useActivityBucket } from '../useActivityBucket';

// The bucket of the activity strip that All Executions is narrowed to, kept in the address.

const FROM = '2026-11-16T04:00:00.000Z';
const TO = '2026-11-17T03:59:59.999Z';
const BUCKET = `bucketFrom=${encodeURIComponent(FROM)}&bucketTo=${encodeURIComponent(TO)}`;

function setup(search: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[`/analytics${search}`]}>{children}</MemoryRouter>;
  const { result } = renderHook(() => ({ state: useActivityBucket(), search: useLocation().search }), { wrapper });
  const params = () => Object.fromEntries(new URLSearchParams(result.current.search));
  return { result, params };
}

describe('useActivityBucket', () => {
  it('reads the bucket from its two instants', () => {
    const { result } = setup(`?tab=executions&${BUCKET}`);
    expect(result.current.state.bucket).toEqual({ from: FROM, to: TO });
  });

  it('has none without them', () => {
    expect(setup('?tab=executions').result.current.state.bucket).toBeNull();
  });

  it.each([
    ['one instant alone', `?bucketFrom=${encodeURIComponent(FROM)}`],
    ['the other alone', `?bucketTo=${encodeURIComponent(TO)}`],
    ['a value that is no date', `?bucketFrom=tuesday&bucketTo=${encodeURIComponent(TO)}`],
    ['an end before its start', `?bucketFrom=${encodeURIComponent(TO)}&bucketTo=${encodeURIComponent(FROM)}`],
    ['an end equal to its start', `?bucketFrom=${encodeURIComponent(FROM)}&bucketTo=${encodeURIComponent(FROM)}`],
  ])('ignores %s, and takes it out of the address', (_name, search) => {
    const { result, params } = setup(`${search}&tab=executions&hostnames=HOST-01`);

    expect(result.current.state.bucket).toBeNull();
    expect(params()).toEqual({ tab: 'executions', hostnames: 'HOST-01' });
  });

  it('keeps one object while the address does not change, so it can be a dependency', () => {
    const { result } = setup(`?${BUCKET}`);
    const first = result.current.state.bucket;
    act(() => result.current.state.setBucket({ from: FROM, to: TO }));
    expect(result.current.state.bucket).toBe(first);
  });

  it('selecting writes both instants and closes the open pair and its run, which may not be in the bucket', () => {
    const { result, params } = setup('?tab=executions&view=matrix&rows=hosts&hostnames=HOST-01&pairTest=t1&pairHost=org-1%7CHOST-01&run=run-2');

    act(() => result.current.state.setBucket({ from: FROM, to: TO }));

    expect(params()).toEqual({ tab: 'executions', view: 'matrix', rows: 'hosts', hostnames: 'HOST-01', bucketFrom: FROM, bucketTo: TO });
  });

  it('leaves the list\'s selected run alone: without it a link to a run would lose the list', () => {
    const { result, params } = setup('?tab=executions&expanded=run-9');

    act(() => result.current.state.setBucket({ from: FROM, to: TO }));

    expect(params()).toEqual({ tab: 'executions', expanded: 'run-9', bucketFrom: FROM, bucketTo: TO });
  });

  it('clearing removes both instants, and closes the pair opened inside the bucket', () => {
    const { result, params } = setup(`?tab=executions&${BUCKET}&pairTest=t1&pairHost=org-1%7CHOST-01&run=run-2`);

    act(() => result.current.state.setBucket(null));

    expect(result.current.state.bucket).toBeNull();
    expect(params()).toEqual({ tab: 'executions' });
  });

  it('moving to another bucket replaces the first', () => {
    const { result, params } = setup(`?${BUCKET}`);
    const next = { from: '2026-11-17T04:00:00.000Z', to: '2026-11-18T03:59:59.999Z' };

    act(() => result.current.state.setBucket(next));

    expect(result.current.state.bucket).toEqual(next);
    expect(params()).toEqual({ bucketFrom: next.from, bucketTo: next.to });
  });
});
