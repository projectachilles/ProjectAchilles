import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PairRef } from './MatrixRow';

export type ExecutionsViewName = 'matrix' | 'list';
/** Which way the matrix is turned: a row per test, or a row per host. */
export type MatrixRows = 'tests' | 'hosts';

/**
 * What the matrix view keeps in the address, so a link reopens the same
 * thing: the view, which way the matrix is turned, the open pair and the run
 * shown in the drawer. `expanded=` stays the List view's selection and is
 * dropped on the way to the matrix; what is the matrix's is dropped on the
 * way to the list.
 */
export function useMatrixUrlState() {
  const [params, setParams] = useSearchParams();
  const viewParam = params.get('view');
  const view: ExecutionsViewName | null = viewParam === 'matrix' || viewParam === 'list' ? viewParam : null;
  const pairTest = params.get('pairTest');
  const pairHost = params.get('pairHost');
  const pair = useMemo<PairRef | null>(() => (pairTest && pairHost ? { testUuid: pairTest, hostKey: pairHost } : null), [pairTest, pairHost]);
  const runKey = params.get('run');
  const rowsParam = params.get('rows');
  const rows: MatrixRows | null = rowsParam === 'tests' || rowsParam === 'hosts' ? rowsParam : null;

  // One update per change: two updates in one tick would each start from the same address.
  const update = useCallback(
    (change: (next: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          change(next);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setView = useCallback(
    (next: ExecutionsViewName) =>
      update((p) => {
        p.set('view', next);
        if (next === 'matrix') p.delete('expanded');
        else for (const key of ['rows', 'pairTest', 'pairHost', 'run']) p.delete(key);
      }),
    [update],
  );

  /** Turn the matrix. The open pair closes: its host or test may not be on the other side's page. */
  const setRows = useCallback(
    (next: MatrixRows) =>
      update((p) => {
        p.set('view', 'matrix');
        p.set('rows', next);
        for (const key of ['pairTest', 'pairHost', 'run']) p.delete(key);
      }),
    [update],
  );

  /** Open a pair (or close it with null); the run of the previous pair goes with it. */
  const setPair = useCallback(
    (next: PairRef | null) =>
      update((p) => {
        p.delete('run');
        if (next) {
          // The address then opens the matrix for anyone, whatever view their browser remembers.
          p.set('view', 'matrix');
          p.set('pairTest', next.testUuid);
          p.set('pairHost', next.hostKey);
        } else {
          p.delete('pairTest');
          p.delete('pairHost');
        }
      }),
    [update],
  );

  const setRunKey = useCallback(
    (next: string | null) =>
      update((p) => {
        if (next) p.set('run', next);
        else p.delete('run');
      }),
    [update],
  );

  return { view, setView, rows, setRows, pair, setPair, runKey, setRunKey };
}
