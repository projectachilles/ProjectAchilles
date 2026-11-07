import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  /** Optional control on the right of the title row (link, button). */
  action?: ReactNode;
  /** A panel with no data is not rendered at all (no empty boxes). */
  hidden?: boolean;
  children: ReactNode;
}

/** Shared chrome for the Overview's side panels. */
export default function Panel({ title, action, hidden, children }: PanelProps) {
  if (hidden) return null;
  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
