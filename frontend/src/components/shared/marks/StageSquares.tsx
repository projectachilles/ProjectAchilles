import { cn } from '@/lib/utils';
import { MARK_BG, type MarkTone } from './markTone';

interface StageSquaresProps {
  /** One entry per stage, in order. */
  marks: Array<{ tone: MarkTone; label: string }>;
  className?: string;
}

/**
 * A strip of small squares, one per stage, read left to right. The strip is
 * one image with the stages spelled out, so colour is never the only signal.
 */
export function StageSquares({ marks, className }: StageSquaresProps) {
  const name = marks
    .map((m, i) => `${i === 0 ? 'Stage' : 'stage'} ${i + 1} ${m.label}`)
    .join(', ');
  return (
    <span role="img" aria-label={name} title={name} className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      {marks.map((m, i) => (
        <span key={i} aria-hidden="true" className={cn('h-[9px] w-[9px] rounded-[2px]', MARK_BG[m.tone])} />
      ))}
    </span>
  );
}
