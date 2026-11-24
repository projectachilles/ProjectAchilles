import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { testsApi } from '@/services/api/tests';
import {
  runBuildQueue,
  type BuildQueueDeps,
  type BuildQueueItem,
  type BuildQueueResult,
} from '@/lib/buildQueue';

export interface BuildQueueState {
  status: 'idle' | 'running' | 'stopping' | 'done';
  total: number;
  current: BuildQueueItem | null;
  results: BuildQueueResult[];
}

interface BuildQueueContextValue {
  state: BuildQueueState;
  start(items: BuildQueueItem[]): boolean;
  stop(): void;
  dismiss(): void;
}

const IDLE: BuildQueueState = { status: 'idle', total: 0, current: null, results: [] };

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

  useEffect(() => () => controllerRef.current?.abort(), []);

  const active = state.status === 'running' || state.status === 'stopping';
  useEffect(() => {
    if (!active) return;
    const guard = (e: BeforeUnloadEvent | Event) => {
      e.preventDefault();
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
    const next: BuildQueueState = { status: 'running', total: items.length, current: null, results: [] };
    stateRef.current = next;
    setState(next);

    void runBuildQueue(items, depsRef.current, {
      signal: controller.signal,
      shouldStop: () => stopRef.current,
      onStart: (item) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, current: item }));
      },
      onResult: (result) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, results: [...s.results, result] }));
      },
    }).then(() => {
      if (controller.signal.aborted) return;
      setState((s) => ({ ...s, status: 'done', current: null }));
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
