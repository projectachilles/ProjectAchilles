import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'border-border bg-raised text-muted',
  primary: 'border-accent/30 bg-accent-dim text-accent',
  secondary: 'border-border bg-raised text-muted',
  success: 'border-accent/30 bg-accent-dim text-accent',
  warning: 'border-warning/30 bg-warning-dim text-warning',
  destructive: 'border-danger/30 bg-danger-dim text-danger',
  outline: 'border-border text-muted',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`
          inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap
          ${variantStyles[variant]}
          ${className}
        `}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

// Platform-specific badge
interface PlatformBadgeProps {
  platform: string;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  // Platform chips use the info badge set per the f0 design language
  const color = 'border-info/30 bg-info-dim text-info';

  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wide whitespace-nowrap ${color}`}>
      {platform}
    </span>
  );
}

// Status indicator dot
interface StatusDotProps {
  status: 'online' | 'offline' | 'unknown';
  className?: string;
}

export function StatusDot({ status, className = '' }: StatusDotProps) {
  const colors: Record<string, string> = {
    online: 'bg-accent',
    offline: 'bg-danger',
    unknown: 'bg-faint',
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status]} ${className}`}
      title={status}
    />
  );
}
