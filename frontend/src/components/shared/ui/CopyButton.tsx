import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyText } from '@/lib/clipboard';

interface CopyButtonProps {
  text: string;
  label?: string;
  /** ghost: quiet inline action; accent: the primary copy on a panel. */
  variant?: 'ghost' | 'accent';
  /** Names what is copied for screen readers, e.g. "Copy stdout". */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

const VARIANT: Record<NonNullable<CopyButtonProps['variant']>, string> = {
  ghost: 'h-6 px-2 text-[11px] text-muted hover:bg-raised hover:text-foreground',
  accent: 'h-8 border border-accent/25 bg-accent-dim px-3 text-xs text-accent hover:bg-accent/15',
};

export function CopyButton({ text, label = 'Copy', variant = 'ghost', ariaLabel, disabled, className }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function handleCopy(e: React.MouseEvent) {
    // Copy buttons sit on clickable panels (e.g. expand-on-click output boxes).
    e.stopPropagation();
    setState((await copyText(text)) ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  const Icon = state === 'copied' ? Check : state === 'failed' ? X : Copy;
  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-label={state === 'idle' ? ariaLabel : undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        className,
      )}
    >
      <Icon className={variant === 'ghost' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
