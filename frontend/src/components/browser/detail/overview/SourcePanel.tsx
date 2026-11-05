import type { TestOverview } from '@/types/test';
import Panel from './Panel';

/** Only http(s) URLs may become links (test metadata is user-supplied). */
export function safeHttpUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export default function SourcePanel({ source }: { source?: TestOverview['primarySource'] }) {
  if (!source) return null;
  const href = safeHttpUrl(source.url);
  const meta = [source.publisher, source.date].filter(Boolean).join(' · ');
  return (
    <Panel title="Source">
      <div className="text-[13px] leading-snug">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-accent hover:underline">
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
