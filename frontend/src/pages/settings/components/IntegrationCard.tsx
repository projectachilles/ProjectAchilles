import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IntegrationStatus = 'connected' | 'not-configured' | 'error';

interface IntegrationCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  status: IntegrationStatus;
  statusMessage?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}

function StatusBadge({ status, message }: { status: IntegrationStatus; message?: string }) {
  const statusConfig = {
    connected: {
      bg: 'bg-green-500/10',
      text: 'text-green-500',
      label: message || 'Connected',
    },
    'not-configured': {
      bg: '',
      text: 'text-muted-foreground',
      label: message || 'Not configured',
    },
    error: {
      bg: 'bg-destructive/10',
      text: 'text-destructive',
      label: message || 'Error',
    },
  };

  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'px-2 py-1 rounded-md text-xs font-medium',
        config.bg,
        config.text
      )}
    >
      {config.label}
    </span>
  );
}

export function IntegrationCard({
  icon: Icon,
  title,
  description,
  status,
  statusMessage,
  children,
  defaultExpanded = false,
}: IntegrationCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-base border-theme border-border bg-card text-card-foreground shadow-theme overflow-hidden">
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors text-left"
      >
        <div
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-base shrink-0',
            status === 'connected' && 'bg-primary/10',
            status === 'not-configured' && 'bg-muted',
            status === 'error' && 'bg-destructive/10'
          )}
        >
          <Icon
            className={cn(
              'w-5 h-5',
              status === 'connected' && 'text-primary',
              status === 'not-configured' && 'text-muted-foreground',
              status === 'error' && 'text-destructive'
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-card-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground truncate">{description}</p>
        </div>
        <StatusBadge status={status} message={statusMessage} />
        <ChevronDown
          className={cn(
            'w-5 h-5 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {/* Content - collapsible */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-in-out',
          expanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="border-t-[length:var(--theme-border-width)] border-border p-4">{children}</div>
      </div>
    </div>
  );
}
