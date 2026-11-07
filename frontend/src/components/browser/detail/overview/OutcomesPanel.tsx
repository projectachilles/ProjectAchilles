import type { TestOverview } from '@/types/test';
import Panel from './Panel';

type Outcome = NonNullable<TestOverview['expectedOutcomes']>[number];

function codeTone(code?: number): string {
  if (code === 126 || code === 105 || code === 127) return 'text-accent';
  if (code === 101) return 'text-danger';
  if (code === 999) return 'text-warning';
  return 'text-foreground';
}

export default function OutcomesPanel({ outcomes }: { outcomes?: Outcome[] }) {
  const items = outcomes ?? [];
  return (
    <Panel title="Expected outcomes" hidden={items.length === 0}>
      <ul className="space-y-2.5">
        {items.map((o, i) => (
          <li key={`${o.label}-${i}`} className="text-[13px] leading-snug">
            <div className="flex items-baseline gap-2">
              <span className={`font-medium ${codeTone(o.code)}`}>{o.label}</span>
              {o.code !== undefined && (
                <span className={`font-mono text-xs ${codeTone(o.code)}`}>{o.code}</span>
              )}
            </div>
            <p className="text-muted">{o.text}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
