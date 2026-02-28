import type { ButtonHTMLAttributes } from 'react';
import { forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground border-theme border-border shadow-theme hover:translate-x-[var(--theme-hover-translate)] hover:translate-y-[var(--theme-hover-translate)] hover:shadow-[var(--theme-hover-shadow)]',
  secondary: 'bg-secondary text-secondary-foreground border-theme border-border shadow-theme hover:bg-secondary/80 hover:translate-x-[var(--theme-hover-translate)] hover:translate-y-[var(--theme-hover-translate)] hover:shadow-[var(--theme-hover-shadow)]',
  ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground border-theme border-border shadow-theme hover:translate-x-[var(--theme-hover-translate)] hover:translate-y-[var(--theme-hover-translate)] hover:shadow-[var(--theme-hover-shadow)]',
  outline: 'border-theme border-border bg-transparent text-foreground shadow-theme hover:bg-accent hover:text-accent-foreground hover:translate-x-[var(--theme-hover-translate)] hover:translate-y-[var(--theme-hover-translate)] hover:shadow-[var(--theme-hover-shadow)]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4',
  lg: 'h-12 px-6 text-lg',
  icon: 'h-10 w-10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`
          inline-flex items-center justify-center gap-2 rounded-base font-medium
          transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          disabled:pointer-events-none disabled:opacity-50
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
