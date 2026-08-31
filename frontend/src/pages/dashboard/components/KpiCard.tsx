import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  to: string;
  /** danger colors the value + icon (e.g. defense score below threshold). */
  tone?: 'default' | 'accent' | 'danger';
  loading?: boolean;
}

export function KpiCard({ label, value, sub, icon: Icon, to, tone = 'default', loading }: KpiCardProps) {
  if (loading) {
    return <div className="h-24 animate-pulse rounded-lg border border-border bg-raised" aria-hidden="true" />;
  }

  return (
    <Link
      to={to}
      className="flex flex-col rounded-lg border border-border bg-surface p-4 transition-transform hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-faint">{label}</span>
        <Icon
          className={cn('h-4 w-4 shrink-0', tone === 'danger' ? 'text-danger' : 'text-accent')}
          strokeWidth={2}
        />
      </div>
      <div
        className={cn(
          'mt-2 text-2xl font-semibold tracking-tight',
          tone === 'danger' && 'text-danger',
          tone === 'accent' && 'text-accent',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-auto truncate pt-1 text-xs text-muted">{sub}</div>}
    </Link>
  );
}
