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
  /** Makes the segments buttons. */
  onSelect?: (key: string) => void;
  className?: string;
}

/**
 * One proportional bar for results too many to draw one by one, with the
 * counts written out below it. Segments with a count of 0 are left out.
 */
export function VerdictBar({ segments, activeKey = null, onSelect, className }: VerdictBarProps) {
  const shown = segments.filter((s) => s.count > 0);
  return (
    <div className={className}>
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded">
        {shown.map((s) =>
          onSelect ? (
            <button
              key={s.key}
              type="button"
              aria-label={`${s.count} ${s.label}`}
              aria-pressed={activeKey === s.key}
              title={`${s.count} ${s.label}`}
              onClick={() => onSelect(s.key)}
              style={{ flexGrow: s.count }}
              className={cn(
                'h-full min-w-[3px] basis-0 transition-[filter] hover:brightness-125',
                MARK_BG[s.tone],
                activeKey !== null && activeKey !== s.key && 'opacity-50',
              )}
            />
          ) : (
            <span key={s.key} aria-hidden="true" style={{ flexGrow: s.count }} className={cn('h-full min-w-[3px] basis-0', MARK_BG[s.tone])} />
          ),
        )}
      </div>
      {/* With buttons above, the buttons carry the names; without them this line is the only text. */}
      <div aria-hidden={onSelect ? true : undefined} className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {shown.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-[2px]', MARK_BG[s.tone])} />
            <span>{`${s.count} ${s.label}`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
