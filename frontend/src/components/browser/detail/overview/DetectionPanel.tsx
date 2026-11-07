import type { TestOverview } from '@/types/test';
import Panel from './Panel';

const TOP = 4;

interface DetectionPanelProps {
  audit?: TestOverview['detectionAudit'];
  /** Omit when there is no info card to open; the "All n" action is then hidden. */
  onOpenAll?: () => void;
}

export default function DetectionPanel({ audit, onOpenAll }: DetectionPanelProps) {
  const rows = audit ?? [];
  return (
    <Panel
      title="Detection"
      hidden={rows.length === 0}
      action={onOpenAll ? (
        <button type="button" onClick={onOpenAll} className="text-xs text-accent hover:underline">
          {`All ${rows.length} →`}
        </button>
      ) : undefined}
    >
      <ul className="divide-y divide-border">
        {rows.slice(0, TOP).map((r, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-[13px] first:pt-0 last:pb-0">
            {r.stage !== undefined && <span className="font-mono text-xs text-faint">{String(r.stage).padStart(2, '0')}</span>}
            <span className="font-medium text-foreground">{r.primitive}</span>
            <span className="text-muted">{r.sensor}</span>
            <span className="min-w-0 break-words font-mono text-xs text-faint">{r.pattern}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
