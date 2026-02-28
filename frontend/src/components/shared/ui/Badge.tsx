import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary text-secondary-foreground',
  success: 'bg-green-500/10 text-green-500',
  warning: 'bg-yellow-500/10 text-yellow-500',
  destructive: 'bg-destructive/10 text-destructive',
  outline: 'border border-border text-foreground',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`
          inline-flex items-center rounded-base border-theme border-border px-2 py-1 text-xs font-medium
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
  const platformColors: Record<string, string> = {
    windows: 'bg-blue-500/10 text-blue-500',
    linux: 'bg-orange-500/10 text-orange-500',
    macos: 'bg-gray-500/10 text-gray-400',
    darwin: 'bg-gray-500/10 text-gray-400',
  };

  const color = platformColors[platform.toLowerCase()] || 'bg-muted text-muted-foreground';

  return (
    <span className={`inline-flex items-center rounded-base border-theme border-border px-2 py-1 text-xs font-medium ${color}`}>
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
    online: 'bg-green-500',
    offline: 'bg-red-500',
    unknown: 'bg-gray-500',
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status]} ${className}`}
      title={status}
    />
  );
}
