import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';
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

// A run polls each build more slowly than the single Build & Sign (2 s): the
// per-user API limit is shared with every other page, and a run lasts hours.
const QUEUE_BUILD_POLL_MS = 5000;

const defaultDeps: BuildQueueDeps = {
  getBuildInfo: (uuid) => testsApi.getBuildInfo(uuid),
  getEmbedDependencies: (uuid) => testsApi.getEmbedDependencies(uuid),
  buildTest: (uuid, opts) => testsApi.buildTest(uuid, { ...opts, intervalMs: QUEUE_BUILD_POLL_MS }),
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

  // A run belongs to the session that started it. When the signed-in user
  // changes or signs out, end the run (aborting the build in flight) and drop
  // its results, so the next user of this tab neither inherits nor sees them.
  const { isLoaded, userId } = useAuth();
  const sessionUserRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    const user = userId ?? null;
    const previous = sessionUserRef.current;
    sessionUserRef.current = user;
    if (previous === undefined || previous === user) return;
    stopRef.current = true;
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    stateRef.current = IDLE;
    setState(IDLE);
  }, [isLoaded, userId]);

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

    // False once this run is no longer the provider's: unmounted, or ended by a session change.
    const owns = () => mountedRef.current && controllerRef.current === controller;
    // The ref moves to 'done' at once, not at the next render, so a Stop,
    // Dismiss or Start in the same tick acts on the ended run.
    const finish = (end: BuildQueueEnd) => {
      stateRef.current = { ...stateRef.current, status: 'done', current: null, end };
      setState((s) => ({ ...s, status: 'done', current: null, end }));
    };
    void runBuildQueue(items, depsRef.current, {
      signal: controller.signal,
      shouldStop: () => stopRef.current,
      onStart: (item) => {
        if (owns()) setState((s) => ({ ...s, current: item }));
      },
      onResult: (result) => {
        if (owns()) setState((s) => ({ ...s, results: [...s.results, result] }));
      },
    })
      .then((run) => {
        if (controllerRef.current !== controller) return;
        // A real unmount aborts without a state update; any other abort must
        // still end in 'done' so the provider is never stuck in 'running'.
        if (controller.signal.aborted && !mountedRef.current) return;
        finish(run.end);
      })
      .catch((err: unknown) => {
        console.error('Build queue failed', err);
        if (controllerRef.current !== controller || !mountedRef.current) return;
        finish('stopped');
      });
    return true;
  }, []);

  const stop = useCallback(() => {
    if (stateRef.current.status !== 'running') return;
    stopRef.current = true;
    // Only a running run can be stopping: a run that ended first stays done.
    setState((s) => (s.status === 'running' ? { ...s, status: 'stopping' } : s));
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
