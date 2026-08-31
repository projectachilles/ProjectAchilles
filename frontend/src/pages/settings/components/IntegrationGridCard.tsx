import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { IntegrationStatus } from './IntegrationCard';

interface IntegrationGridCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  status: IntegrationStatus;
  /** The existing configuration form, rendered inside the configure dialog. */
  children: ReactNode;
}

const STATUS_VARIANT: Record<IntegrationStatus, 'accent' | 'default' | 'high'> = {
  connected: 'accent',
  'not-configured': 'default',
  error: 'high',
};

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: 'connected',
  'not-configured': 'not configured',
  error: 'error',
};

/** Handoff §6 integrations card: name + mono status badge, description, Configure footer. */
export function IntegrationGridCard({
  icon: Icon,
  title,
  description,
  status,
  children,
}: IntegrationGridCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            className={cn('h-4 w-4 shrink-0', status === 'connected' ? 'text-accent' : 'text-faint')}
          />
          <h3 className="truncate text-sm font-semibold tracking-tight">{title}</h3>
        </span>
        <Badge variant={STATUS_VARIANT[status]} className="font-mono uppercase">
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      <p className="mt-2 flex-1 text-xs text-muted">{description}</p>
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Configure
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configure — {title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </div>
  );
}
