import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useAppHotkeys } from '../useAppHotkeys';

const onToggleSearch = vi.fn();
const onOpenShortcuts = vi.fn();

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function Harness({ disabled = false }: { disabled?: boolean }) {
  useAppHotkeys({
    routes: ['/dashboard', '/tests', '/analytics'],
    onToggleSearch,
    onOpenShortcuts,
    disabled,
  });
  return (
    <>
      <input id="page-search" data-testid="page-search" />
      <input data-testid="other-input" />
      <LocationProbe />
    </>
  );
}

function renderHarness(disabled = false) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="*" element={<Harness disabled={disabled} />} />
      </Routes>
    </MemoryRouter>
  );
}

function pressKey(key: string, options: KeyboardEventInit = {}, target: Element = document.body) {
  fireEvent.keyDown(target, { key, ...options });
}

describe('useAppHotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('number keys navigate to the bound routes', () => {
    renderHarness();
    pressKey('2');
    expect(screen.getByTestId('location').textContent).toBe('/tests');
    pressKey('3');
    expect(screen.getByTestId('location').textContent).toBe('/analytics');
  });

  it('numbers beyond the route list are ignored', () => {
    renderHarness();
    pressKey('9');
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
  });

  it('"/" focuses the page search input', () => {
    renderHarness();
    pressKey('/');
    expect(document.activeElement).toBe(screen.getByTestId('page-search'));
  });

  it('"?" opens the shortcuts dialog', () => {
    renderHarness();
    pressKey('?');
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
  });

  it('bindings are suppressed while typing in an input', () => {
    renderHarness();
    const input = screen.getByTestId('other-input');
    input.focus();
    pressKey('2', {}, input as Element);
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
    pressKey('?', {}, input as Element);
    expect(onOpenShortcuts).not.toHaveBeenCalled();
  });

  it('bindings are suppressed while a dialog is open', () => {
    renderHarness();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);
    pressKey('2');
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
    dialog.remove();
  });

  it('Cmd/Ctrl+K toggles search even from inside an input', () => {
    renderHarness();
    const input = screen.getByTestId('other-input');
    input.focus();
    pressKey('k', { ctrlKey: true }, input as Element);
    expect(onToggleSearch).toHaveBeenCalledOnce();
  });

  it('disabled suspends everything except Cmd+K', () => {
    renderHarness(true);
    pressKey('2');
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
    pressKey('k', { metaKey: true });
    expect(onToggleSearch).toHaveBeenCalledOnce();
  });
});
