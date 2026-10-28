import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { fieldControlClass, fieldErrorClass, fieldHelpClass, fieldLabelClass } from './formStyles';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, helperText, leftIcon, rightIcon, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className={fieldLabelClass}
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              fieldControlClass,
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              error && 'border-danger',
              className,
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-faint">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p className={fieldErrorClass}>{error}</p>
        )}
        {helperText && !error && (
          <p className={fieldHelpClass}>{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
