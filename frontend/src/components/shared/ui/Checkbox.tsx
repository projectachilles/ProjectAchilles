import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { Check } from 'lucide-react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = '', label, id, checked, ...props }, ref) => {
    const checkboxId = id || label?.toLowerCase().replace(/\s+/g, '-');

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
              w-5 h-5 rounded border border-border bg-background
              flex items-center justify-center
              transition-colors
              peer-checked:bg-primary peer-checked:border-primary
              peer-focus:ring-2 peer-focus:ring-primary/50
              peer-disabled:opacity-50 peer-disabled:cursor-not-allowed
              ${className}
            `}
          >
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
