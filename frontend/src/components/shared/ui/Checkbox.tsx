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
              h-4 w-4 rounded border flex items-center justify-center
              transition-colors
              peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent
              peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
              ${isActive
                ? 'bg-accent border-accent'
                : 'border-border bg-raised'
              }
              ${className}
            `}
          >
            {indeterminate && !checked && <Minus className="h-3 w-3 text-accent-foreground" />}
            {checked && <Check className="h-3 w-3 text-accent-foreground" />}
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
