import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ExecutionConfig, getDefaultConfigState } from '../ExecutionConfig';

const baseConfig = { ...getDefaultConfigState(), timeout: '300', priority: '1', targetIndex: '' };
const noop = vi.fn();

function renderConfig(overrides = {}) {
  return render(
    <ExecutionConfig
      config={baseConfig}
      onChange={noop}
      availableIndices={[{ name: 'achilles-results-', docsCount: 1, storeSize: 1, status: 'green' }]}
      indicesLoading={false}
      {...overrides}
    />,
  );
}

describe('ExecutionConfig Target Index', () => {
  it('hides the Target Index select until Advanced is expanded', () => {
    renderConfig();
    expect(screen.queryByLabelText('Target Index')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByLabelText('Target Index')).toBeInTheDocument();
  });

  it('defaults the Target Index to "Default (global)" (empty value)', () => {
    renderConfig();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    const select = screen.getByLabelText('Target Index') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0].textContent).toMatch(/Default \(global\)/);
  });

  it('Advanced toggle exposes aria-expanded', () => {
    renderConfig();
    const btn = screen.getByRole('button', { name: /advanced/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('Advanced button has aria-controls pointing to its controlled region', () => {
    renderConfig();
    const btn = screen.getByRole('button', { name: /advanced/i });
    expect(btn).toHaveAttribute('aria-controls', 'exec-advanced-run-now');
    fireEvent.click(btn);
    expect(document.getElementById('exec-advanced-run-now')).toBeInTheDocument();
  });
});

describe('ExecutionConfig Once timing', () => {
  function renderOnce(randomizeMode: 'fixed' | 'fleet' | 'per_machine', allowRandomizedOnce?: boolean) {
    const onChange = vi.fn();
    renderConfig({ config: { ...baseConfig, scheduleType: 'once', randomizeMode }, onChange, allowRandomizedOnce });
    fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    return onChange;
  }

  it('offers the Timing choice for Once when the backend supports it', () => {
    renderOnce('fixed', true);
    expect(screen.getByText('Timing')).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
  });

  it('hides it when the backend does not (Vercel)', () => {
    renderOnce('fixed');
    expect(screen.queryByText('Timing')).not.toBeInTheDocument();
  });

  it('a randomized Once asks for the date only and explains the window', () => {
    renderOnce('per_machine', true);
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.queryByText('Time')).not.toBeInTheDocument();
    expect(screen.getByText(/Each machine runs at its own random time/)).toBeInTheDocument();
  });

  it('switching to Once keeps the timing choice only when it is supported', () => {
    const allowed = renderOnce('per_machine', true);
    fireEvent.click(screen.getByRole('button', { name: 'once' }));
    expect(allowed).not.toHaveBeenCalledWith({ randomizeMode: 'fixed' });
  });

  it('switching to Once resets the timing to fixed when unsupported', () => {
    const notAllowed = renderOnce('per_machine');
    fireEvent.click(screen.getByRole('button', { name: 'once' }));
    expect(notAllowed).toHaveBeenCalledWith({ randomizeMode: 'fixed' });
  });
});
