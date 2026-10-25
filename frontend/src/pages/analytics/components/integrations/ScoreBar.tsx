import { formatScore } from './heroMetrics';

interface ScoreBarProps {
  label: string;
  /** 0-100. Nothing renders for a non-finite value. */
  value: number;
  /** Tailwind width class for the label column (long labels need more room). */
  labelClassName?: string;
}

/** One labelled 0-100 bar on a posture-score tile (ZTA, Endpoint Protection). */
export default function ScoreBar({ label, value, labelClassName = 'w-11' }: ScoreBarProps) {
  if (!Number.isFinite(value)) return null;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={`${labelClassName} shrink-0 truncate`}>{label}</span>
      <div
        role="meter"
        aria-label={`${label} score`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-foreground">{formatScore(value)}</span>
    </div>
  );
}
