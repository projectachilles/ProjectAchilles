import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <Loader2 className={`animate-spin ${sizeStyles[size]} ${className}`} />
  );
}

interface LoadingProps {
  message?: string;
  className?: string;
}

export function Loading({ message = 'Loading...', className = '' }: LoadingProps) {
  return (
    <div className={`flex items-center justify-center h-full ${className}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner size="md" />
        <span>{message}</span>
      </div>
    </div>
  );
}

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner size="lg" />
        <span className="text-lg">{message}</span>
      </div>
    </div>
  );
}
