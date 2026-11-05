import TechniqueBadge from '@/components/browser/TechniqueBadge';
import type { StageInfo } from '@/types/test';

/**
 * Per-stage outcome shown under a stage card: a fleet split (PR 3) or, with no
 * fleet runs, the lab outcome from the info card (PR 2).
 */
export type StagePillData =
  | { blocked: number; detected: number; through: number; sharedWith?: number[] }
  | { lab: string };

interface StageChainProps {
  stages: StageInfo[];
  /** Keyed by `stageId`; a stage without an entry shows no pill. */
  pills?: Record<number, StagePillData>;
}

// Static class names so Tailwind generates them. Columns follow the width of
// the chain's own column (container query), not the viewport.
const COLS: Record<number, string> = {
  1: '@xl:grid-cols-1',
  2: '@xl:grid-cols-2',
  3: '@xl:grid-cols-3',
  4: '@xl:grid-cols-4',
  5: '@xl:grid-cols-5',
  6: '@xl:grid-cols-6',
};

/** One row up to six stages; above that, two rows (at most six per row). */
export function stageColumns(count: number): number {
  if (count <= 6) return Math.max(count, 1);
  return Math.min(Math.ceil(count / 2), 6);
}

function Pill({ data }: { data: StagePillData }) {
  if ('lab' in data) {
    return <p className="mt-2 text-[11px] text-muted">{data.lab}</p>;
  }
  return (
    <div className="mt-2 space-y-0.5 text-[11px] text-muted">
      <p>{`${data.blocked} blocked · ${data.detected} detected · ${data.through} through`}</p>
      {data.sharedWith && data.sharedWith.length > 0 && (
        <p className="text-faint">{`shared with stage ${data.sharedWith.join(', ')}`}</p>
      )}
    </div>
  );
}

export default function StageChain({ stages, pills }: StageChainProps) {
  const ordered = [...stages].sort((a, b) => a.stageId - b.stageId);
  const cols = COLS[stageColumns(ordered.length)];

  return (
    <div className="@container">
      <ol aria-label="Stages" className={`grid grid-cols-1 gap-2 @sm:grid-cols-2 ${cols}`}>
        {ordered.map((stage) => {
          const techniques = stage.techniques?.length ? stage.techniques : [stage.technique];
          const pill = pills?.[stage.stageId];
          return (
            <li key={stage.stageId} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3">
              <span className="font-mono text-xs text-faint">{String(stage.stageId).padStart(2, '0')}</span>
              <p className="mt-1 break-words text-[13px] font-medium leading-snug text-foreground">{stage.name}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {techniques.map((t) => <TechniqueBadge key={t} technique={t} size="sm" />)}
              </div>
              {pill && <Pill data={pill} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
