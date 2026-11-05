import type { ScoreBreakdown, TestOverview } from '@/types/test';
import Panel from './Panel';

const LEGACY_LABELS: [keyof ScoreBreakdown, string][] = [
  ['realWorldAccuracy', 'Real-world accuracy'],
  ['technicalSophistication', 'Technical sophistication'],
  ['safetyMechanisms', 'Safety mechanisms'],
  ['detectionOpportunities', 'Detection opportunities'],
  ['loggingObservability', 'Logging & observability'],
];

function Bar({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-xs text-muted">{text}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--chart-protected)' }} />
      </div>
    </div>
  );
}

export default function QualityPanel({ quality }: { quality?: TestOverview['quality'] }) {
  if (!quality) return null;
  const legacyRows = quality.rubric === 'legacy'
    ? LEGACY_LABELS.filter(([k]) => quality.breakdown[k] !== undefined && quality.breakdown[k] !== null)
    : [];
  if (quality.rubric === 'v2.1' && !Number.isFinite(quality.realism) && !Number.isFinite(quality.structure) && !quality.validation) return null;
  if (quality.rubric === 'legacy' && legacyRows.length === 0 && !quality.validation) return null;

  return (
    <Panel title="Quality">
      <div className="space-y-3">
        {quality.rubric === 'v2.1' ? (
          <>
            {Number.isFinite(quality.realism) && (
              <Bar label="Realism" value={quality.realism} max={7} text={`${quality.realism} / 7`} />
            )}
            {Number.isFinite(quality.structure) && (
              <Bar label="Structure" value={quality.structure} max={3} text={`${quality.structure.toFixed(1)} / 3`} />
            )}
          </>
        ) : (
          <dl className="space-y-1">
            {legacyRows.map(([k, label]) => (
              <div key={k} className="flex items-baseline justify-between text-[13px]">
                <dt className="text-muted">{label}</dt>
                <dd className="font-mono text-xs text-foreground">{quality.breakdown[k]}</dd>
              </div>
            ))}
          </dl>
        )}
        {quality.validation && <p className="text-xs text-faint">{quality.validation}</p>}
      </div>
    </Panel>
  );
}
