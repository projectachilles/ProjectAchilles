import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export interface AppHotkeysOptions {
  /** Routes bound to the number keys 1..n, in nav order. */
  routes: string[];
  onToggleSearch: () => void;
  onOpenShortcuts: () => void;
  /** When true, number/slash/question bindings are suspended (e.g. search overlay open). */
  disabled?: boolean;
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="dialog"]:not([hidden])') !== null;
}

/**
 * Single app-level keyboard shortcut handler (f0 shell behavior):
 * - 1..n jump to the given routes
 * - `/` focuses the page search input (`#page-search`)
 * - `?` opens the shortcuts dialog
 * - Cmd/Ctrl+K toggles the global search palette
 * All bindings except Cmd+K are ignored while typing in a field or while a
 * dialog is open; Escape is handled natively by Radix.
 */
export function useAppHotkeys({
  routes,
  onToggleSearch,
  onOpenShortcuts,
  disabled = false,
}: AppHotkeysOptions) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl+K works everywhere, including inside inputs
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onToggleSearch();
        return;
      }

      if (disabled) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextInput(e.target) || isDialogOpen()) return;

      if (e.key === '/') {
        const search = document.getElementById('page-search');
        if (search instanceof HTMLElement) {
          e.preventDefault();
          search.focus();
        }
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        onOpenShortcuts();
        return;
      }

      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= routes.length) {
        e.preventDefault();
        navigate(routes[n - 1]);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [routes, onToggleSearch, onOpenShortcuts, disabled, navigate]);
}
