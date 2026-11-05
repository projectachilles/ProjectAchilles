import Panel from './Panel';

interface SafetyPanelProps {
  safety?: string[];
  /** File that holds the full safety text; shows the "Full safety" link. */
  source?: string;
  onOpenFull: () => void;
}

export default function SafetyPanel({ safety, source, onOpenFull }: SafetyPanelProps) {
  const items = safety ?? [];
  return (
    <Panel
      title="Safety"
      hidden={items.length === 0}
      action={source ? (
        <button type="button" onClick={onOpenFull} className="text-xs text-accent hover:underline">
          Full safety →
        </button>
      ) : undefined}
    >
      <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-snug text-foreground marker:text-faint">
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </Panel>
  );
}
