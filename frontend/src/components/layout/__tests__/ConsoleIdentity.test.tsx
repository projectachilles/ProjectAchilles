import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ConsoleIdentity } from '@/types/consoleIdentity';

const state = vi.hoisted(() => ({ identity: null as ConsoleIdentity | null }));

vi.mock('@/hooks/useConsoleIdentity', () => ({
  useConsoleIdentity: () => ({
    identity: state.identity,
    active: state.identity?.code != null,
    setIdentity: () => {},
    refresh: async () => {},
  }),
}));

import {
  IdentityPlate,
  IdentityRibbon,
  IdentityPill,
  IdentityChipFromContext,
} from '../ConsoleIdentity';
import { PageHeader } from '../PageHeader';

const NAME = 'Acme Financial Group';
const acme = (over: Partial<ConsoleIdentity> = {}): ConsoleIdentity => ({
  code: 'ACME',
  name: NAME,
  color: 'violet',
  source: 'saved',
  ...over,
});

describe('console identity components', () => {
  beforeEach(() => {
    state.identity = null;
  });

  it('render nothing when inactive', () => {
    for (const C of [IdentityPlate, IdentityRibbon, IdentityPill, IdentityChipFromContext]) {
      const { container, unmount } = render(<C />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('plate keeps its left bar after a colour change and logs no style-conflict warning', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.identity = acme({ color: 'violet' });
    const { container, rerender } = render(<IdentityPlate />);
    state.identity = acme({ color: 'blue' });
    rerender(<IdentityPlate />);
    const plate = container.querySelector<HTMLElement>('[style*="--identity"]')!;
    expect(plate.style.borderLeftColor).toBe('var(--identity)');
    const conflicts = err.mock.calls.filter((c) => String(c[0]).includes('conflicting property'));
    expect(conflicts).toHaveLength(0);
    err.mockRestore();
  });

  it('PageHeader without children renders no right-aligned wrapper when inactive', () => {
    const { container } = render(<PageHeader title="Agents" />);
    expect(container.firstElementChild?.children.length).toBe(1);
  });

  it('plate shows code and name, no label', () => {
    state.identity = acme();
    const { container } = render(<IdentityPlate />);
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/customer/i);
    expect(container.firstElementChild).toHaveClass('print:hidden');
  });

  it('ribbon uses the colour', () => {
    state.identity = acme();
    const { container } = render(<IdentityRibbon />);
    expect(container.firstElementChild).toHaveStyle({ backgroundColor: '#a78bfa' });
    expect(container.firstElementChild).toHaveClass('print:hidden');
  });

  it('PageHeader shows the pill before its children', () => {
    state.identity = acme();
    render(
      <PageHeader title="Agents">
        <button>Act</button>
      </PageHeader>,
    );
    const pill = screen.getByText(NAME);
    const btn = screen.getByRole('button', { name: 'Act' });
    expect(pill.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('colour none: no ribbon, plate and pill still render', () => {
    state.identity = acme({ color: 'none' });
    const ribbon = render(<IdentityRibbon />);
    expect(ribbon.container).toBeEmptyDOMElement();
    ribbon.unmount();
    render(
      <>
        <IdentityPlate />
        <IdentityPill />
      </>,
    );
    expect(screen.getAllByText('ACME')).toHaveLength(2);
  });

  it('null name: pill shows the chip only', () => {
    state.identity = acme({ name: null });
    const { container } = render(<IdentityPill />);
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(container.querySelector('.truncate')).toBeNull();
  });

  it('long name truncates with a title', () => {
    const long = 'A'.repeat(80);
    state.identity = acme({ name: long });
    render(<IdentityPill />);
    const el = screen.getByText(long);
    expect(el).toHaveClass('truncate');
    expect(el).toHaveAttribute('title', long);
  });
});
