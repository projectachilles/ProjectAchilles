import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className = '', label, id, checked, ...props }, ref) => {
    const switchId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <label
        htmlFor={switchId}
        className="inline-flex items-center gap-3 cursor-pointer"
      >
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            id={switchId}
            checked={checked}
            className="peer sr-only"
            {...props}
          />
          <div
            className={`
              w-11 h-6 rounded-full
              bg-muted peer-checked:bg-primary
              transition-colors
              peer-focus:ring-2 peer-focus:ring-primary/50 peer-focus:ring-offset-2 peer-focus:ring-offset-background
              peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
              ${className}
            `}
          />
          <div
            className={`
              absolute top-0.5 left-0.5
              w-5 h-5 rounded-full bg-white
              transition-transform
              peer-checked:translate-x-5
              shadow-sm
            `}
          />
        </div>
        {label && (
          <span className="text-sm text-foreground">{label}</span>
        )}
      </label>
    );
  }
);

Switch.displayName = 'Switch';
