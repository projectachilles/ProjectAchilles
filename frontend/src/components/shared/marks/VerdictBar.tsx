import { cn } from '@/lib/utils';
import { MARK_BG, type MarkTone } from './markTone';

export interface BarSegment {
  key: string;
  /** Lower-case noun for the count: "unprotected", "no verdict". */
  label: string;
  tone: MarkTone;
  count: number;
}

interface VerdictBarProps {
  segments: BarSegment[];
  /** The segment whose items are listed, if any. */
  activeKey?: string | null;
  /** Makes the counts buttons, and the bar's segments clickable. */
  onSelect?: (key: string) => void;
  className?: string;
}

/**
 * One proportional bar for results too many to draw one by one, with the
 * counts written out below it. Segments with a count of 0 are left out.
 *
 * The counts are the controls: a segment can be three pixels wide (one
 * unprotected host in a run of 300), and its count is always a full-size
 * target with the number in words. Clicking a segment does the same, as a
 * shortcut for the mouse; it is hidden from assistive tech so each result
 * has one control, not two.
 */
export function VerdictBar({ segments, activeKey = null, onSelect, className }: VerdictBarProps) {
  const shown = segments.filter((s) => s.count > 0);
  return (
    <div className={className}>
      <div aria-hidden="true" className="flex h-3.5 gap-0.5 overflow-hidden rounded">
        {shown.map((s) => (
          <span
            key={s.key}
            data-segment={s.key}
            title={`${s.count} ${s.label}`}
            onClick={onSelect ? () => onSelect(s.key) : undefined}
            style={{ flexGrow: s.count }}
            className={cn(
              'h-full min-w-[3px] basis-0',
              MARK_BG[s.tone],
              onSelect && 'cursor-pointer transition-[filter] hover:brightness-125',
              activeKey !== null && activeKey !== s.key && 'opacity-50',
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {shown.map((s) => {
          const text = `${s.count} ${s.label}`;
          const swatch = <span aria-hidden="true" className={cn('h-2 w-2 rounded-[2px]', MARK_BG[s.tone])} />;
          return onSelect ? (
            <button
              key={s.key}
              type="button"
              aria-pressed={activeKey === s.key}
              onClick={() => onSelect(s.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm hover:text-foreground',
                activeKey === s.key && 'text-foreground underline underline-offset-2',
              )}
            >
              {swatch}
              {text}
            </button>
          ) : (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              {swatch}
              <span>{text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
