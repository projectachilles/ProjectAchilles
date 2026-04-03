import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';

interface DevProfilerProps {
  id: string;
  children: ReactNode;
}

/**
 * Thin React.Profiler wrapper that logs render counts and durations in dev mode.
 * Zero overhead in production — renders children directly.
 */
export function DevProfiler({ id, children }: DevProfilerProps) {
  if (!import.meta.env.DEV) return <>{children}</>;

  const onRender: ProfilerOnRenderCallback = (
    profilerId,
    phase,
    actualDuration,
    _baseDuration,
    startTime,
  ) => {
    // eslint-disable-next-line no-console
    console.log(
      `%c[Profiler] ${profilerId} (${phase}) — ${actualDuration.toFixed(1)}ms @ ${startTime.toFixed(0)}ms`,
      'color: #f59e0b; font-weight: bold',
    );
  };

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
