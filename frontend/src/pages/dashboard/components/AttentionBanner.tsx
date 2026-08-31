import { Link } from 'react-router-dom';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AttentionItem {
  id: string;
  label: string;
  to: string;
  severity: 'warning' | 'danger';
}

interface AttentionBannerProps {
  items: AttentionItem[];
  loading?: boolean;
}

export function AttentionBanner({ items, loading }: AttentionBannerProps) {
  if (loading) {
    return <div className="h-12 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-accent/30 bg-accent-dim p-3">
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
        <span className="text-sm text-accent">all clear — nothing needs attention</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-warning/40 bg-warning-dim p-3">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-warning">
        <ShieldAlert className="h-4 w-4" />
        needs attention
      </span>
      {items.map((item) => (
        <Link
          key={item.id}
          to={item.to}
          className={cn(
            'text-sm underline-offset-4 hover:underline',
            item.severity === 'danger' ? 'text-danger' : 'text-warning',
          )}
        >
          {item.label} →
        </Link>
      ))}
    </div>
  );
}
