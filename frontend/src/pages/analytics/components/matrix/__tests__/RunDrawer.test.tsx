import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { RunDrawer } from '../RunDrawer';

// The panel a run's detail opens in, over the matrix.

function Harness(props: Partial<Parameters<typeof RunDrawer>[0]> & { startOpen?: boolean }) {
  const [open, setOpen] = useState(props.startOpen ?? false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <input aria-label="outside field" />
      <RunDrawer open={open} title="Chain A on HOST-01" onClose={() => { props.onClose?.(); setOpen(false); }} onPrevious={props.onPrevious} onNext={props.onNext} suspended={props.suspended}>
        <p>the detail</p>
        <input aria-label="note" />
        <button>last in drawer</button>
      </RunDrawer>
    </>
  );
}

/** The drawer takes focus just after it opens; a test that moves focus itself waits for that first. */
const opened = () => waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());

describe('RunDrawer', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('the detail')).not.toBeInTheDocument();
  });

  it('is a modal dialog named by its title, holding its children', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'opener' }));

    const dialog = screen.getByRole('dialog', { name: 'Chain A on HOST-01' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('the detail');
  });

  it('takes focus when it opens and gives it back to the opener when it closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });

    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes on Escape and on a click on the backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} startOpen />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'opener' }));
    await user.click(screen.getByTestId('drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close on a click inside it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} startOpen />);

    await user.click(screen.getByText('the detail'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside it', async () => {
    const user = userEvent.setup();
    render(<Harness startOpen />);
    await opened();
    const last = screen.getByRole('button', { name: 'last in drawer' });

    last.focus();
    await user.tab();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(last);

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('moves to the previous and next run with the arrow keys and with its buttons', async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<Harness startOpen onPrevious={onPrevious} onNext={onNext} />);

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowUp}');
    await user.click(screen.getByRole('button', { name: 'Next run' }));
    await user.click(screen.getByRole('button', { name: 'Previous run' }));

    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(2);
  });

  it('leaves the arrow keys to a text field', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<Harness startOpen onNext={onNext} />);
    await opened();

    screen.getByRole('textbox', { name: 'note' }).focus();
    await user.keyboard('{ArrowDown}');

    expect(onNext).not.toHaveBeenCalled();
  });

  it('disables a direction that has no run', () => {
    render(<Harness startOpen onNext={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Previous run' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next run' })).toBeEnabled();
  });

  it('shows no run buttons when it cannot move at all', () => {
    render(<Harness startOpen />);

    expect(screen.queryByRole('button', { name: 'Next run' })).not.toBeInTheDocument();
  });

  it('stops the page behind from scrolling while open, and lets it again after', async () => {
    const user = userEvent.setup();
    render(<Harness startOpen />);
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');

    expect(document.body.style.overflow).toBe('');
  });

  it('ignores the keyboard while a dialog is open over it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNext = vi.fn();
    render(<Harness startOpen suspended onClose={onClose} onNext={onNext} />);

    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowDown}');

    expect(onClose).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
