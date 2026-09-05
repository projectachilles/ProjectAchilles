import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StreamRowOwnProps {
  /** Checkbox, glyph, icon: anything that sits before the timestamp. */
  leading?: ReactNode;
  /** Timestamp or clock text. Rendered as-is; style it yourself. */
  time?: ReactNode;
  /** Primary label. Truncates; gets the remaining width on every breakpoint. */
  name: ReactNode;
  /** Outcome (exit code, status, relative time). Stays on line one on phones and moves last on md+. */
  trailing?: ReactNode;
  /** Secondary facts (host, agent count, duration). Line two below md; inline after the name on md+. */
  meta?: ReactNode;
  className?: string;
  nameClassName?: string;
}

type StreamRowProps<T extends ElementType> = StreamRowOwnProps & { as?: T } & Omit<
    ComponentPropsWithoutRef<T>,
    keyof StreamRowOwnProps | 'as'
  >;

/**
 * One-line list row that becomes two lines on narrow viewports.
 *
 * md and up (DOM order): leading · time · name · meta children · trailing
 * below md:              leading · time · name · trailing
 *                        meta (full width)
 */
export function StreamRow<T extends ElementType = 'div'>({
  as,
  leading,
  time,
  name,
  trailing,
  meta,
  className,
  nameClassName,
  ...rest
}: StreamRowProps<T>) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag
      className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-0.5 md:flex-nowrap', className)}
      {...rest}
    >
      {leading}
      {time}
      <span className={cn('min-w-0 flex-1 truncate', nameClassName)}>{name}</span>
      {trailing != null && (
        <span className="flex shrink-0 items-center gap-2 md:order-last">{trailing}</span>
      )}
      {meta != null && (
        <span className="flex min-w-0 basis-full items-center gap-2 md:contents">{meta}</span>
      )}
    </Tag>
  );
}
