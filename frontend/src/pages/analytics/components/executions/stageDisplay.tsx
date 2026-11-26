import { Ban } from 'lucide-react';
import type { EnrichedTestExecution } from '@/services/api/analytics';
import { attackTechniqueUrl, techniqueName } from '@/lib/attackTechnique';
import { cn } from '@/lib/utils';
import type { MarkTone } from '@/components/shared/marks/markTone';
import { ExecResultLabel } from './shared';
import { stageKind, type StageKind } from './stageVerdict';

/**
 * Outcome tones for the attack-chain stage view. Text colours are the ones
 * ExecResultLabel uses for the same outcome; 'not-run' (exit 260) is the
 * stage view's own state — it is not tested, so it takes the neutral info tone.
 */
export const STAGE_TONES: Record<StageKind, { label: string; text: string; dim: string; border: string }> = {
  protected: { label: 'Protected', text: 'text-accent', dim: 'bg-accent-dim', border: 'border-accent/40' },
  prevented: { label: 'Prevented', text: 'text-accent', dim: 'bg-accent-dim', border: 'border-accent/40' },
  detected: { label: 'Detected', text: 'text-warning', dim: 'bg-warning-dim', border: 'border-warning/40' },
  unprotected: { label: 'Unprotected', text: 'text-danger', dim: 'bg-danger-dim', border: 'border-danger/40' },
  inconclusive: { label: 'Inconclusive', text: 'text-warning', dim: 'bg-warning-dim', border: 'border-warning/40' },
  'not-run': { label: 'Stage not run', text: 'text-info', dim: 'bg-info-dim', border: 'border-info/40' },
  skipped: { label: 'Skipped', text: 'text-faint', dim: 'bg-raised', border: 'border-border' },
};

/**
 * The same outcomes as small squares (a run's stages in one strip). Inconclusive
 * is grey here: beside a detected stage's amber it must not read as one.
 */
export const STAGE_MARK_TONE: Record<StageKind, MarkTone> = {
  protected: 'accent',
  prevented: 'accent',
  detected: 'warning',
  unprotected: 'danger',
  inconclusive: 'muted',
  'not-run': 'info',
  skipped: 'hollow',
};

/** A run's stages as marks for StageSquares, in stage order. */
export function stageSquareMarks(controls: EnrichedTestExecution[]): Array<{ tone: MarkTone; label: string }> {
  return controls
    .map((exec, index) => ({ exec, n: stageNumber(exec, index) }))
    .sort((a, b) => a.n - b.n)
    .map(({ exec }) => {
      const kind = stageKind(exec);
      return { tone: STAGE_MARK_TONE[kind], label: STAGE_TONES[kind].label.toLowerCase() };
    });
}

export function stageTone(exec: EnrichedTestExecution) {
  return STAGE_TONES[stageKind(exec)];
}

/** "Stage N" validators carry their number; anything else falls back to the position. */
export function stageNumber(exec: EnrichedTestExecution, index: number): number {
  const m = /^Stage (\d+)$/.exec(exec.control_validator ?? '');
  return m ? Number(m[1]) : index + 1;
}

/** The stage's technique: its control_id (the binary's technique), else its first technique. */
export function stageTechnique(exec: EnrichedTestExecution): { id: string; name?: string; url?: string } | null {
  const id = exec.control_id ?? exec.techniques?.[0];
  if (!id) return null;
  const name = techniqueName(id);
  // Only a resolved ID gets a link: an unknown/revoked ID stays bare text.
  return name ? { id, name, url: attackTechniqueUrl(id) } : { id };
}

/** Row label: ExecResultLabel, except exit 260 reads "Stage not run" instead of "Inconclusive". */
export function StageOutcomeLabel({ exec }: { exec: EnrichedTestExecution }) {
  if (stageKind(exec) !== 'not-run') return <ExecResultLabel exec={exec} compact />;
  const tone = STAGE_TONES['not-run'];
  return (
    <span className={cn('inline-flex items-center gap-1.5', tone.text)}>
      <Ban className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">{tone.label}</span>
    </span>
  );
}
