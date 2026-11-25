/**
 * The tones a result mark can take. Shared by the Tasks run timeline and the
 * Analytics coverage matrix, so a colour means the same thing on both.
 * 'hollow' is "nothing happened here": a skipped stage, a pair never run.
 */
export type MarkTone = 'accent' | 'danger' | 'warning' | 'muted' | 'info' | 'hollow';

export const MARK_BG: Record<MarkTone, string> = {
  accent: 'bg-accent',
  danger: 'bg-danger',
  warning: 'bg-warning',
  muted: 'bg-faint',
  info: 'bg-info',
  hollow: 'bg-transparent shadow-[inset_0_0_0_1px_var(--color-border-strong)]',
};

export const MARK_TEXT: Record<MarkTone, string> = {
  accent: 'text-accent',
  danger: 'text-danger',
  warning: 'text-warning',
  muted: 'text-muted',
  info: 'text-info',
  hollow: 'text-faint',
};
