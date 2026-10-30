import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConsoleIdentity } from '@/types/consoleIdentity';

vi.mock('@/services/api/consoleIdentity', () => ({
  consoleIdentityApi: { get: vi.fn(), save: vi.fn(), reset: vi.fn() },
}));

const setIdentity = vi.fn();
let current: ConsoleIdentity | null = null;
vi.mock('@/hooks/useConsoleIdentity', () => ({
  useConsoleIdentity: () => ({ identity: current, active: !!current?.code, setIdentity, refresh: vi.fn() }),
}));

import { consoleIdentityApi } from '@/services/api/consoleIdentity';
import { WORDMARK } from '@/lib/brand';
import { ConsoleIdentityCard } from '../ConsoleIdentityCard';

const saved: ConsoleIdentity = { code: 'ACME', name: 'Acme Financial Group', color: 'violet', source: 'saved' };
const none: ConsoleIdentity = { code: null, name: null, color: 'none', source: 'none' };

beforeEach(() => {
  vi.clearAllMocks();
  current = none;
});

const codeInput = () => screen.getByLabelText(/^code/i) as HTMLInputElement;

describe('ConsoleIdentityCard', () => {
  it('sanitises the code as you type', async () => {
    render(<ConsoleIdentityCard />);
    await userEvent.type(codeInput(), 'ac-me1');
    expect(codeInput().value).toBe('ACME1');
  });

  it('caps the code at 6 characters', async () => {
    render(<ConsoleIdentityCard />);
    await userEvent.type(codeInput(), 'abcdefghi');
    expect(codeInput().value).toBe('ABCDEF');
  });

  it('disables Save below 2 characters', async () => {
    render(<ConsoleIdentityCard />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(codeInput(), 'a');
    expect(save).toBeDisabled();
    await userEvent.type(codeInput(), 'b');
    expect(save).toBeEnabled();
  });

  it('offers None plus 8 preset swatches as a radio group', () => {
    render(<ConsoleIdentityCard />);
    const group = screen.getByRole('radiogroup', { name: /colour/i });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(9);
    expect(screen.getByRole('radio', { name: 'None' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Violet' })).toBeInTheDocument();
  });

  it('selected swatch keeps its ring: no outline-none (Tailwind v4 sets outline-style none)', () => {
    current = saved;
    render(<ConsoleIdentityCard />);
    const selected = screen.getByRole('radio', { name: 'Violet' });
    expect(selected.className).toContain('outline-foreground');
    for (const r of screen.getAllByRole('radio')) {
      expect(r.className.split(/\s+/)).not.toContain('outline-none');
    }
  });

  it('saves with a null name when blank, then updates the provider', async () => {
    const response: ConsoleIdentity = { code: 'ACME', name: null, color: 'cyan', source: 'saved' };
    vi.mocked(consoleIdentityApi.save).mockResolvedValue(response);
    render(<ConsoleIdentityCard />);
    await userEvent.type(codeInput(), 'acme');
    await userEvent.click(screen.getByRole('radio', { name: 'Cyan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(consoleIdentityApi.save).toHaveBeenCalledWith({ code: 'ACME', name: null, color: 'cyan' }),
    );
    await waitFor(() => expect(setIdentity).toHaveBeenCalledWith(response));
  });

  it('prefills from the current identity', () => {
    current = saved;
    render(<ConsoleIdentityCard />);
    expect(codeInput().value).toBe('ACME');
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Acme Financial Group');
    expect(screen.getByRole('radio', { name: 'Violet' })).toBeChecked();
  });

  it('disables Reset unless the identity is saved', () => {
    current = { ...saved, source: 'env' };
    render(<ConsoleIdentityCard />);
    expect(screen.getByRole('button', { name: 'Reset to environment' })).toBeDisabled();
    expect(screen.getByText('From environment')).toBeInTheDocument();
  });

  it('resets and updates the provider when saved', async () => {
    current = saved;
    const restored: ConsoleIdentity = { code: 'ENVX', name: null, color: 'none', source: 'env' };
    vi.mocked(consoleIdentityApi.reset).mockResolvedValue(restored);
    render(<ConsoleIdentityCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to environment' }));
    await waitFor(() => expect(consoleIdentityApi.reset).toHaveBeenCalled());
    await waitFor(() => expect(setIdentity).toHaveBeenCalledWith(restored));
  });

  it('previews the tab title and updates while typing', async () => {
    render(<ConsoleIdentityCard />);
    await userEvent.type(codeInput(), 'acme');
    expect(screen.getByText(`[ACME] Settings · ${WORDMARK}`)).toBeInTheDocument();
    expect(screen.getByTestId('identity-preview-pill')).toHaveTextContent('ACME');
    await userEvent.type(codeInput(), '1');
    expect(screen.getByText(`[ACME1] Settings · ${WORDMARK}`)).toBeInTheDocument();
  });

  it('shows the backend error and does not update the provider', async () => {
    vi.mocked(consoleIdentityApi.save).mockRejectedValue(new Error('Code must be 2-6 letters or digits'));
    render(<ConsoleIdentityCard />);
    await userEvent.type(codeInput(), 'acme');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Code must be 2-6 letters or digits')).toBeInTheDocument();
    expect(setIdentity).not.toHaveBeenCalled();
  });

  it('keeps unsaved edits when a refresh brings the same server values', async () => {
    current = saved;
    const { rerender } = render(<ConsoleIdentityCard />);
    await userEvent.clear(screen.getByLabelText(/full name/i));
    await userEvent.type(screen.getByLabelText(/full name/i), 'Typed Name');
    current = { ...saved };
    rerender(<ConsoleIdentityCard />);
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Typed Name');
  });

  it('keeps unsaved edits even when the server values changed underneath', async () => {
    current = saved;
    const { rerender } = render(<ConsoleIdentityCard />);
    await userEvent.type(screen.getByLabelText(/full name/i), ' X');
    current = { ...saved, name: 'Other' };
    rerender(<ConsoleIdentityCard />);
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Acme Financial Group X');
  });

  it('re-prefills a clean form from a refreshed identity', () => {
    current = saved;
    const { rerender } = render(<ConsoleIdentityCard />);
    current = { code: 'NEWC', name: 'New Co', color: 'pink', source: 'saved' };
    rerender(<ConsoleIdentityCard />);
    expect(codeInput().value).toBe('NEWC');
    expect(screen.getByLabelText(/full name/i)).toHaveValue('New Co');
    expect(screen.getByRole('radio', { name: 'Pink' })).toBeChecked();
  });
});
