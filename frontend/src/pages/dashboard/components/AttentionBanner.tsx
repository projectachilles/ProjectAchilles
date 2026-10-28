import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface AttentionItem {
  id: string;
  /** Shown in front of the label; omitted for yes/no problems (sync failed). */
  count?: number;
  /** Short chip text, e.g. "offline". */
  label: string;
  /** Full sentence, used as the tooltip and the link's accessible name. */
  title: string;
  to: string;
  severity: 'warning' | 'danger';
}

interface AttentionBannerProps {
  items: AttentionItem[];
  loading?: boolean;
}

// Sans, like the KPI labels below it; the chips match the time-range chips beside it.
const rowLabel = 'mr-1 font-sans text-[11px] uppercase tracking-wider text-faint';

/** Quiet count chips under the dashboard header; each opens the page that explains it. */
export function AttentionBanner({ items, loading }: AttentionBannerProps) {
  if (loading) {
    return <div className="h-7 w-80 max-w-full animate-pulse rounded-md bg-raised" aria-hidden="true" />;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
      <span className={rowLabel}>attention</span>
      {items.length === 0 ? (
        <span className="flex items-center gap-1.5 text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          all clear
        </span>
      ) : (
        items.map((item) => (
          <Link
            key={item.id}
            to={item.to}
            title={item.title}
            aria-label={item.title}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 text-muted transition-colors hover:bg-overlay hover:text-foreground"
          >
            <span
              data-severity={item.severity}
              aria-hidden="true"
              className={cn('h-1.5 w-1.5 rounded-full', item.severity === 'danger' ? 'bg-danger' : 'bg-warning')}
            />
            {item.count !== undefined && <span className="text-foreground">{item.count}</span>}
            {item.label}
          </Link>
        ))
      )}
    </div>
  );
}
