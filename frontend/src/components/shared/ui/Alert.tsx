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
    container: 'bg-muted border-border',
    icon: <Info className="w-5 h-5" />,
  },
  success: {
    container: 'bg-green-500/10 border-green-500/30 text-green-500',
    icon: <CheckCircle2 className="w-5 h-5" />,
  },
  warning: {
    container: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500',
    icon: <AlertTriangle className="w-5 h-5" />,
  },
  destructive: {
    container: 'bg-destructive/10 border-destructive/30 text-destructive',
    icon: <AlertCircle className="w-5 h-5" />,
  },
  info: {
    container: 'bg-blue-500/10 border-blue-500/30 text-blue-500',
    icon: <Info className="w-5 h-5" />,
  },
};

export function Alert({ variant = 'default', title, children, onClose, className = '' }: AlertProps) {
  const { container, icon } = variantStyles[variant];

  return (
    <div className={`relative flex gap-3 rounded-lg border p-4 ${container} ${className}`}>
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1">
        {title && <h5 className="font-medium mb-1">{title}</h5>}
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
    <div className={`flex items-center gap-3 rounded-lg border p-4 shadow-lg ${container} ${className}`}>
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
