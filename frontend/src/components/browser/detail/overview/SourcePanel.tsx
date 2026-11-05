import type { TestOverview } from '@/types/test';
import Panel from './Panel';

export default function SourcePanel({ source }: { source?: TestOverview['primarySource'] }) {
  if (!source) return null;
  const meta = [source.publisher, source.date].filter(Boolean).join(' · ');
  return (
    <Panel title="Source">
      <div className="text-[13px] leading-snug">
        {source.url ? (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-accent hover:underline">
            {source.title}
          </a>
        ) : (
          <p className="text-foreground">{source.title}</p>
        )}
        {meta && <p className="mt-0.5 text-xs text-faint">{meta}</p>}
      </div>
    </Panel>
  );
}
