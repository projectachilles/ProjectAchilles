import { cn } from '@/lib/utils';
import { MARK_BG, type MarkTone } from '@/components/shared/marks/markTone';
import type { MatrixCell, MatrixHost, MatrixRatio } from '@/services/api/analytics';
import { VERDICT_META, ageText, cellLabel, gaugePercent } from './matrixModel';

/** The three forms that draw one mark per host; a bar draws the row as a whole. */
export type MarkForm = 'tile' | 'small' | 'squares';

/** A tile's colours per tone: the state's own colour on a dim ground. */
const TILE_TONE: Record<MarkTone, string> = {
  accent: 'border-accent/30 bg-accent-dim text-accent',
  warning: 'border-warning/30 bg-warning-dim text-warning',
  danger: 'border-danger/30 bg-danger-dim text-danger',
  info: 'border-info/30 bg-info-dim text-info',
  muted: 'border-border bg-raised text-muted',
  hollow: 'border-dashed border-border-strong bg-transparent text-faint',
};

const SHAPE: Record<MarkForm, string> = {
  tile: 'h-[50px] w-full min-w-0 rounded-[7px] border px-2 py-1.5',
  small: 'h-[30px] w-full min-w-0 rounded-[5px] border',
  squares: 'aspect-square w-full max-w-3.5 min-w-0 rounded-[2px]',
};

/**
 * A bundle's controls on one host: the compliant share, filled. The same
 * classes whatever the share: the width says it, no threshold picks a colour.
 */
function Gauge({ ratio, className }: { ratio: MatrixRatio; className?: string }) {
  const percent = gaugePercent(ratio);
  return (
    <span aria-hidden="true" className={cn('block overflow-hidden rounded-[2px]', percent === null ? 'bg-faint/40' : 'bg-danger/50', className)}>
      {percent !== null && <span data-testid="gauge-fill" className="block h-full bg-accent" style={{ width: `${percent}%` }} />}
    </span>
  );
}

interface MatrixCellMarkProps {
  form: MarkForm;
  host: MatrixHost;
  /** Absent: the test never ran on this host in the window. */
  cell: MatrixCell | undefined;
  /** This pair's runs are shown under the row. */
  open: boolean;
  onToggle: () => void;
  now: number;
}

/** One test on one host: a button that opens the pair's runs, or a hollow mark where it never ran. */
export function MatrixCellMark({ form, host, cell, open, onToggle, now }: MatrixCellMarkProps) {
  const label = cellLabel(host, cell, now);

  if (!cell) {
    return (
      <span
        role="img"
        data-testid="matrix-mark"
        aria-label={label}
        title={label}
        className={cn(
          'grid place-items-center text-[11px]',
          SHAPE[form],
          form === 'squares' ? MARK_BG.hollow : TILE_TONE.hollow,
        )}
      />
    );
  }

  const meta = cell.verdict ? VERDICT_META[cell.verdict] : null;
  const shared = {
    type: 'button' as const,
    'data-testid': 'matrix-mark',
    'data-matrix-mark': '',
    'aria-label': label,
    'aria-expanded': open,
    title: label,
    onClick: onToggle,
  };
  const focus = 'outline-offset-1 hover:outline hover:outline-1 hover:outline-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
  const opened = open && 'outline outline-2 outline-accent';

  if (form === 'squares') {
    return cell.ratio ? (
      <button {...shared} className={cn(SHAPE.squares, 'overflow-hidden', focus, opened)}>
        <Gauge ratio={cell.ratio} className="h-full rounded-none" />
      </button>
    ) : (
      <button {...shared} className={cn(SHAPE.squares, MARK_BG[meta?.tone ?? 'muted'], focus, opened)} />
    );
  }

  if (cell.ratio) {
    return (
      <button {...shared} className={cn(SHAPE[form], 'flex flex-col justify-center gap-1 border-border bg-raised text-left', form === 'small' && 'px-1', focus, opened)}>
        {form === 'tile' && (
          <span className="flex items-baseline justify-between gap-1">
            <span className="truncate font-mono text-[12px] font-semibold text-foreground">
              {cell.ratio.compliant}/{cell.ratio.evaluated}
            </span>
            <span className="shrink-0 text-[11px] text-muted">{ageText(cell.at, now)}</span>
          </span>
        )}
        <Gauge ratio={cell.ratio} className="h-1.5 w-full" />
      </button>
    );
  }

  const tone = TILE_TONE[meta?.tone ?? 'muted'];
  if (form === 'small') {
    return (
      <button {...shared} className={cn(SHAPE.small, 'grid place-items-center text-[12px] font-bold', tone, focus, opened)}>
        <span aria-hidden="true">{meta?.glyph}</span>
      </button>
    );
  }

  return (
    <button {...shared} className={cn(SHAPE.tile, 'grid grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-1.5 text-left', tone, focus, opened)}>
      <span aria-hidden="true" className="text-[15px] font-bold leading-tight">{meta?.glyph}</span>
      <span className="self-center text-right text-[11px] text-muted">{ageText(cell.at, now)}</span>
      <span aria-hidden="true" className="col-span-2 inline-flex h-1.5 items-center gap-[3px]">
        {cell.earlier?.map((verdict, i) => (
          <span key={i} data-testid="earlier-dot" data-verdict={verdict} className={cn('h-1.5 w-1.5 rounded-full', MARK_BG[VERDICT_META[verdict].tone])} />
        ))}
      </span>
    </button>
  );
}
