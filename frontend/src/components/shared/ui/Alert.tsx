import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

type AlertVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}

const variantStyles: Record<AlertVariant, { container: string; icon: ReactNode }> = {
  default: {
    container: 'bg-raised border-border',
    icon: <Info className="h-4 w-4" />,
  },
  success: {
    container: 'bg-accent-dim border-accent/30 text-accent',
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  warning: {
    container: 'bg-warning-dim border-warning/40 text-warning',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  destructive: {
    container: 'bg-danger-dim border-danger/30 text-danger',
    icon: <AlertCircle className="h-4 w-4" />,
  },
  info: {
    container: 'bg-info-dim border-info/30 text-info',
    icon: <Info className="h-4 w-4" />,
  },
};

export function Alert({ variant = 'default', title, children, onClose, className = '' }: AlertProps) {
  const { container, icon } = variantStyles[variant];

  return (
    <div className={`relative flex gap-2.5 rounded-md border p-3 ${container} ${className}`}>
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1">
        {title && <h5 className="mb-1 text-sm font-medium">{title}</h5>}
        <div className="text-sm">{children}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="flex-shrink-0 hover:opacity-70 transition-opacity"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// Toast-style notification
interface ToastProps {
  variant?: AlertVariant;
  message: string;
  onClose?: () => void;
  className?: string;
}

export function Toast({ variant = 'default', message, onClose, className = '' }: ToastProps) {
  const { container, icon } = variantStyles[variant];

  return (
    <div className={`flex items-center gap-2.5 rounded-md border p-3 ${container} ${className}`}>
      <div className="flex-shrink-0">{icon}</div>
      <span className="text-sm font-medium">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="flex-shrink-0 ml-auto hover:opacity-70 transition-opacity"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
