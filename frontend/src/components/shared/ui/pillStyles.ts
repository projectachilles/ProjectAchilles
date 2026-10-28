import { cn } from '@/lib/utils';

// The console's pill tab / toggle (handoff §6): Settings and Analytics tabs,
// the agent detail tabs, filter chips. Active = dim accent, never a solid fill.
export function pillClass(active: boolean, className?: string): string {
  return cn(
    'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 text-[13px] font-medium transition-colors',
    active ? 'border-accent/25 bg-accent-dim text-accent' : 'border-border bg-raised text-muted hover:bg-overlay hover:text-foreground',
    className,
  );
}
