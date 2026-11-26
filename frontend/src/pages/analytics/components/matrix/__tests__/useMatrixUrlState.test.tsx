import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMatrixUrlState } from '../useMatrixUrlState';

// What the matrix view keeps in the address, and what each change drops.

function setup(search: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[`/analytics${search}`]}>{children}</MemoryRouter>;
  const { result } = renderHook(() => ({ state: useMatrixUrlState(), search: useLocation().search }), { wrapper });
  const params = () => Object.fromEntries(new URLSearchParams(result.current.search));
  return { result, params };
}

describe('useMatrixUrlState', () => {
  it('reads the view, the pair and the run', () => {
    const { result } = setup('?tab=executions&view=matrix&pairTest=t1&pairHost=org-1%7CHOST-01&run=run-2');

    expect(result.current.state).toMatchObject({ view: 'matrix', pair: { testUuid: 't1', hostKey: 'org-1|HOST-01' }, runKey: 'run-2' });
  });

  it('takes anything but matrix or list as no view at all', () => {
    expect(setup('?view=grid').result.current.state.view).toBeNull();
    expect(setup('').result.current.state.view).toBeNull();
  });

  it('has no pair without both of its halves', () => {
    expect(setup('?pairTest=t1').result.current.state.pair).toBeNull();
    expect(setup('?pairHost=org-1%7CHOST-01').result.current.state.pair).toBeNull();
  });

  it('opening a pair drops the run of the pair before, and keeps everything else', () => {
    const { result, params } = setup('?tab=executions&hostnames=HOST-01&pairTest=t1&pairHost=org-1%7CHOST-01&run=run-2');

    act(() => result.current.state.setPair({ testUuid: 't2', hostKey: 'org-1|HOST-09' }));

    expect(params()).toEqual({ tab: 'executions', hostnames: 'HOST-01', pairTest: 't2', pairHost: 'org-1|HOST-09' });
  });

  it('closing the pair drops the pair and its run', () => {
    const { result, params } = setup('?tab=executions&pairTest=t1&pairHost=org-1%7CHOST-01&run=run-2');

    act(() => result.current.state.setPair(null));

    expect(params()).toEqual({ tab: 'executions' });
  });

  it('sets and removes the run alone', () => {
    const { result, params } = setup('?pairTest=t1&pairHost=h');

    act(() => result.current.state.setRunKey('run-1'));
    expect(params()).toEqual({ pairTest: 't1', pairHost: 'h', run: 'run-1' });
    act(() => result.current.state.setRunKey(null));
    expect(params()).toEqual({ pairTest: 't1', pairHost: 'h' });
  });

  it('going to the list drops the matrix\'s pair and run; going to the matrix drops the list\'s selection', () => {
    const { result, params } = setup('?tab=executions&pairTest=t1&pairHost=h&run=run-1');

    act(() => result.current.state.setView('list'));
    expect(params()).toEqual({ tab: 'executions', view: 'list' });

    const other = setup('?tab=executions&view=list&expanded=some-run');
    act(() => other.result.current.state.setView('matrix'));
    expect(other.params()).toEqual({ tab: 'executions', view: 'matrix' });
  });
});
