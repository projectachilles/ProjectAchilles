import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { Check, Minus } from 'lucide-react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = '', label, id, checked, indeterminate, ...props }, ref) => {
    const checkboxId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const isActive = checked || indeterminate;

    return (
      <label
        htmlFor={checkboxId}
        className="inline-flex items-center gap-2 cursor-pointer"
      >
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            id={checkboxId}
            checked={checked}
            className="peer sr-only"
            {...props}
          />
          <div
            className={`
              w-5 h-5 rounded-base border-theme flex items-center justify-center
              transition-colors
              peer-focus:ring-2 peer-focus:ring-primary/50
              peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
              ${isActive
                ? 'bg-primary border-primary'
                : 'border-border bg-background'
              }
              ${className}
            `}
          >
            {indeterminate && !checked && <Minus className="w-3.5 h-3.5 text-primary-foreground" />}
            {checked && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
          </div>
        </div>
        {label && (
          <span className="text-sm text-foreground">{label}</span>
        )}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
