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
});
