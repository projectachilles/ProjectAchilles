import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { testsApi } from '@/services/api/tests';
import {
  runBuildQueue,
  type BuildQueueDeps,
  type BuildQueueEnd,
  type BuildQueueItem,
  type BuildQueueResult,
} from '@/lib/buildQueue';

export interface BuildQueueState {
  status: 'idle' | 'running' | 'stopping' | 'done';
  total: number;
  current: BuildQueueItem | null;
  results: BuildQueueResult[];
  /** Why the run ended; null unless status is 'done'. */
  end: BuildQueueEnd | null;
}

interface BuildQueueContextValue {
  state: BuildQueueState;
  start(items: BuildQueueItem[]): boolean;
  stop(): void;
  dismiss(): void;
}

const IDLE: BuildQueueState = { status: 'idle', total: 0, current: null, results: [], end: null };

const defaultDeps: BuildQueueDeps = {
  getBuildInfo: (uuid) => testsApi.getBuildInfo(uuid),
  getEmbedDependencies: (uuid) => testsApi.getEmbedDependencies(uuid),
  buildTest: (uuid, opts) => testsApi.buildTest(uuid, opts),
};

const BuildQueueContext = createContext<BuildQueueContextValue | null>(null);

export function BuildQueueProvider({ children, deps = defaultDeps }: { children: ReactNode; deps?: BuildQueueDeps }) {
  const [state, setState] = useState<BuildQueueState>(IDLE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const controllerRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const active = state.status === 'running' || state.status === 'stopping';
  useEffect(() => {
    if (!active) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [active]);

  const start = useCallback((items: BuildQueueItem[]): boolean => {
    const status = stateRef.current.status;
    if (items.length === 0 || status === 'running' || status === 'stopping') return false;
    const controller = new AbortController();
    controllerRef.current = controller;
    stopRef.current = false;
    const next: BuildQueueState = { status: 'running', total: items.length, current: null, results: [], end: null };
    stateRef.current = next;
    setState(next);

    void runBuildQueue(items, depsRef.current, {
      signal: controller.signal,
      shouldStop: () => stopRef.current,
      onStart: (item) => {
        if (mountedRef.current) setState((s) => ({ ...s, current: item }));
      },
      onResult: (result) => {
        if (mountedRef.current) setState((s) => ({ ...s, results: [...s.results, result] }));
      },
    })
      .then((run) => {
        if (controllerRef.current !== controller) return;
        // A real unmount aborts without a state update; any other abort must
        // still end in 'done' so the provider is never stuck in 'running'.
        if (controller.signal.aborted && !mountedRef.current) return;
        setState((s) => ({ ...s, status: 'done', current: null, end: run.end }));
      })
      .catch((err: unknown) => {
        console.error('Build queue failed', err);
        if (controllerRef.current !== controller || !mountedRef.current) return;
        setState((s) => ({ ...s, status: 'done', current: null, end: 'stopped' }));
      });
    return true;
  }, []);

  const stop = useCallback(() => {
    if (stateRef.current.status !== 'running') return;
    stopRef.current = true;
    setState((s) => ({ ...s, status: 'stopping' }));
  }, []);

  const dismiss = useCallback(() => {
    if (stateRef.current.status !== 'done') return;
    setState(IDLE);
  }, []);

  const value = useMemo(() => ({ state, start, stop, dismiss }), [state, start, stop, dismiss]);
  return <BuildQueueContext.Provider value={value}>{children}</BuildQueueContext.Provider>;
}

export function useBuildQueue(): BuildQueueContextValue {
  const ctx = useContext(BuildQueueContext);
  if (!ctx) throw new Error('useBuildQueue must be used inside a BuildQueueProvider');
  return ctx;
}
