import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useConsoleIdentity } from '@/hooks/useConsoleIdentity';
import { IdentityPill } from './ConsoleIdentity';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Inline next to the title on the same row (e.g. section tabs), so it costs no height. */
  titleAside?: ReactNode;
  /** Right-aligned actions (buttons, chips). */
  children?: ReactNode;
  className?: string;
}

/** Standard f0 page header: title + description left, actions right. */
export function PageHeader({ title, description, titleAside, children, className }: PageHeaderProps) {
  const { active } = useConsoleIdentity();
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        {titleAside ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {titleAside}
          </div>
        ) : (
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        )}
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      {(children || active) && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <IdentityPill />
          {children}
        </div>
      )}
    </div>
  );
}
