import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RunDrawerProps {
  open: boolean;
  /** The dialog's name: what is shown, for example "Chain A on HOST-01". */
  title: string;
  onClose: () => void;
  /** Move to the run above / below in the pair's list; undefined at the ends. */
  onPrevious?: () => void;
  onNext?: () => void;
  /** A dialog is open over the drawer: the keyboard is that dialog's. */
  suspended?: boolean;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';
const isTextField = (el: Element | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * A panel from the right, over a backdrop, for a run's detail. Escape and the
 * backdrop close it, Tab stays inside, focus returns to what opened it, and
 * the up and down arrows move between the runs of the open pair.
 */
export function RunDrawer({ open, title, onClose, onPrevious, onNext, suspended = false, children }: RunDrawerProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  // The handlers change on every render of the parent; the listener reads the latest.
  const handlers = useRef({ onClose, onPrevious, onNext, suspended });
  handlers.current = { onClose, onPrevious, onNext, suspended };

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    queueMicrotask(() => closeButton.current?.focus());

    function onKeyDown(e: KeyboardEvent) {
      const h = handlers.current;
      if (h.suspended) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        h.onClose();
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isTextField(document.activeElement)) {
        const move = e.key === 'ArrowUp' ? h.onPrevious : h.onNext;
        if (move) {
          e.preventDefault();
          move();
        }
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const focusables = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const canMove = Boolean(onPrevious || onNext);

  return (
    // Under one of the detail's dialogs the drawer steps aside: inert, and no longer modal,
    // or a screen reader would not reach the dialog, which is its sibling in the page.
    <div className="fixed inset-0 z-40" inert={suspended}>
      <div data-testid="drawer-backdrop" className="absolute inset-0 bg-background/60" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal={suspended ? undefined : true}
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full max-w-[680px] flex-col border-l border-border-strong bg-surface shadow-[-24px_0_60px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight" title={title}>{title}</h2>
          {canMove && (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Previous run" title="Previous run (↑)" disabled={!onPrevious} onClick={onPrevious}>
                <ChevronUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next run" title="Next run (↓)" disabled={!onNext} onClick={onNext}>
                <ChevronDown />
              </Button>
            </>
          )}
          <Button ref={closeButton} variant="ghost" size="icon-sm" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
